import { z } from 'zod'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { getVoicePreference, saveVoicePreference } from '@/lib/chat-store'
import { listElevenLabsVoices, isValidElevenLabsVoiceId } from '@/lib/elevenlabs-voices'
import { readJsonRequest, RequestBodyTooLargeError } from '@/lib/request-body'
import { isSameOriginRequest } from '@/lib/request-origin'
import type { VoiceOption } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const voicePreferenceSchema = z.object({
  voiceId: z.string().trim().min(1).max(128).refine(isValidElevenLabsVoiceId),
}).strict()

export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })
  const session = await getAuthenticatedSession().catch(() => null)
  if (!session?.user) return Response.json({ error: 'Sign in to load voice preferences.' }, { status: 401 })

  try {
    return Response.json(await getVoicePreference(session.user.id), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return Response.json({ error: 'Could not load voice preferences.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })
  const session = await getAuthenticatedSession().catch(() => null)
  if (!session?.user) return Response.json({ error: 'Sign in to save voice preferences.' }, { status: 401 })

  let rawBody: unknown
  try {
    rawBody = await readJsonRequest(request, 2_000)
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400
    return Response.json({ error: 'Choose a supported assistant voice.' }, { status })
  }

  const parsed = voicePreferenceSchema.safeParse(rawBody)
  if (!parsed.success) return Response.json({ error: 'Choose a supported assistant voice.' }, { status: 400 })

  let voices: VoiceOption[]
  try {
    voices = await listElevenLabsVoices()
  } catch {
    return Response.json({ error: 'Could not verify the selected ElevenLabs voice.' }, { status: 502 })
  }

  const selectedVoice = voices.find((voice) => voice.voiceId === parsed.data.voiceId)
  if (!selectedVoice) return Response.json({ error: 'Choose a voice from your ElevenLabs account.' }, { status: 400 })

  try {
    const preference = await saveVoicePreference(session.user.id, selectedVoice)
    return Response.json(preference, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return Response.json({ error: 'Could not save the selected voice.' }, { status: 500 })
  }
}
