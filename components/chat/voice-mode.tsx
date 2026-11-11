'use client'

import { useEffect, useRef, useState } from 'react'
import { PhoneOff } from 'lucide-react'
import { limitChatTranscript, readChatStream } from '@/lib/chat-stream'
import { uid, type Message } from '@/lib/types'
import { getAudioContext, speak, stopSpeaking, transcribeAudio } from '@/lib/voice'

type VoiceStatus = 'connecting' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'paused' | 'error'

type Props = {
  conversationId: string
  projectId: string
  history: Message[]
  onExchange: (userText: string, aiText: string) => void
  onClose: () => void
}

const STATUS_TEXT: Record<VoiceStatus, string> = {
  connecting: 'Connecting to microphone',
  listening: 'Listening',
  transcribing: 'Transcribing speech',
  thinking: 'Preparing a response',
  speaking: 'Speaking',
  paused: 'Voice paused',
  error: 'Microphone unavailable',
}

export function VoiceMode({ conversationId, projectId, history, onExchange, onClose }: Props) {
  const [status, setStatusState] = useState<VoiceStatus>('connecting')
  const [activityLabel, setActivityLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const statusRef = useRef<VoiceStatus>('connecting')
  const activeRef = useRef(true)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef(history)
  const requestRef = useRef<AbortController | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const speechDetectedRef = useRef(false)
  const recordingStartedRef = useRef(0)
  const lastVoiceAtRef = useRef(0)
  const startRecordingRef = useRef<() => void>(() => undefined)
  const connectMicrophoneRef = useRef<() => Promise<void>>(async () => undefined)
  const transcribeRef = useRef<(audio: Blob) => Promise<void>>(async () => undefined)
  const respondRef = useRef<(text: string) => Promise<void>>(async () => undefined)

  const setStatus = (next: VoiceStatus) => {
    statusRef.current = next
    setStatusState(next)
  }

  startRecordingRef.current = () => {
    if (!activeRef.current || !streamRef.current || statusRef.current === 'paused') return
    if (recorderRef.current?.state === 'recording') return
    if (typeof MediaRecorder === 'undefined') {
      setError('Audio recording is not supported in this browser. Try a recent version of Chrome, Edge, or Safari.')
      setStatus('error')
      return
    }

    try {
      chunksRef.current = []
      speechDetectedRef.current = false
      recordingStartedRef.current = performance.now()
      lastVoiceAtRef.current = recordingStartedRef.current
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType ? new MediaRecorder(streamRef.current, { mimeType }) : new MediaRecorder(streamRef.current)
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        recorderRef.current = null
        if (!activeRef.current || statusRef.current === 'paused' || statusRef.current === 'error') return
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (!speechDetectedRef.current || audio.size < 500) {
          setStatus('listening')
          window.setTimeout(() => startRecordingRef.current(), 180)
          return
        }
        setStatus('transcribing')
        void transcribeRef.current(audio)
      }
      recorder.start(200)
      setError(null)
      setStatus('listening')
    } catch {
      setError('Could not start recording. Check that your microphone is available and try again.')
      setStatus('error')
    }
  }

  connectMicrophoneRef.current = async () => {
    if (!activeRef.current) return
    setError(null)
    setStatus('connecting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires a supported browser and a secure connection.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (!activeRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const context = getAudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      context.createMediaStreamSource(stream).connect(analyser)
      analyserRef.current = analyser
      startRecordingRef.current()
    } catch (cause) {
      if (!activeRef.current) return
      const permissionError = cause instanceof Error && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
      const missingDevice = cause instanceof Error && cause.name === 'NotFoundError'
      setError(permissionError
        ? 'Microphone access is blocked. Allow microphone access for this site, then tap the mic to retry.'
        : missingDevice
          ? 'No microphone was detected. Connect one, then tap the mic to try again.'
          : 'Could not access your microphone. Check browser permissions and try again.')
      setStatus('error')
    }
  }

  respondRef.current = async (text: string) => {
    setStatus('thinking')
    setActivityLabel('Preparing a response…')
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const userMessage: Message = { id: uid(), role: 'user', content: text }
      const messages = limitChatTranscript([...historyRef.current, userMessage])
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, projectId, messages, mode: 'chat', voice: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        signal: controller.signal,
      })
      let speechBuffer = ''
      let streamedSpeech = false
      let speechQueue = Promise.resolve()
      const queueSpeech = (segment: string) => {
        const cleanSegment = segment.trim()
        if (!cleanSegment) return
        speechQueue = speechQueue.then(async () => {
          if (!activeRef.current || controller.signal.aborted) return
          setStatus('speaking')
          const playback = await speak(cleanSegment)
          if (playback === 'aborted' && !controller.signal.aborted) {
            throw new Error('Audio playback is unavailable. Check your device sound and try again.')
          }
        })
      }
      const data = await readChatStream(response, setActivityLabel, (delta) => {
        streamedSpeech = true
        speechBuffer += delta
        const boundary = /[.!?](?:\s|$)/.exec(speechBuffer)
        if (!boundary) return
        const end = boundary.index + 1
        queueSpeech(speechBuffer.slice(0, end))
        speechBuffer = speechBuffer.slice(boundary.index + boundary[0].length)
      })
      if (!activeRef.current) return

      const reply = data.text
      if (streamedSpeech) queueSpeech(speechBuffer)
      else queueSpeech(reply)
      historyRef.current = [
        ...historyRef.current,
        userMessage,
        { id: data.messageId, role: 'assistant', content: reply },
      ]
      setActivityLabel(null)
      onExchange(text, reply)
      setStatus('speaking')
      await speechQueue
      if (activeRef.current && statusRef.current === 'speaking') {
        startRecordingRef.current()
      }
    } catch (cause) {
      if (!activeRef.current || controller.signal.aborted) return
      controller.abort()
      stopSpeaking()
      setActivityLabel(null)
      setError(cause instanceof Error ? cause.message : 'The voice assistant could not reply right now.')
      setStatus('error')
    }
  }

  transcribeRef.current = async (audio: Blob) => {
    try {
      const text = await transcribeAudio(audio)
      if (!activeRef.current) return
      if (!text) {
        setStatus('listening')
        startRecordingRef.current()
        return
      }
      await respondRef.current(text)
    } catch (cause) {
      if (!activeRef.current) return
      setError(cause instanceof Error ? cause.message : 'Could not transcribe your voice. Try again.')
      setStatus('error')
    }
  }

  useEffect(() => {
    activeRef.current = true
    void connectMicrophoneRef.current()

    const samples = new Uint8Array(1024)
    let animationFrame = 0
    let smoothedLevel = 0
    const animate = (time: number) => {
      const analyser = analyserRef.current
      let level = 0
      if (analyser && statusRef.current === 'listening' && recorderRef.current?.state === 'recording') {
        analyser.getByteTimeDomainData(samples)
        let energy = 0
        for (const sample of samples) {
          const centered = (sample - 128) / 128
          energy += centered * centered
        }
        level = Math.sqrt(energy / samples.length)
        if (level > 0.022) {
          speechDetectedRef.current = true
          lastVoiceAtRef.current = time
        }
        const recorder = recorderRef.current
        const silenceAfterSpeech = speechDetectedRef.current && time - lastVoiceAtRef.current > 750
        const segmentLimitReached = time - recordingStartedRef.current > 18_000
        if ((silenceAfterSpeech || segmentLimitReached) && recorder?.state === 'recording') {
          setStatus('transcribing')
          recorder.stop()
        }
      } else if (statusRef.current === 'thinking') {
        level = 0.12 + Math.abs(Math.sin(time / 280)) * 0.12
      } else if (statusRef.current === 'speaking') {
        level = 0.25 + Math.abs(Math.sin(time / 150)) * 0.24
      }
      smoothedLevel += (level - smoothedLevel) * 0.22
      stageRef.current?.style.setProperty('--level', (smoothedLevel * 0.2).toFixed(3))
      animationFrame = requestAnimationFrame(animate)
    }
    animationFrame = requestAnimationFrame(animate)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      activeRef.current = false
      cancelAnimationFrame(animationFrame)
      window.removeEventListener('keydown', handleKeyDown)
      requestRef.current?.abort()
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      stopSpeaking()
    }
  }, [onClose])

  const toggleMicrophone = () => {
    if (status === 'paused' || status === 'error' || status === 'connecting') {
      setError(null)
      if (streamRef.current) startRecordingRef.current()
      else void connectMicrophoneRef.current()
      return
    }
    setStatus('paused')
    requestRef.current?.abort()
    setActivityLabel(null)
    recorderRef.current?.stop()
    stopSpeaking()
  }

  const isPaused = status === 'paused' || status === 'error'

  return (
    <div
      ref={stageRef}
      role="dialog"
      aria-modal="true"
      aria-label="Live voice mode"
      className="voice-backdrop fixed inset-0 z-50 flex overflow-hidden text-foreground [--level:0.05]"
    >
      <p className="sr-only" role="status" aria-live="polite">
        {error ?? activityLabel ?? STATUS_TEXT[status]}
      </p>
      <main className="voice-main relative flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-col items-center gap-2 px-4 pt-5 text-center">
          <h1 className="text-sm font-medium">Live voice</h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">{error ?? activityLabel ?? STATUS_TEXT[status]}</p>
        </header>
        <div className="voice-orb-stage relative flex min-h-0 flex-1 items-center justify-center">
          <button
            type="button"
            onClick={toggleMicrophone}
            aria-label={isPaused ? 'Resume voice' : 'Pause voice'}
            aria-pressed={!isPaused}
            className="voice-orb-control"
          >
            <span className="voice-orb" data-state={status} aria-hidden="true">
              <span className="voice-orb-glow voice-orb-glow-one" />
              <span className="voice-orb-glow voice-orb-glow-two" />
              <span className="voice-orb-core">
                <span className="voice-orb-light voice-orb-light-one" />
                <span className="voice-orb-light voice-orb-light-two" />
              </span>
            </span>
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="End voice conversation"
          className="voice-end-button mx-auto mb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <PhoneOff className="size-[18px]" aria-hidden="true" />
          <span>End call</span>
        </button>
      </main>
    </div>
  )
}
