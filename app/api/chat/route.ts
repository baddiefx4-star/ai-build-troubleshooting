import { randomUUID } from 'node:crypto'
import { generateText, isStepCount, streamText, tool, type ModelMessage } from 'ai'
import { z } from 'zod'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { consumePrimaryModelAllowance, releasePrimaryModelAllowance } from '@/lib/billing/service'
import { getProject, isValidConversationId, normalizeMode, rememberAssistantReply, rememberConversation, sanitizeMessages } from '@/lib/chat-store'
import { readJsonRequest, RequestBodyTooLargeError } from '@/lib/request-body'
import { isSameOriginRequest } from '@/lib/request-origin'
import { analyzePublicWebsite } from '@/lib/site-analysis'
import { isOwnerEmail } from '@/lib/owner'
import { isMeganPromptWithinUrlLimit, MeganPromptTooLongError } from '@/lib/megan-ai'
import { AgnesApiError, createAgnesChatModel, type AgnesContentPart } from '@/lib/agnes'
import { runSandboxTerminalCommand, SandboxRateLimitError, SandboxUnavailableError } from '@/lib/sandbox-terminal'
import { createGeminiInteraction, formatGeminiInteraction, GeminiApiError, type GeminiInputPart } from '@/lib/gemini'
import { buildCurrentTimeContext, buildOpenHermesPrompt, buildProjectMemoryContext, buildPrompt } from '@/lib/prompt'
import type { CommandActivity } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_REQUEST_BYTES = 16 * 1024 * 1024
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_BINARY_TOTAL_BYTES = 8 * 1024 * 1024
const MAX_TEXT_TOTAL_CHARS = 150_000
const ALLOWED_BINARY_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'mdx', 'csv', 'json', 'ipynb', 'xml', 'yaml', 'yml', 'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'dart', 'c', 'h', 'cpp', 'hpp', 'rb', 'php', 'sh', 'ps1', 'sql', 'graphql', 'gql', 'proto', 'tf', 'hcl', 'env', 'log', 'toml', 'ini', 'conf', 'properties', 'dockerfile'])

const attachmentSchema = z.object({
  name: z.string().min(1).max(255),
  mediaType: z.string().min(1).max(120),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  text: z.string().max(100_000).optional(),
  dataUrl: z.string().max(5_800_000).optional(),
}).strict()

const requestSchema = z.object({
  conversationId: z.string().min(1).max(80),
  projectId: z.string().min(1).max(80),
  messages: z.array(z.unknown()).max(40),
  mode: z.enum(['chat', 'code', 'reason', 'creative', 'research']).optional(),
  voice: z.boolean().optional(),
  timeZone: z.string().trim().min(1).max(64).optional(),
  attachments: z.array(attachmentSchema).max(5).optional(),
}).strict()

type AttachmentInput = z.infer<typeof attachmentSchema>
type ValidatedAttachment = {
  name: string
  mediaType: string
  text?: string
  bytes?: Buffer
}

type AgnesGenerationMessage = {
  role: 'user' | 'assistant'
  content: string | AgnesContentPart[]
}

type StreamEvent =
  | { type: 'status'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'command-start'; activity: CommandActivity }
  | { type: 'command-complete'; activity: CommandActivity }
  | { type: 'result'; text: string; messageId: string; model: string | null }
  | { type: 'error'; error: string }

type SendEvent = (event: StreamEvent) => void

function createEventStream(run: (send: SendEvent) => Promise<void>, requestId: string) {
  let cancelled = false
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send: SendEvent = (event) => {
        if (cancelled) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      void run(send)
        .catch((error) => {
          console.error(`[v0] Chat stream failed (${requestId})`, error)
          send({ type: 'error', error: `CTECH AI could not complete this request. Please try again. Reference ID: ${requestId}` })
        })
        .finally(() => {
          if (!cancelled) controller.close()
        })
    },
    cancel() {
      cancelled = true
    },
  })

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  })
}

function rawMessageContent(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const content = (value as { content?: unknown }).content
  return typeof content === 'string' ? content : undefined
}

function validateAttachments(inputs: AttachmentInput[]): { attachments?: ValidatedAttachment[]; error?: string } {
  const attachments: ValidatedAttachment[] = []
  let binaryBytes = 0
  let textChars = 0

  for (const input of inputs) {
    const name = input.name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255)
    const extension = name.split('.').pop()?.toLowerCase() ?? ''
    const mediaType = input.mediaType.toLowerCase()

    if (input.text !== undefined) {
      if (input.dataUrl !== undefined || (!mediaType.startsWith('text/') && mediaType !== 'application/json' && !TEXT_EXTENSIONS.has(extension))) {
        return { error: 'Upload a PDF, image, or text/code file.' }
      }
      if (Buffer.byteLength(input.text, 'utf8') > MAX_FILE_BYTES) return { error: 'Each text file must be 4 MB or smaller.' }
      textChars += input.text.length
      if (textChars > MAX_TEXT_TOTAL_CHARS) return { error: 'The combined text in your uploaded files is too large.' }
      attachments.push({ name, mediaType: mediaType || 'text/plain', text: input.text })
      continue
    }

    if (!input.dataUrl) return { error: 'An uploaded file could not be read. Please try again.' }
    const match = /^data:([^;,]+);base64,([a-z0-9+/]+={0,2})$/i.exec(input.dataUrl)
    if (!match || match[1].toLowerCase() !== mediaType || !ALLOWED_BINARY_TYPES.has(mediaType)) {
      return { error: 'Upload a PDF, PNG, JPEG, WebP, GIF, or text/code file.' }
    }

    const bytes = Buffer.from(match[2], 'base64')
    if (bytes.byteLength !== input.size || bytes.byteLength > MAX_FILE_BYTES) return { error: 'Each uploaded file must be 4 MB or smaller.' }
    binaryBytes += bytes.byteLength
    if (binaryBytes > MAX_BINARY_TOTAL_BYTES) return { error: 'Keep the combined size of uploaded PDFs and images under 8 MB.' }
    attachments.push({ name, mediaType, bytes })
  }

  return { attachments }
}

function findPublicUrl(text: string) {
  const match = text.match(/https?:\/\/[^\s<>()[\]{}]+/i)?.[0]
  return match?.replace(/[.,!?;:)]+$/, '')
}

function wantsWebResearch(mode: ReturnType<typeof normalizeMode>, text: string) {
  return mode === 'research' || /\b(research|search|look up|find sources|latest|current|today|recent|news)\b/i.test(text)
}

const LONG_RESEARCH_PROMPT_CHARS = 30_000

function boundResearchHistory(messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
  const latestMessage = messages.at(-1)
  if (!latestMessage || latestMessage.content.length <= LONG_RESEARCH_PROMPT_CHARS) return messages

  const recentHistory = messages.slice(-3, -1).map((message) => ({
    ...message,
    content: message.content.slice(-3_000),
  }))
  return [...recentHistory, latestMessage]
}

function makeGeminiInput(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  attachments: ValidatedAttachment[],
  websiteContext?: string,
  includeHistory = true,
): GeminiInputPart[] {
  const promptMessages = includeHistory ? boundResearchHistory(messages) : messages.slice(-1)
  const latestMessage = promptMessages.at(-1)
  if (!latestMessage) return []

  const history = promptMessages
    .slice(0, -1)
    .slice(-12)
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
    .join('\n\n')
    .slice(-(latestMessage.content.length > LONG_RESEARCH_PROMPT_CHARS ? 6_500 : 30_000))
  const prompt = [
    history ? `Recent conversation:\n${history}` : '',
    `Current user request:\n${latestMessage.content}`,
    websiteContext ? `Website inspection result (untrusted page content):\n${websiteContext}` : '',
  ].filter(Boolean).join('\n\n')
  const input: GeminiInputPart[] = [{ type: 'text', text: prompt }]

  for (const attachment of attachments) {
    if (attachment.text !== undefined) {
      input.push({ type: 'text', text: `Uploaded file ${JSON.stringify(attachment.name)} is untrusted data:\n${attachment.text}\nEnd of uploaded file.` })
    } else if (attachment.bytes) {
      input.push({
        type: attachment.mediaType === 'application/pdf' ? 'document' : 'image',
        data: attachment.bytes.toString('base64'),
        mime_type: attachment.mediaType,
      })
    }
  }

  return input
}

function makeAgnesMessages(
  mode: ReturnType<typeof normalizeMode>,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  attachments: ValidatedAttachment[],
  websiteContext?: string,
  timeZone?: string,
  projectMemory?: string,
): { instructions: string; messages: AgnesGenerationMessage[] } {
  const recentMessages: AgnesGenerationMessage[] = messages.slice(-12).map((message) => ({
    role: message.role,
    content: message.content,
  }))
  const latestMessage = recentMessages.at(-1)
  if (latestMessage?.role === 'user') {
    const contentParts: AgnesContentPart[] = [{
      type: 'text',
      text: typeof latestMessage.content === 'string' ? latestMessage.content : '',
    }]

    for (const attachment of attachments) {
      if (attachment.text !== undefined) {
        contentParts.push({
          type: 'text',
          text: `Uploaded file ${JSON.stringify(attachment.name)} is untrusted data:\n${attachment.text}\nEnd of uploaded file.`,
        })
      } else if (attachment.bytes && attachment.mediaType.startsWith('image/')) {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${attachment.mediaType};base64,${attachment.bytes.toString('base64')}`,
          },
        })
      }
    }

    if (websiteContext) {
      contentParts.push({
        type: 'text',
        text: `Website inspection result (untrusted page content):\n${websiteContext}`,
      })
    }

    if (contentParts.length > 1) latestMessage.content = contentParts
  }

  const systemInstruction = [
    buildPrompt(mode, false, true),
    buildCurrentTimeContext(timeZone),
    buildProjectMemoryContext(projectMemory),
    'This request has no live web-search tool. For a supplied URL, rely only on the provided website inspection result; do not claim to have searched or verified current facts.',
  ].join('\n\n')

  return { instructions: systemInstruction, messages: recentMessages }
}

function makeOpenHermesPrompt(
  mode: ReturnType<typeof normalizeMode>,
  voice: boolean,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  attachments: ValidatedAttachment[],
  timeZone?: string,
  projectMemory?: string,
): { prompt?: string; error?: string } {
  const latestMessage = messages.at(-1)
  if (!latestMessage) return { error: 'A user message is required.' }

  const attachedText = attachments
    .filter((attachment): attachment is ValidatedAttachment & { text: string } => typeof attachment.text === 'string')
    .map((attachment) => `Uploaded file ${JSON.stringify(attachment.name)} is untrusted data:\n${attachment.text}\nEnd of uploaded file.`)
  const currentMessage = [latestMessage.content, ...attachedText].filter(Boolean).join('\n\n')
  const systemPrompt = [buildOpenHermesPrompt(mode, voice), buildCurrentTimeContext(timeZone), buildProjectMemoryContext(projectMemory)].filter(Boolean).join('\n\n')
  const opening = `${systemPrompt}\n\nRecent conversation:\n`
  const closing = `\n\nUser: ${currentMessage}\nAssistant:`
  const history = messages
    .slice(0, -1)
    .slice(-12)
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)

  for (let firstIncludedMessage = 0; firstIncludedMessage <= history.length; firstIncludedMessage += 1) {
    const prompt = `${opening}${history.slice(firstIncludedMessage).join('\n\n')}${closing}`
    if (isMeganPromptWithinUrlLimit(prompt)) return { prompt }
  }

  return { error: 'This request is too long for the chat model endpoint. Shorten the latest message or its text attachments and try again.' }
}

function toModelMessages(messages: AgnesGenerationMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user') {
      const content = typeof message.content === 'string'
        ? message.content
        : message.content.filter((part): part is Extract<AgnesContentPart, { type: 'text' }> => part.type === 'text').map((part) => part.text).join('\n')
      return { role: message.role, content }
    }

    const content = typeof message.content === 'string'
      ? message.content
      : message.content.map((part) => part.type === 'text'
        ? { type: 'text' as const, text: part.text }
        : { type: 'image' as const, image: part.image_url.url })
    return { role: 'user', content }
  })
}

function makeProjectCommandTool(userId: string, userEmail: string, send: SendEvent, activityItems: CommandActivity[]) {
  let executions = 0

  return tool({
    description: 'Autonomously run a short development command when needed to inspect, test, or troubleshoot the supplied project snapshot. Use normal local shell commands, tests, linters, formatters, typechecks, and available package-manager scripts. This runs in a disposable, network-disabled sandbox with no app secrets; changes are discarded. Never target live or third-party systems or access credentials.',
    inputSchema: z.object({
      command: z.string().trim().min(1).max(1_000).describe('A concise local development command selected by the assistant when needed, such as a test, lint, format, typecheck, script, or package-manager command.'),
    }),
    execute: async ({ command }) => {
      if (executions >= 2) {
        const activity: CommandActivity = {
          id: randomUUID(),
          command,
          status: 'error',
          exitCode: 1,
          stderr: 'This request has reached its limit of two isolated project commands.',
          timedOut: false,
        }
        activityItems.push(activity)
        send({ type: 'command-complete', activity })
        return { command, error: activity.stderr }
      }

      executions += 1
      const id = randomUUID()
      const running: CommandActivity = { id, command, status: 'running' }
      const activityIndex = activityItems.push(running) - 1
      send({ type: 'command-start', activity: running })
      send({ type: 'status', label: 'Running command…' })

      try {
        const result = await runSandboxTerminalCommand(userId, userEmail, command)
        const completed: CommandActivity = { id, ...result, status: 'completed' }
        activityItems[activityIndex] = completed
        send({ type: 'command-complete', activity: completed })
        return result
      } catch (error) {
        const message = error instanceof SandboxRateLimitError || error instanceof SandboxUnavailableError
          ? error.message
          : 'The isolated project command could not be started.'
        if (!(error instanceof SandboxRateLimitError || error instanceof SandboxUnavailableError)) {
          console.error('[v0] Isolated project command failed')
        }
        const failed: CommandActivity = { id, command, status: 'error', exitCode: 1, stderr: message, timedOut: false }
        activityItems[activityIndex] = failed
        send({ type: 'command-complete', activity: failed })
        return { command, error: message }
      } finally {
        send({ type: 'status', label: 'Thinking…' })
      }
    },
  })
}

function getAgnesApiErrorStatus(error: unknown) {
  if (error instanceof AgnesApiError) return error.status
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return null

  const status = Number((error as { statusCode?: unknown }).statusCode)
  return Number.isInteger(status) ? status : null
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })

  let session: Awaited<ReturnType<typeof getAuthenticatedSession>>
  try {
    session = await getAuthenticatedSession()
  } catch {
    return Response.json({ error: 'Could not verify your account session.' }, { status: 503 })
  }
  if (!session?.user) return Response.json({ error: 'Sign in to continue.' }, { status: 401 })

  let rawBody: unknown
  try {
    rawBody = await readJsonRequest(req, MAX_REQUEST_BYTES)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: 'This request is too large. Reduce the number or size of attachments.' }, { status: 413 })
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(rawBody)
  if (!parsed.success) return Response.json({ error: 'The request format is invalid. Check your message and attachments.' }, { status: 400 })
  if (!isValidConversationId(parsed.data.conversationId)) return Response.json({ error: 'A valid conversation is required.' }, { status: 400 })
  if (!isValidConversationId(parsed.data.projectId)) return Response.json({ error: 'Choose a valid project.' }, { status: 400 })
  const rawLatest = rawMessageContent(parsed.data.messages.at(-1))
  if (rawLatest && rawLatest.length > 250_000) return Response.json({ error: 'Messages can be up to 250,000 characters. Split this into a few messages or attach a text file.' }, { status: 413 })

  const messages = sanitizeMessages(parsed.data.messages)
  const latestMessage = messages[messages.length - 1]
  if (!latestMessage || latestMessage.role !== 'user') return Response.json({ error: 'A user message is required.' }, { status: 400 })

  const attachmentResult = validateAttachments(parsed.data.attachments ?? [])
  if (!attachmentResult.attachments) return Response.json({ error: attachmentResult.error }, { status: 400 })
  const validatedAttachments = attachmentResult.attachments ?? []

  const mode = normalizeMode(parsed.data.mode)
  const voice = parsed.data.voice === true
  const userId = session.user.id
  const requestId = randomUUID()
  let project = null
  try {
    project = await getProject(userId, parsed.data.projectId)
  } catch {
    return Response.json({ error: 'Could not load this project.' }, { status: 503 })
  }
  if (!project) return Response.json({ error: 'Project not found.' }, { status: 404 })

  return createEventStream(async (send) => {
    const commandActivity: CommandActivity[] = []
    send({ type: 'status', label: 'Thinking…' })

    try {
      await rememberConversation(userId, parsed.data.conversationId, parsed.data.projectId, mode, messages)
    } catch {
      send({ type: 'error', error: 'Could not save this conversation. Please try again.' })
      return
    }

    send({ type: 'status', label: voice ? 'Listening and thinking…' : 'Thinking…' })

    let usageEventId: string | null = null
    try {
      const isOwner = isOwnerEmail(session.user.email)
      const hasPdfAttachment = validatedAttachments.some((attachment) => attachment.bytes && attachment.mediaType === 'application/pdf')
      const latestUserText = messages.at(-1)?.content ?? ''
      const websiteUrl = findPublicUrl(latestUserText)
      const useGoogleSearch = !voice && wantsWebResearch(mode, latestUserText)
      const needsGemini = !voice && (useGoogleSearch || hasPdfAttachment)
      let openHermesPrompt = ''

      if (voice) {
        const prompt = makeOpenHermesPrompt(mode, voice, messages, validatedAttachments, parsed.data.timeZone, project.memory)
        if (!prompt.prompt) {
          send({ type: 'error', error: prompt.error ?? 'The request could not be prepared.' })
          return
        }
        openHermesPrompt = prompt.prompt
      }

      const allowance = isOwner ? null : await consumePrimaryModelAllowance(userId, session.user.email)
      usageEventId = allowance?.usageEventId ?? null

      if (allowance?.tier === 'mini') {
        const minutesUntilReset = allowance.resetAt
          ? Math.max(1, Math.ceil((allowance.resetAt.getTime() - Date.now()) / 60_000))
          : null
        const resetMessage = minutesUntilReset ? ` It resets in about ${minutesUntilReset} minutes.` : ''
        send({
          type: 'error',
          error: `Your ${allowance.limit}-request AI allowance has been used up.${resetMessage} View Plans to upgrade or wait for the reset.`,
        })
        return
      }

      let websiteContext = ''
      if (!voice && websiteUrl) {
        try {
          const site = await analyzePublicWebsite(websiteUrl)
          websiteContext = JSON.stringify(site)
        } catch (error) {
          websiteContext = `The provided URL could not be inspected: ${error instanceof Error ? error.message : 'unknown error'}. Do not claim to have read the page.`
        }
      }

      if (needsGemini) {
        const signal = AbortSignal.any([req.signal, AbortSignal.timeout(108_000)])
        const systemInstruction = [
          buildPrompt(mode, false),
          buildCurrentTimeContext(parsed.data.timeZone),
          buildProjectMemoryContext(project.memory),
          useGoogleSearch
            ? 'Google Search is available for this response. Use it for current claims and cite grounded sources.'
            : 'Live Google Search is not enabled for this response. Do not claim to have searched or verified current facts.',
        ].join('\n\n')
        let interaction: unknown
        try {
          interaction = await createGeminiInteraction({
            input: makeGeminiInput(messages, validatedAttachments, websiteContext || undefined),
            systemInstruction,
            useGoogleSearch,
            signal,
          })
        } catch (error) {
          if (!(error instanceof GeminiApiError && error.status === 429)) throw error

          send({
            type: 'status',
            label: useGoogleSearch ? 'Research is rate-limited — retrying live search…' : 'Research is rate-limited — retrying…',
          })
          await new Promise((resolve) => setTimeout(resolve, error.retryAfterMs ?? 1_500))
          try {
            interaction = await createGeminiInteraction({
              input: makeGeminiInput(messages, validatedAttachments, websiteContext || undefined, false),
              systemInstruction,
              useGoogleSearch,
              signal,
            })
          } catch (retryError) {
            if (!(retryError instanceof GeminiApiError && retryError.status === 429)) throw retryError

            send({ type: 'status', label: 'Live search is busy — answering with CTECH AI now…' })
            const fallbackPrompt = makeAgnesMessages(
              mode,
              messages,
              validatedAttachments,
              websiteContext || undefined,
              parsed.data.timeZone,
              project.memory,
            )
            const fallbackReply = await generateText({
              model: createAgnesChatModel(),
              instructions: `${fallbackPrompt.instructions}\n\nLive search is temporarily unavailable. Answer helpfully from your existing knowledge, and do not claim to have searched or verified current facts.`,
              messages: toModelMessages(fallbackPrompt.messages),
              tools: {
                run_project_command: makeProjectCommandTool(userId, session.user.email, send, commandActivity),
              },
              stopWhen: isStepCount(3),
              maxOutputTokens: mode === 'code' ? 8_192 : 6_144,
              abortSignal: signal,
            })
            const fallbackText = fallbackReply.text.trim()
            if (!fallbackText) throw new Error('CTECH AI returned an empty response.')
            const messageId = await rememberAssistantReply(userId, parsed.data.conversationId, mode, fallbackText, commandActivity)
            usageEventId = null
            send({ type: 'result', text: fallbackText, messageId, model: 'CTECH AI' })
            return
          }
        }

        const text = formatGeminiInteraction(interaction, useGoogleSearch)
        if (!text) throw new Error('Gemini returned an empty response.')
        const messageId = await rememberAssistantReply(userId, parsed.data.conversationId, mode, text)
        usageEventId = null
        send({ type: 'result', text, messageId, model: 'CTECH Research' })
        return
      }

      if (!voice) {
        const agnesPrompt = makeAgnesMessages(mode, messages, validatedAttachments, websiteContext || undefined, parsed.data.timeZone, project.memory)
        const reply = streamText({
          model: createAgnesChatModel(),
          instructions: agnesPrompt.instructions,
          messages: toModelMessages(agnesPrompt.messages),
          tools: {
            run_project_command: makeProjectCommandTool(userId, session.user.email, send, commandActivity),
          },
          stopWhen: isStepCount(3),
          maxOutputTokens: mode === 'code' ? 8_192 : 6_144,
          abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(108_000)]),
        })
        let text = ''
        for await (const delta of reply.textStream) {
          text += delta
          send({ type: 'delta', text: delta })
        }
        text = text.trim()
        if (!text) throw new Error('Agnes returned an empty response.')
        const messageId = await rememberAssistantReply(userId, parsed.data.conversationId, mode, text, commandActivity)
        usageEventId = null
        send({ type: 'result', text, messageId, model: 'CTECH AI' })
        return
      }

      const reply = streamText({
        model: createAgnesChatModel(),
        prompt: openHermesPrompt,
        maxOutputTokens: 1_024,
        abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(108_000)]),
      })
      let text = ''
      for await (const delta of reply.textStream) {
        text += delta
        send({ type: 'delta', text: delta })
      }
      text = text.trim()
      if (!text) throw new Error('CTECH AI returned an empty voice response.')
      const messageId = await rememberAssistantReply(userId, parsed.data.conversationId, mode, text)
      usageEventId = null
      send({ type: 'result', text, messageId, model: 'CTECH AI Voice' })
    } catch (error) {
      if (usageEventId) {
        try {
          await releasePrimaryModelAllowance(userId, usageEventId)
        } catch {
          console.error(`[v0] Failed to release chat allowance (${requestId})`)
        }
      }
      console.error(`[v0] Chat generation failed (${requestId})`, error)
      const agnesStatus = getAgnesApiErrorStatus(error)
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      const oversizedMeganRequest = error instanceof MeganPromptTooLongError
        || (error instanceof Error && error.message === 'Megan AI API returned HTTP 414.')
      const message = timedOut
        ? 'This request took too long. Try a smaller prompt or fewer files.'
        : oversizedMeganRequest
          ? 'This request is too long for the chat model endpoint. Shorten the latest message or start a new chat.'
          : error instanceof Error && error.message.startsWith('Agnes is not configured.')
            ? 'CTECH AI chat is temporarily unavailable. Please try again later.'
            : agnesStatus === 401 || agnesStatus === 403
              ? 'CTECH AI could not connect to its response service. Please try again later.'
              : agnesStatus === 429
              ? 'CTECH AI is temporarily busy. Try again later.'
              : error instanceof Error && error.message.startsWith('Gemini is not configured.')
                ? 'CTECH Research is temporarily unavailable. Please try again later.'
                : error instanceof GeminiApiError && error.status === 429
                  ? 'CTECH Research is still rate-limited. No answer was sent without live search; please try again in a moment.'
                  : 'CTECH AI could not complete this request. Please try again.'
      send({ type: 'error', error: `${message} Reference ID: ${requestId}` })
    }
  }, requestId)
}
