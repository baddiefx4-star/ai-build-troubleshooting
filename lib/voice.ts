'use client'

export async function transcribeAudio(audio: Blob): Promise<string> {
  const form = new FormData()
  const extension = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : audio.type.includes('wav') ? 'wav' : 'webm'
  form.append('audio', audio, `voice.${extension}`)
  const response = await fetch('/api/transcribe', { method: 'POST', body: form })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Could not transcribe audio.')
  return typeof payload.text === 'string' ? payload.text.trim() : ''
}

export function toSpeakable(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

let sharedAudio: HTMLAudioElement | null = null
let audioCtx: AudioContext | null = null
let outputAnalyser: AnalyserNode | null = null

export function getAudioContext() {
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

export function getOutputAnalyser() {
  return outputAnalyser
}

function getAudio() {
  if (!sharedAudio) {
    sharedAudio = new Audio()
    sharedAudio.crossOrigin = 'anonymous'
    try {
      const ctx = getAudioContext()
      const src = ctx.createMediaElementSource(sharedAudio)
      outputAnalyser = ctx.createAnalyser()
      outputAnalyser.fftSize = 256
      src.connect(outputAnalyser)
      outputAnalyser.connect(ctx.destination)
    } catch {
      outputAnalyser = null
    }
  }
  return sharedAudio
}

let currentAbort: AbortController | null = null

export function stopSpeaking() {
  currentAbort?.abort()
  currentAbort = null
  if (sharedAudio) {
    sharedAudio.pause()
    sharedAudio.removeAttribute('src')
  }
}

function splitSpeechText(text: string, maxChars = 2_300) {
  const chunks: string[] = []
  let remaining = text.trim()

  while (remaining.length > maxChars) {
    const punctuation = Math.max(
      remaining.lastIndexOf('. ', maxChars),
      remaining.lastIndexOf('! ', maxChars),
      remaining.lastIndexOf('? ', maxChars),
    )
    const whitespace = remaining.lastIndexOf(' ', maxChars)
    const boundary = punctuation > maxChars * 0.55 ? punctuation + 1 : whitespace > 0 ? whitespace : maxChars
    chunks.push(remaining.slice(0, boundary).trim())
    remaining = remaining.slice(boundary).trim()
  }

  if (remaining) chunks.push(remaining)
  return chunks
}

export async function speak(text: string): Promise<'elevenlabs' | 'aborted'> {
  stopSpeaking()
  const controller = new AbortController()
  currentAbort = controller
  const clean = toSpeakable(text)
  if (!clean) return 'aborted'

  try {
    const audio = getAudio()
    for (const chunk of splitSpeechText(clean)) {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error('tts-unavailable')
      const blob = await res.blob()
      if (controller.signal.aborted) return 'aborted'
      const url = URL.createObjectURL(blob)
      audio.src = url
      const played = await new Promise<boolean>((resolve) => {
        let settled = false
        const done = (success: boolean) => {
          if (settled) return
          settled = true
          URL.revokeObjectURL(url)
          audio.onended = null
          audio.onpause = null
          audio.onerror = null
          controller.signal.removeEventListener('abort', onAbort)
          resolve(success)
        }
        const onAbort = () => done(false)
        audio.onended = () => done(true)
        audio.onpause = () => done(controller.signal.aborted ? false : audio.ended)
        audio.onerror = () => done(false)
        controller.signal.addEventListener('abort', onAbort, { once: true })
        audio.play().then(() => undefined).catch(() => done(false))
      })
      if (controller.signal.aborted) return 'aborted'
      if (!played) throw new Error('Audio playback was blocked.')
    }
    return 'elevenlabs'
  } catch {
    return 'aborted'
  }
}
