import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { AgnesApiError, createAgnesChatCompletion, type AgnesChatMessage } from '@/lib/agnes'
import { hashCtechApiKey, isCtechApiKey } from '@/lib/api-keys'
import { consumePrimaryModelAllowance, releasePrimaryModelAllowance } from '@/lib/billing/service'
import { db } from '@/lib/db'
import { authUser, ctechApiKeys } from '@/lib/db/schema'
import { buildCurrentTimeContext, buildOpenHermesPrompt } from '@/lib/prompt'
import { readJsonRequest, RequestBodyTooLargeError } from '@/lib/request-body'

const MAX_REQUEST_BYTES = 256_000
const MAX_TOTAL_MESSAGE_CHARACTERS = 60_000
const MAX_OUTPUT_TOKENS = 4_096
const PUBLIC_MODEL_NAME = 'ctech-chat'
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
}

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(20_000),
}).strict()

const requestSchema = z.object({
  model: z.literal(PUBLIC_MODEL_NAME).optional(),
  messages: z.array(messageSchema).min(1).max(40),
  max_tokens: z.number().int().min(1).max(MAX_OUTPUT_TOKENS).optional(),
}).strict()

function apiError(message: string, status: number, type: string, code: string, extraHeaders?: HeadersInit) {
  return Response.json(
    { error: { message, type, code } },
    { status, headers: { 'Cache-Control': 'no-store', ...CORS_HEADERS, ...extraHeaders } },
  )
}

function invalidKeyResponse() {
  return apiError(
    'Missing or invalid API key. Send a valid key in the Authorization: Bearer header.',
    401,
    'authentication_error',
    'invalid_api_key',
    { 'WWW-Authenticate': 'Bearer realm="CTECH API"' },
  )
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token || !isCtechApiKey(token)) return invalidKeyResponse()

  let credential: { id: string; userId: string; email: string | null }
  try {
    const [found] = await db
      .select({ id: ctechApiKeys.id, userId: ctechApiKeys.userId, email: authUser.email })
      .from(ctechApiKeys)
      .innerJoin(authUser, eq(ctechApiKeys.userId, authUser.id))
      .where(and(eq(ctechApiKeys.keyHash, hashCtechApiKey(token)), isNull(ctechApiKeys.revokedAt)))
      .limit(1)

    if (!found) return invalidKeyResponse()
    credential = found
  } catch (error) {
    console.error('[v0] CTECH API credential lookup failed', error instanceof Error ? error.name : 'unknown error')
    return apiError('The API is temporarily unavailable.', 503, 'server_error', 'service_unavailable')
  }

  let rawBody: unknown
  try {
    rawBody = await readJsonRequest(request, MAX_REQUEST_BYTES)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return apiError('Request body is too large.', 413, 'invalid_request_error', 'request_too_large')
    }
    return apiError('Request body must contain valid JSON.', 400, 'invalid_request_error', 'invalid_json')
  }

  const parsed = requestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return apiError(
      'Use a supported model, 1–40 user or assistant messages, and max_tokens between 1 and 4096.',
      400,
      'invalid_request_error',
      'invalid_request',
    )
  }

  const messages = parsed.data.messages
  if (messages.at(-1)?.role !== 'user') {
    return apiError('The final message must have the user role.', 400, 'invalid_request_error', 'user_message_required')
  }

  const totalCharacters = messages.reduce((total, message) => total + message.content.length, 0)
  if (totalCharacters > MAX_TOTAL_MESSAGE_CHARACTERS) {
    return apiError('Combined message content must not exceed 60,000 characters.', 413, 'invalid_request_error', 'messages_too_large')
  }

  try {
    const [usedKey] = await db
      .update(ctechApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(ctechApiKeys.id, credential.id), eq(ctechApiKeys.userId, credential.userId), isNull(ctechApiKeys.revokedAt)))
      .returning({ id: ctechApiKeys.id })
    if (!usedKey) return invalidKeyResponse()
  } catch (error) {
    console.error('[v0] CTECH API key activity update failed', error instanceof Error ? error.name : 'unknown error')
    return apiError('The API is temporarily unavailable.', 503, 'server_error', 'service_unavailable')
  }

  const requestId = randomUUID()
  let usageEventId: string | null = null

  try {
    const allowance = await consumePrimaryModelAllowance(credential.userId, credential.email)
    if (allowance.tier !== 'primary') {
      const retryAfter = allowance.resetAt
        ? Math.max(1, Math.ceil((allowance.resetAt.getTime() - Date.now()) / 1_000))
        : undefined
      const extraHeaders = retryAfter ? { 'Retry-After': String(retryAfter) } : undefined
      return apiError(
        'This account has reached its current CTECH AI request allowance.',
        429,
        'rate_limit_error',
        'usage_limit_exceeded',
        extraHeaders,
      )
    }

    usageEventId = allowance.usageEventId
    const apiMessages: AgnesChatMessage[] = [
      { role: 'system', content: [buildOpenHermesPrompt('chat', false, 'api'), buildCurrentTimeContext()].join('\n\n') },
      ...messages.map((message) => ({ role: message.role, content: message.content })),
    ]
    const reply = await createAgnesChatCompletion({
      messages: apiMessages,
      maxTokens: parsed.data.max_tokens ?? 1_024,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(108_000)]),
    })

    return Response.json(
      {
        id: `chatcmpl_${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1_000),
        model: PUBLIC_MODEL_NAME,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: reply.text },
            finish_reason: 'stop',
          },
        ],
      },
      { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store', 'X-Request-Id': requestId } },
    )
  } catch (error) {
    if (usageEventId) {
      try {
        await releasePrimaryModelAllowance(credential.userId, usageEventId)
      } catch {
        console.error(`[v0] Failed to release API allowance (${requestId})`)
      }
    }

    console.error(`[v0] CTECH API chat failed (${requestId})`, error instanceof Error ? error.name : 'unknown error')
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    const status = timedOut ? 504 : error instanceof AgnesApiError ? 502 : 503
    const message = timedOut ? 'The model response timed out. Retry the request.' : 'The model service is temporarily unavailable.'
    return apiError(message, status, 'server_error', timedOut ? 'request_timeout' : 'upstream_error', { 'X-Request-Id': requestId })
  }
}
