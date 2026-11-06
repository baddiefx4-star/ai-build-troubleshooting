import { getAuthenticatedSession } from '@/lib/auth-session'
import { isSameOriginRequest } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const maxDuration = 45

const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const SPEECH_TO_TEXT_ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text'

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })
  const session = await getAuthenticatedSession().catch(() => null)
  if (!session?.user) return Response.json({ error: 'Sign in to use voice transcription.' }, { status: 401 })

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return Response.json({ error: 'Voice transcription is not configured.' }, { status: 503 })

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > MAX_AUDIO_BYTES + 64_000) {
    return Response.json({ error: 'That recording is too long. Please try a shorter voice message.' }, { status: 413 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'Could not read the voice recording.' }, { status: 400 })
  }

  const audio = form.get('audio')
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: 'A voice recording is required.' }, { status: 400 })
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: 'That recording is too long. Please try a shorter voice message.' }, { status: 413 })
  }

  const requestForm = new FormData()
  requestForm.set('model_id', 'scribe_v2')
  requestForm.set('file', audio, audio.name || 'voice.webm')

  try {
    const response = await fetch(SPEECH_TO_TEXT_ENDPOINT, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: requestForm,
      cache: 'no-store',
      signal: AbortSignal.timeout(40_000),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || typeof data?.text !== 'string') {
      return Response.json({ error: 'ElevenLabs could not transcribe that recording. Try again.' }, { status: 502 })
    }
    return Response.json({ text: data.text.trim() })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return Response.json({ error: timedOut ? 'Voice transcription took too long. Try a shorter recording.' : 'Could not reach the transcription service.' }, { status: 504 })
  }
}
