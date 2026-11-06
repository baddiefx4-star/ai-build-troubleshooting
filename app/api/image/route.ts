import { z } from 'zod'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { consumePrimaryModelAllowance, releasePrimaryModelAllowance } from '@/lib/billing/service'
import { isValidConversationId, rememberAssistantReply, rememberConversation, sanitizeMessages } from '@/lib/chat-store'
import { AgnesApiError, generateAgnesImage } from '@/lib/agnes'
import { isOwnerEmail } from '@/lib/owner'
import { readJsonRequest, RequestBodyTooLargeError } from '@/lib/request-body'
import { isSameOriginRequest } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const maxDuration = 90

const requestSchema = z.object({
  conversationId: z.string().min(1).max(80),
  projectId: z.string().min(1).max(80),
  messages: z.array(z.unknown()).max(40),
  prompt: z.string().trim().min(1).max(3_000),
}).strict()

function rawMessageContent(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const content = (value as { content?: unknown }).content
  return typeof content === 'string' ? content : undefined
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })

  const session = await getAuthenticatedSession().catch(() => null)
  if (!session?.user) return Response.json({ error: 'Sign in to generate images.' }, { status: 401 })

  let rawBody: unknown
  try {
    rawBody = await readJsonRequest(req, 4_000_000)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: 'This conversation is too large to generate an image.' }, { status: 413 })
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(rawBody)
  if (!parsed.success) return Response.json({ error: 'Provide an image prompt of up to 3,000 characters.' }, { status: 400 })
  if (!isValidConversationId(parsed.data.conversationId)) return Response.json({ error: 'A valid conversation is required.' }, { status: 400 })
  if (!isValidConversationId(parsed.data.projectId)) return Response.json({ error: 'Choose a valid project.' }, { status: 400 })
  if (parsed.data.prompt.length > 3_000) return Response.json({ error: 'Image prompts can be up to 3,000 characters.' }, { status: 413 })
  const latestContent = rawMessageContent(parsed.data.messages.at(-1))
  if (latestContent && latestContent.length > 250_000) return Response.json({ error: 'Messages can be up to 250,000 characters.' }, { status: 413 })

  const messages = sanitizeMessages(parsed.data.messages)
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return Response.json({ error: 'A user message is required.' }, { status: 400 })
  }

  if (!process.env.AGNES_API_KEY) return Response.json({ error: 'CTECH AI image generation is temporarily unavailable.' }, { status: 503 })

  const userId = session.user.id
  const conversationId = parsed.data.conversationId
  let allowance: Awaited<ReturnType<typeof consumePrimaryModelAllowance>> | null
  try {
    allowance = isOwnerEmail(session.user.email)
      ? null
      : await consumePrimaryModelAllowance(userId, session.user.email)
  } catch {
    return Response.json({ error: 'Could not check your AI request allowance. Please try again.' }, { status: 503 })
  }
  if (allowance?.tier === 'mini') {
    const minutesUntilReset = allowance.resetAt
      ? Math.max(1, Math.ceil((allowance.resetAt.getTime() - Date.now()) / 60_000))
      : null
    const resetMessage = minutesUntilReset ? ` It resets in about ${minutesUntilReset} minutes.` : ''
    return Response.json({
      error: `Your ${allowance.limit}-request AI allowance has been used up.${resetMessage} View Plans to upgrade or wait for the reset.`,
    }, { status: 429 })
  }

  let usageEventId = allowance?.usageEventId ?? null
  try {
    await rememberConversation(userId, conversationId, parsed.data.projectId, 'creative', messages)
    const image = await generateAgnesImage(
      parsed.data.prompt,
      AbortSignal.any([req.signal, AbortSignal.timeout(80_000)]),
    )
    const imageDataUrl = `data:${image.mediaType};base64,${image.base64}`
    const messageId = await rememberAssistantReply(
      userId,
      conversationId,
      'creative',
      'Image generated. Download it from this chat to keep a copy.',
    )
    usageEventId = null

    return Response.json({ imageDataUrl, messageId, model: 'CTECH AI Image' })
  } catch (error) {
    if (usageEventId) {
      await releasePrimaryModelAllowance(userId, usageEventId).catch(() => {
        console.error('[v0] Failed to release image generation allowance')
      })
    }
    console.error('[v0] Image generation failed', error)
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    const authenticationFailed = error instanceof AgnesApiError && (error.status === 401 || error.status === 403)
    const status = authenticationFailed ? 503 : error instanceof AgnesApiError && error.status === 429 ? 429 : 502
    const message = timedOut
      ? 'Image generation took too long. Try a shorter prompt.'
      : authenticationFailed
        ? 'CTECH AI could not connect to its image service. Please try again later.'
        : error instanceof AgnesApiError && error.status === 429
          ? 'CTECH AI image generation is temporarily busy. Try again later.'
          : 'The image could not be generated. Try a more specific prompt.'
    return Response.json({ error: message }, { status })
  }
}
