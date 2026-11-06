import type { CommandActivity, Message } from '@/lib/types'

export type ChatStreamResult = {
  text: string
  messageId: string
  model?: string | null
  commandActivity: CommandActivity[]
}

export function limitChatTranscript(messages: Array<Pick<Message, 'role' | 'content'>>) {
  const maxMessageChars = 250_000
  const maxTranscriptChars = 350_000
  const result: Array<Pick<Message, 'role' | 'content'>> = []
  let totalChars = 0
  for (const message of messages.slice(-40).reverse()) {
    if (totalChars >= maxTranscriptChars) break
    const content = message.content.slice(0, Math.min(maxMessageChars, maxTranscriptChars - totalChars))
    result.push({ role: message.role, content })
    totalChars += content.length
  }
  return result.reverse()
}

type ChatStreamEvent =
  | { type: 'status'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'command-start'; activity: CommandActivity }
  | { type: 'command-complete'; activity: CommandActivity }
  | { type: 'result'; text: string; messageId: string; model?: string | null }
  | { type: 'error'; error: unknown }

function normalizeErrorMessage(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null
  if (typeof value === 'string' || typeof value === 'number') {
    const message = String(value).trim()
    return message ? message.slice(0, 1_000) : null
  }
  if (value instanceof Error) return normalizeErrorMessage(value.message, depth + 1)
  if (Array.isArray(value)) {
    const messages = value
      .map((item) => normalizeErrorMessage(item, depth + 1))
      .filter((message): message is string => Boolean(message))
    return messages.length ? messages.join('\n').slice(0, 1_000) : null
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['message', 'error', 'detail', 'reason', 'description', 'cause', 'errors']) {
      const message = normalizeErrorMessage(record[key], depth + 1)
      if (message) return message
    }
  }
  return null
}

export async function readChatStream(
  response: Response,
  onStatus: (label: string) => void,
  onDelta?: (text: string) => void,
  onCommandActivity?: (activity: CommandActivity) => void,
): Promise<ChatStreamResult> {
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => ({}))
    throw new Error(normalizeErrorMessage(data) || 'CTECH AI could not reply right now.')
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('The response stream is unavailable. Please try again.')

  const decoder = new TextDecoder()
  let buffer = ''
  let result: Omit<ChatStreamResult, 'commandActivity'> | null = null
  const commandActivity = new Map<string, CommandActivity>()

  const processEvent = (rawEvent: string) => {
    const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'))
    if (!dataLine) return

    let event: ChatStreamEvent
    try {
      event = JSON.parse(dataLine.slice(5).trimStart()) as ChatStreamEvent
    } catch {
      throw new Error('CTECH AI sent an unreadable response. Please try again.')
    }

    if (event.type === 'status' && typeof event.label === 'string') {
      onStatus(event.label)
      return
    }
    if (event.type === 'delta' && typeof event.text === 'string') {
      onDelta?.(event.text)
      return
    }
    if ((event.type === 'command-start' || event.type === 'command-complete') && event.activity && typeof event.activity.id === 'string') {
      commandActivity.set(event.activity.id, event.activity)
      onCommandActivity?.(event.activity)
      return
    }
    if (event.type === 'error') {
      throw new Error(normalizeErrorMessage(event.error) || 'CTECH AI could not reply right now.')
    }
    if (event.type === 'result' && typeof event.text === 'string' && typeof event.messageId === 'string') {
      result = { text: event.text, messageId: event.messageId, model: event.model }
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const event of events) processEvent(event)
  }

  buffer += decoder.decode()
  if (buffer.trim()) processEvent(buffer)
  const completedResult = result as Omit<ChatStreamResult, 'commandActivity'> | null
  if (!completedResult) throw new Error('CTECH AI finished without a response. Please try again.')
  return { ...completedResult, commandActivity: [...commandActivity.values()] }
}
