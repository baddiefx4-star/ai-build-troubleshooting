'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, AudioLines, FileImage, FileText, ImagePlus, LoaderCircle, Mic, MicOff, Paperclip, Plus, Square, X } from 'lucide-react'
import type { ChatMode } from '@/lib/prompt'
import { MODE_LABELS, type ChatAttachmentPayload } from '@/lib/types'
import { cn } from '@/lib/utils'
import { transcribeAudio } from '@/lib/voice'

type Props = {
  busy: boolean
  disabled?: boolean
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  onSend: (text: string, attachments: ChatAttachmentPayload[]) => void
  onGenerateImage: (prompt: string) => void
  onStop: () => void
  onVoiceMode: () => void
  autoFocus?: boolean
}

const MAX_FILES = 5
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_FILE_BYTES = 8 * 1024 * 1024
const MAX_TEXT_CHARS = 100_000
const MAX_PROMPT_CHARS = 250_000
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'mdx', 'csv', 'json', 'ipynb', 'xml', 'yaml', 'yml', 'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'dart', 'c', 'h', 'cpp', 'hpp', 'rb', 'php', 'sh', 'ps1', 'sql', 'graphql', 'gql', 'proto', 'tf', 'hcl', 'env', 'log', 'toml', 'ini', 'conf', 'properties', 'dockerfile'])
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
const ACCEPTED_FILES = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.markdown,.mdx,.csv,.json,.ipynb,.xml,.yaml,.yml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.mjs,.cjs,.vue,.svelte,.py,.go,.rs,.java,.kt,.swift,.dart,.c,.h,.cpp,.hpp,.rb,.php,.sh,.ps1,.sql,.graphql,.gql,.proto,.tf,.hcl,.env,.log,.toml,.ini,.conf,.properties,.dockerfile'

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('This file could not be read.'))
    reader.onerror = () => reject(new Error('This file could not be read.'))
    reader.readAsDataURL(file)
  })
}

async function prepareAttachment(file: File): Promise<ChatAttachmentPayload> {
  if (file.size <= 0) throw new Error(`${file.name} is empty.`)
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than the 4 MB per-file limit.`)

  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const suppliedType = file.type.toLowerCase()
  const mediaType = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(suppliedType)
    ? suppliedType
    : extension === 'pdf'
      ? 'application/pdf'
      : IMAGE_TYPES[extension] || suppliedType || 'text/plain'
  const info = { name: file.name, mediaType, size: file.size }

  if (mediaType === 'application/pdf' || mediaType.startsWith('image/')) {
    if (mediaType !== 'application/pdf' && !Object.values(IMAGE_TYPES).includes(mediaType)) {
      throw new Error(`${file.name} uses an unsupported image format.`)
    }
    return { ...info, dataUrl: await readDataUrl(file) }
  }

  if (!mediaType.startsWith('text/') && mediaType !== 'application/json' && !TEXT_EXTENSIONS.has(extension)) {
    throw new Error(`${file.name} is not a supported PDF, image, text, or code file.`)
  }

  const text = await file.text()
  if (text.length > MAX_TEXT_CHARS) throw new Error(`${file.name} has more than 100,000 characters. Split it into smaller files.`)
  return { ...info, text }
}

function formatSize(size: number) {
  if (size < 1_024) return `${size} B`
  if (size < 1_048_576) return `${Math.round(size / 1_024)} KB`
  return `${(size / 1_048_576).toFixed(1)} MB`
}

export function Composer({ busy, disabled = false, mode, onModeChange, onSend, onGenerateImage, onStop, onVoiceMode, autoFocus }: Props) {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachmentPayload[]>([])
  const [preparingFiles, setPreparingFiles] = useState(false)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [dictating, setDictating] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addMenuRef = useRef<HTMLDetailsElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mountedRef = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [value])

  useEffect(() => {
    mountedRef.current = true
    const closeAddMenu = (event: PointerEvent) => {
      if (addMenuRef.current?.open && !addMenuRef.current.contains(event.target as Node)) {
        addMenuRef.current.open = false
      }
    }
    document.addEventListener('pointerdown', closeAddMenu)
    return () => {
      mountedRef.current = false
      document.removeEventListener('pointerdown', closeAddMenu)
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const submit = () => {
    const text = value.trim()
    if ((!text && attachments.length === 0) || busy || disabled || dictating || transcribing || preparingFiles) return
    onSend(text, attachments)
    setValue('')
    setAttachments([])
    setAttachmentError(null)
  }

  const addFiles = async (files: File[]) => {
    setAttachmentError(null)
    if (attachments.length + files.length > MAX_FILES) {
      setAttachmentError(`Choose up to ${MAX_FILES} files per message.`)
      return
    }
    const currentSize = attachments.reduce((total, attachment) => total + attachment.size, 0)
    if (currentSize + files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_FILE_BYTES) {
      setAttachmentError('Keep the combined size of uploaded files under 8 MB.')
      return
    }

    setPreparingFiles(true)
    try {
      const prepared: ChatAttachmentPayload[] = []
      for (const file of files) prepared.push(await prepareAttachment(file))
      setAttachments((current) => [...current, ...prepared])
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'A file could not be added.')
    } finally {
      setPreparingFiles(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const generateImage = () => {
    const prompt = value.trim()
    if (!prompt || busy || disabled || preparingFiles || transcribing) return
    onGenerateImage(prompt)
    setValue('')
  }

  const startDictation = async () => {
    setVoiceError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Voice typing is not available in this browser. Try a recent version of Chrome, Edge, or Safari.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      chunksRef.current = []
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        recorderRef.current = null
        if (!mountedRef.current) return
        setDictating(false)
        if (chunksRef.current.length === 0) return
        setTranscribing(true)
        try {
          const audio = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          const text = await transcribeAudio(audio)
          if (text && mountedRef.current) {
            setValue((current) => `${current.trimEnd()}${current.trim() ? ' ' : ''}${text}`)
          }
          if (!text && mountedRef.current) setVoiceError('I could not hear any words. Try again a little closer to the microphone.')
        } catch (error) {
          if (mountedRef.current) setVoiceError(error instanceof Error ? error.message : 'Voice transcription failed. Try again.')
        } finally {
          if (mountedRef.current) setTranscribing(false)
        }
      }
      recorder.start(200)
      setDictating(true)
    } catch {
      setVoiceError('Microphone access was blocked. Allow microphone permission in your browser and try again.')
    }
  }

  const toggleDictation = () => {
    if (disabled) return
    if (dictating) {
      recorderRef.current?.stop()
      return
    }
    if (!transcribing) void startDictation()
  }

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        onDragOver={(event) => {
          if (busy || disabled || preparingFiles || !event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setIsDraggingFiles(true)
        }}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setIsDraggingFiles(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setIsDraggingFiles(false)
          if (busy || disabled || preparingFiles) return
          const files = Array.from(event.dataTransfer.files)
          if (files.length) void addFiles(files)
        }}
        className={cn(
          'rounded-[28px] border border-border bg-card p-2 shadow-2xl shadow-black/40 transition-colors focus-within:border-primary/50',
          isDraggingFiles && 'border-primary/70 bg-primary/5',
        )}
      >
        {isDraggingFiles && <p role="status" className="px-3 pt-2 text-xs font-medium text-primary">Drop files to attach</p>}
        <label htmlFor="composer" className="sr-only">Message CTECH AI</label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={value}
          maxLength={MAX_PROMPT_CHARS}
          autoFocus={autoFocus}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              event.preventDefault()
              submit()
            }
          }}
          placeholder={dictating ? 'Listening… tap the mic to finish' : transcribing ? 'Transcribing voice…' : 'Ask CTECH AI anything…'}
          className="scrollbar-thin block max-h-60 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />

        {attachments.length > 0 && (
          <ul aria-label="Files attached to this message" className="flex flex-wrap gap-2 px-2 pt-2">
            {attachments.map((attachment, index) => (
              <li key={`${attachment.name}-${index}`} className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-border bg-secondary/60 px-2.5 py-2">
                {attachment.mediaType.startsWith('image/') ? <FileImage className="size-4 shrink-0 text-primary" aria-hidden="true" /> : <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />}
                <span className="min-w-0 truncate text-xs font-medium" title={attachment.name}>{attachment.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatSize(attachment.size)}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  disabled={busy || disabled}
                  aria-label={`Remove ${attachment.name}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          aria-label="Choose files to upload"
          disabled={busy || disabled || preparingFiles}
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            if (files.length) void addFiles(files)
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <label className="flex h-9 max-w-28 items-center rounded-full border border-border/70 bg-secondary/50 px-3 text-xs font-medium text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:max-w-40 sm:text-sm">
            <span className="sr-only">Assistant mode</span>
            <select
              aria-label="Assistant mode"
              value={mode}
              onChange={(event) => onModeChange(event.target.value as ChatMode)}
              className="w-full cursor-pointer truncate bg-transparent outline-none"
            >
              {(Object.keys(MODE_LABELS) as ChatMode[]).map((option) => (
                <option key={option} value={option} className="bg-popover text-foreground">
                  {MODE_LABELS[option].label.replace('CTECH ', '')}
                </option>
              ))}
            </select>
          </label>
          <p className="px-2 text-xs text-muted-foreground max-sm:hidden">
            <kbd className="font-mono">Enter</kbd> to send · <kbd className="font-mono">Shift + Enter</kbd> new line
          </p>
          {value.length > 10_000 && (
            <p aria-live="polite" className="px-2 text-[11px] tabular-nums text-muted-foreground">
              {value.length.toLocaleString()} / {MAX_PROMPT_CHARS.toLocaleString()}
            </p>
          )}
          <div className="ml-auto flex items-center gap-1">
            <details
              ref={addMenuRef}
              className="relative"
              onKeyDown={(event) => {
                if (event.key !== 'Escape' || !addMenuRef.current?.open) return
                addMenuRef.current.open = false
                event.preventDefault()
                addMenuRef.current.querySelector('summary')?.focus()
              }}
            >
              <summary
                aria-disabled={busy || disabled || preparingFiles}
                onClick={(event) => {
                  if (busy || disabled || preparingFiles) event.preventDefault()
                }}
                title="Add files or create an image"
                className="flex size-9 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&::-webkit-details-marker]:hidden"
              >
                <Plus className="size-[19px]" aria-hidden="true" />
                <span className="sr-only">Add files or create an image</span>
              </summary>
              <div className="absolute right-0 bottom-full z-30 mb-2 w-56 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    if (addMenuRef.current) addMenuRef.current.open = false
                    fileInputRef.current?.click()
                  }}
                  disabled={busy || disabled || preparingFiles}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
                >
                  {preparingFiles ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Paperclip className="size-4" aria-hidden="true" />}
                  <span>{preparingFiles ? 'Preparing files…' : 'Add photos and files'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (addMenuRef.current) addMenuRef.current.open = false
                    generateImage()
                  }}
                  disabled={!value.trim() || busy || disabled || preparingFiles || transcribing}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <ImagePlus className="size-4" aria-hidden="true" />
                  <span>Create an image from this message</span>
                </button>
              </div>
            </details>
            <button
              type="button"
              onClick={toggleDictation}
              disabled={transcribing || disabled || busy}
              aria-label={dictating ? 'Finish voice typing' : transcribing ? 'Transcribing voice' : 'Start voice typing'}
              title={dictating ? 'Finish voice typing' : transcribing ? 'Transcribing voice' : 'Start voice typing'}
              className={cn(
                'flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50',
                dictating && 'bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary',
              )}
            >
              {transcribing ? <LoaderCircle className="size-[18px] animate-spin" aria-hidden="true" /> : dictating ? <MicOff className="size-[18px]" aria-hidden="true" /> : <Mic className="size-[18px]" aria-hidden="true" />}
            </button>
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                className="flex size-9 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90"
              >
                <Square className="size-3.5 fill-current" aria-hidden="true" />
              </button>
            ) : value.trim() || attachments.length > 0 ? (
              <button
                type="submit"
                disabled={disabled || preparingFiles || dictating || transcribing}
                aria-label="Send message"
                className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <ArrowUp className="size-[18px]" strokeWidth={2.5} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onVoiceMode}
                disabled={disabled}
                aria-label="Start voice mode"
                title="Voice mode"
                className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <AudioLines className="size-[18px]" aria-hidden="true" />
                <span className="max-sm:hidden">Voice</span>
              </button>
            )}
          </div>
        </div>
      </form>
      {attachmentError && <p role="alert" className="px-4 pt-2 text-sm text-destructive">{attachmentError}</p>}
      {voiceError && <p role="alert" className="px-4 pt-2 text-sm text-destructive">{voiceError}</p>}
    </div>
  )
}
