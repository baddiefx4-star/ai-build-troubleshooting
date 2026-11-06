'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Check, Copy, Download, FileImage, FileText, Pencil, RefreshCw, Square, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react'
import type { Message } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Markdown } from './markdown'
import { LogoMark } from './logo'
import { CommandActivityPanel } from './command-activity'

type Props = {
  message: Message
  isLast: boolean
  isTyping: boolean
  speaking: boolean
  onRegenerate: () => void
  onEdit: (content: string) => void
  onSpeak: () => void
}

function ActionButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        active && 'text-primary',
      )}
    >
      {children}
    </button>
  )
}

export function MessageItem({ message, isLast, isTyping, speaking, onRegenerate, onEdit, onSpeak }: Props) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)

  const copy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (message.role === 'user') {
    if (editing) {
      return (
        <div className="flex justify-end">
          <div className="w-full max-w-[85%] rounded-2xl border border-border bg-secondary p-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(10, draft.split('\n').length + 1)}
              className="w-full resize-none bg-transparent text-[15px] outline-none"
              aria-label="Edit message"
              autoFocus
            />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="rounded-full px-3 py-1.5 text-sm hover:bg-accent">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  if (draft.trim()) onEdit(draft.trim())
                }}
                className="rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="group flex flex-col items-end gap-1">
        <div className="max-w-[85%] break-words rounded-3xl bg-secondary px-5 py-2.5 text-[15px] leading-relaxed">
          <p className="whitespace-pre-wrap">{message.content}</p>
          {message.attachments && message.attachments.length > 0 && (
            <ul aria-label="Attached files" className="mt-2 flex flex-wrap gap-1.5">
              {message.attachments.map((attachment, index) => (
                <li key={`${attachment.name}-${index}`} className="flex max-w-full items-center gap-1.5 rounded-lg border border-border/70 bg-background/50 px-2 py-1 text-xs">
                  {attachment.mediaType.startsWith('image/') ? <FileImage className="size-3.5 shrink-0 text-primary" aria-hidden="true" /> : <FileText className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
                  <span className="truncate" title={attachment.name}>{attachment.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <ActionButton label={copied ? 'Copied' : 'Copy'} onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </ActionButton>
          <ActionButton
            label="Edit message"
            onClick={() => {
              setDraft(message.content)
              setEditing(true)
            }}
          >
            <Pencil className="size-4" />
          </ActionButton>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex gap-4">
      <LogoMark className="mt-0.5 size-7" />
      <div className="min-w-0 flex-1">
        {message.error ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-red-200">{message.content}</div>
        ) : (
          <div className={cn(isTyping && 'caret')}>
            <Markdown content={message.content} />
          </div>
        )}
        {message.commandActivity?.length ? <CommandActivityPanel activities={message.commandActivity} /> : null}
        {!message.error && message.imageDataUrl && (
          <figure className="mt-4 max-w-xl overflow-hidden rounded-2xl border border-border bg-card">
            <Image
              src={message.imageDataUrl}
              alt="AI-generated image"
              width={1024}
              height={1024}
              unoptimized
              className="h-auto w-full"
            />
            <figcaption className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">Generated image</span>
              <a
                href={message.imageDataUrl}
                download="ctech-ai-image.png"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                <Download className="size-3.5" aria-hidden="true" />
                Download image
              </a>
            </figcaption>
          </figure>
        )}
        {!isTyping && (
          <div
            className={cn(
              'mt-2 flex items-center gap-0.5 transition-opacity',
              isLast ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
            )}
          >
            <ActionButton label={copied ? 'Copied' : 'Copy'} onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </ActionButton>
            {!message.error && (
              <ActionButton label={speaking ? 'Stop reading' : 'Read aloud'} onClick={onSpeak} active={speaking}>
                {speaking ? <Square className="size-4" /> : <Volume2 className="size-4" />}
              </ActionButton>
            )}
            <ActionButton label="Good response" onClick={() => setFeedback(feedback === 'up' ? null : 'up')} active={feedback === 'up'}>
              <ThumbsUp className="size-4" />
            </ActionButton>
            <ActionButton label="Bad response" onClick={() => setFeedback(feedback === 'down' ? null : 'down')} active={feedback === 'down'}>
              <ThumbsDown className="size-4" />
            </ActionButton>
            {isLast && (
              <ActionButton label="Regenerate" onClick={onRegenerate}>
                <RefreshCw className="size-4" />
              </ActionButton>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function ThinkingIndicator({ label = 'Thinking…' }: { label?: string }) {
  return (
    <div className="flex gap-4" role="status" aria-label={label} aria-live="polite">
      <LogoMark className="mt-0.5 size-7 animate-pulse" />
      <div className="flex items-center gap-1.5 pt-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
        <span className="ml-2 text-sm text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}
