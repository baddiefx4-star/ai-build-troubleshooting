import { getAuthenticatedSession } from '@/lib/auth-session'
import { getVoicePreference } from '@/lib/chat-store'
import { DEFAULT_ELEVENLABS_VOICE_ID } from '@/lib/voice-config'
import { isSameOriginRequest } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })
  const session = await getAuthenticatedSession().catch(() => null)
  if (!session?.user) return Response.json({ error: 'Sign in to use voice synthesis.' }, { status: 401 })

  if (Number(req.headers.get('content-length') || 0) > 16_384) {
    return Response.json({ error: 'This speech request is too large.' }, { status: 413 })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'ELEVENLABS_API_KEY is not configured.' }, { status: 501 })
  }

  let body: { text?: unknown }
  try {
    const rawBody = await req.text()
    if (rawBody.length > 16_384) return Response.json({ error: 'This speech request is too large.' }, { status: 413 })
    const parsed: unknown = JSON.parse(rawBody)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body')
    body = parsed as typeof body
  } catch {
    return Response.json({ error: 'Invalid speech request.' }, { status: 400 })
  }

  const text = body.text
  if (typeof text !== 'string' || !text.trim() || text.length > 2_500) {
    return Response.json({ error: 'Enter text of up to 2,500 characters.' }, { status: 400 })
  }

  const preference = await getVoicePreference(session.user.id).catch(() => null)
  const voiceId = preference?.voiceId || process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: text.slice(0, 2500),
        model_id: 'eleven_flash_v2_5',
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
      }),
    },
  )

  if (!res.ok || !res.body) {
    return Response.json({ error: `ElevenLabs could not synthesize speech (${res.status}).` }, { status: 502 })
  }

  return new Response(res.body, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store' },
  })
}
