'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ArrowLeft, Settings2 } from 'lucide-react'
import type { VoiceOption, VoicePreference } from '@/lib/types'
import { DEFAULT_ELEVENLABS_VOICE_ID, DEFAULT_ELEVENLABS_VOICE_NAME } from '@/lib/voice-config'

const DEFAULT_VOICE: VoicePreference = { voiceId: DEFAULT_ELEVENLABS_VOICE_ID, voiceName: DEFAULT_ELEVENLABS_VOICE_NAME }

type VoiceOptionsResponse = { voices: VoiceOption[] }

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || 'Could not load voice settings.')
  return data as T
}

export function VoiceSettings() {
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE.voiceId)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const { data: preference, error: preferenceError, mutate: mutatePreference } = useSWR<VoicePreference>(
    '/api/preferences/voice',
    fetchJson,
    { fallbackData: DEFAULT_VOICE, revalidateOnFocus: false },
  )
  const { data: voiceOptions, error: optionsError, isLoading: optionsLoading } = useSWR<VoiceOptionsResponse>(
    '/api/preferences/voice/options',
    fetchJson,
    { revalidateOnFocus: false },
  )

  useEffect(() => {
    if (preference) setVoiceId(preference.voiceId)
  }, [preference])

  const selectedVoice = voiceOptions?.voices.find((voice) => voice.voiceId === voiceId)
  const selectedPreference = voiceOptions?.voices.find((voice) => voice.voiceId === preference?.voiceId)

  const saveVoice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedVoice || saving) return
    setSaving(true)
    setSaveError(null)
    setSaveMessage(null)

    try {
      const response = await fetch('/api/preferences/voice', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: selectedVoice.voiceId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Could not save the voice selection.')
      await mutatePreference(data as VoicePreference, false)
      setSaveMessage(`${selectedVoice.voiceName} is now your voice.`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the voice selection.')
    } finally {
      setSaving(false)
    }
  }

  const loadError = optionsError || preferenceError

  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <Link href="/" className="inline-flex w-fit items-center gap-2 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to chat
        </Link>

        <header className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Preferences</p>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">Manage how CTECH AI sounds when it reads responses and during live voice conversations.</p>
        </header>

        <section aria-labelledby="voice-settings-heading" className="rounded-2xl border border-border bg-card p-5 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Settings2 className="size-5" aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-1">
              <h2 id="voice-settings-heading" className="text-lg font-semibold">Voice</h2>
              <p className="text-sm leading-6 text-muted-foreground">Choose the voice CTECH AI uses for read-aloud and live voice.</p>
            </div>
          </div>

          <form onSubmit={saveVoice} className="mt-7 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="ctech-voice" className="text-sm font-medium">Voice</label>
              {optionsLoading ? (
                <p role="status" className="text-sm text-muted-foreground">Loading available voices…</p>
              ) : loadError ? (
                <p role="alert" className="text-sm text-destructive">{loadError.message}</p>
              ) : (
                <select
                  id="ctech-voice"
                  value={voiceId}
                  onChange={(event) => {
                    setVoiceId(event.target.value)
                    setSaveError(null)
                    setSaveMessage(null)
                  }}
                  disabled={!voiceOptions?.voices.length || saving}
                  className="w-full rounded-xl border border-input bg-background px-3 py-3 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {voiceOptions?.voices.map((voice) => (
                    <option key={voice.voiceId} value={voice.voiceId}>{voice.voiceName}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={saving || !selectedVoice || selectedVoice.voiceId === selectedPreference?.voiceId}
                className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save voice'}
              </button>
              {saveMessage && <p role="status" className="text-sm text-muted-foreground">{saveMessage}</p>}
              {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}
