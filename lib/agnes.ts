import 'server-only'

import { createOpenAI } from '@ai-sdk/openai'

export type AgnesContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type AgnesChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | AgnesContentPart[]
}

export const AGNES_CHAT_MODEL = 'agnes-2.5-flash'
export const AGNES_IMAGE_MODEL = 'agnes-image-2.5-flash'

const AGNES_API_BASE_URL = 'https://apihub.agnes-ai.com/v1'

export class AgnesApiError extends Error {
  constructor(readonly status: number) {
    super(`Agnes API request failed (${status}).`)
    this.name = 'AgnesApiError'
  }
}

function getApiKey() {
  const key = process.env.AGNES_API_KEY
  if (!key) throw new Error('Agnes is not configured. Add AGNES_API_KEY to the project environment.')
  return key
}

export function createAgnesChatModel() {
  return createOpenAI({
    baseURL: AGNES_API_BASE_URL,
    apiKey: getApiKey(),
  }).chat(AGNES_CHAT_MODEL)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function extractCompletionText(payload: unknown) {
  const root = asRecord(payload)
  const choices = Array.isArray(root?.choices) ? root.choices : []
  const message = asRecord(asRecord(choices[0])?.message)
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => asRecord(part))
    .filter((part): part is Record<string, unknown> => part !== null && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
    .trim()
}

export async function createAgnesChatCompletion(options: {
  messages: AgnesChatMessage[]
  maxTokens: number
  signal: AbortSignal
}) {
  const response = await fetch(`${AGNES_API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AGNES_CHAT_MODEL,
      messages: options.messages,
      max_tokens: options.maxTokens,
    }),
    cache: 'no-store',
    signal: options.signal,
  })

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new AgnesApiError(response.status)
  const text = extractCompletionText(payload)
  if (!text) throw new Error('Agnes returned an empty response.')
  const responseModel = asRecord(payload)?.model

  return {
    text,
    model: typeof responseModel === 'string' ? responseModel : AGNES_CHAT_MODEL,
  }
}

export async function generateAgnesImage(prompt: string, signal: AbortSignal) {
  const response = await fetch(`${AGNES_API_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: AGNES_IMAGE_MODEL,
      prompt,
      size: '1K',
      ratio: '1:1',
      extra_body: { response_format: 'b64_json' },
    }),
    cache: 'no-store',
    signal,
  })

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new AgnesApiError(response.status)
  const data = asRecord(payload)?.data
  const firstImage = Array.isArray(data) ? asRecord(data[0]) : null
  const encodedImage = firstImage?.b64_json
  if (typeof encodedImage !== 'string' || !encodedImage) throw new Error('Agnes did not return an encoded image.')

  const dataUrlMatch = encodedImage.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
  return dataUrlMatch
    ? { base64: dataUrlMatch[2], mediaType: dataUrlMatch[1] }
    : { base64: encodedImage, mediaType: 'image/png' }
}
