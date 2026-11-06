import 'server-only'

type MeganApiResponse = {
  status?: { success?: unknown }
  data?: { status?: unknown; result?: unknown; model?: unknown }
}

const MEGAN_ENDPOINT = 'https://apis.megan.qzz.io/api/ai/openhermes'
const MAX_MEGAN_REQUEST_URL_LENGTH = 6_000

export class MeganPromptTooLongError extends Error {
  constructor() {
    super('Megan prompt exceeds the safe request URL length.')
    this.name = 'MeganPromptTooLongError'
  }
}

export function isMeganPromptWithinUrlLimit(prompt: string) {
  const url = new URL(MEGAN_ENDPOINT)
  url.searchParams.set('q', prompt)
  url.searchParams.set('api_key', process.env.api_key ?? '')
  return url.toString().length <= MAX_MEGAN_REQUEST_URL_LENGTH
}

export async function generateMeganReply(prompt: string, signal: AbortSignal) {
  const apiKey = process.env.api_key
  if (!apiKey) throw new Error('Megan API key is not configured.')

  const url = new URL(MEGAN_ENDPOINT)
  url.searchParams.set('q', prompt)
  url.searchParams.set('api_key', apiKey)
  if (url.toString().length > MAX_MEGAN_REQUEST_URL_LENGTH) throw new MeganPromptTooLongError()

  let response: Response
  try {
    response = await fetch(url, { method: 'GET', cache: 'no-store', signal })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error('Could not connect to the Megan AI API.')
  }

  if (!response.ok) throw new Error(`Megan AI API returned HTTP ${response.status}.`)

  const payload = await response.json().catch(() => null) as MeganApiResponse | null
  if (payload?.status?.success !== true || payload.data?.status !== true || typeof payload.data.result !== 'string') {
    throw new Error('Megan AI API returned an invalid response.')
  }

  const text = payload.data.result.trim()
  if (!text) throw new Error('Megan AI API returned an empty response.')

  return {
    text,
    model: typeof payload.data.model === 'string' ? payload.data.model : 'OpenHermes',
  }
}
