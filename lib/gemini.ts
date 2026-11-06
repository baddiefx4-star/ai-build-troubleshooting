import 'server-only'

export type GeminiInputPart =
  | { type: 'text'; text: string }
  | { type: 'image' | 'document'; data: string; mime_type: string }

export type GeminiCitation = { title: string; url: string }

export const GEMINI_TEXT_MODEL = 'gemini-3.8-flash'

const INTERACTIONS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'

export class GeminiApiError extends Error {
  constructor(readonly status: number, readonly retryAfterMs?: number) {
    super(`Gemini request failed (${status}).`)
    this.name = 'GeminiApiError'
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  const delayMs = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(header) - Date.now()
  return Number.isFinite(delayMs) ? Math.min(Math.max(delayMs, 0), 2_500) : undefined
}

function getApiKey() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('Gemini is not configured. Add GEMINI_API_KEY to the project environment.')
  return key
}

export async function createGeminiInteraction(options: {
  input: GeminiInputPart[]
  systemInstruction: string
  useGoogleSearch: boolean
  signal: AbortSignal
}) {
  const response = await fetch(INTERACTIONS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': getApiKey(),
    },
    body: JSON.stringify({
      model: GEMINI_TEXT_MODEL,
      input: options.input,
      system_instruction: options.systemInstruction,
      ...(options.useGoogleSearch ? { tools: [{ type: 'google_search' }] } : {}),
    }),
    cache: 'no-store',
    signal: options.signal,
  })

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new GeminiApiError(response.status, parseRetryAfter(response.headers.get('retry-after')))
  if (!payload || typeof payload !== 'object') throw new Error('Gemini returned an unreadable response.')
  return payload
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function collectText(value: unknown, output: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output)
    return
  }

  const record = asRecord(value)
  if (!record) return
  if (record.type === 'text' && typeof record.text === 'string') {
    output.push(record.text)
    return
  }

  for (const key of ['steps', 'content', 'output', 'parts']) {
    if (record[key] !== undefined) collectText(record[key], output)
  }
}

function collectCitations(value: unknown, output: GeminiCitation[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectCitations(item, output)
    return
  }

  const record = asRecord(value)
  if (!record) return

  const candidates = [
    asRecord(record.url_citation),
    asRecord(record.web),
    record.type === 'url_citation' || record.type === 'google_search_result' ? record : null,
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate))

  for (const candidate of candidates) {
    const url = typeof candidate.url === 'string' ? candidate.url : typeof candidate.uri === 'string' ? candidate.uri : ''
    if (!url.startsWith('https://') && !url.startsWith('http://')) continue
    const title = typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim() : url
    output.push({ title: title.slice(0, 300), url })
  }

  for (const child of Object.values(record)) collectCitations(child, output)
}

export function formatGeminiInteraction(payload: unknown, includeSources: boolean) {
  const root = asRecord(payload)
  const interaction = asRecord(root?.interaction) ?? root
  if (!interaction) return ''

  const outputText = typeof interaction.output_text === 'string' ? interaction.output_text.trim() : ''
  const textParts: string[] = []
  if (!outputText) collectText(interaction.steps ?? interaction.output ?? interaction.content, textParts)
  const text = outputText || textParts.join('').trim()
  if (!includeSources) return text

  const found: GeminiCitation[] = []
  collectCitations(interaction, found)
  const uniqueSources = [...new Map(found.map((source) => [source.url, source])).values()].slice(0, 8)
  if (!uniqueSources.length) return text

  const sources = uniqueSources.map((source, index) => `${index + 1}. [${source.title.replace(/[\[\]]/g, '')}](${source.url})`).join('\n')
  return `${text}\n\nSources\n${sources}`
}

