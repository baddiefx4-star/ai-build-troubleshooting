import type { VoiceOption } from '@/lib/types'
import { DEFAULT_ELEVENLABS_VOICE_ID, DEFAULT_ELEVENLABS_VOICE_NAME } from '@/lib/voice-config'

const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export async function listElevenLabsVoices(): Promise<VoiceOption[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error('ElevenLabs is not configured.')

  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('ElevenLabs could not load voices.')

  const payload: unknown = await response.json()
  const rawVoices = payload && typeof payload === 'object' && 'voices' in payload && Array.isArray(payload.voices)
    ? payload.voices
    : []
  const voices: VoiceOption[] = rawVoices.flatMap((rawVoice) => {
    if (!rawVoice || typeof rawVoice !== 'object') return []
    const voice = rawVoice as { voice_id?: unknown; name?: unknown }
    if (typeof voice.voice_id !== 'string' || !VOICE_ID_PATTERN.test(voice.voice_id)) return []
    if (typeof voice.name !== 'string' || !voice.name.trim()) return []
    return [{ voiceId: voice.voice_id, voiceName: voice.name.trim().slice(0, 120) }]
  })

  const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID
  if (!voices.some((voice) => voice.voiceId === defaultVoiceId) && VOICE_ID_PATTERN.test(defaultVoiceId)) {
    voices.unshift({ voiceId: defaultVoiceId, voiceName: DEFAULT_ELEVENLABS_VOICE_NAME })
  }

  return voices
}

export function isValidElevenLabsVoiceId(value: string) {
  return VOICE_ID_PATTERN.test(value)
}
