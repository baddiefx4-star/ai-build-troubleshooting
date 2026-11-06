import type { ChatMode } from './prompt'

export type ChatAttachmentInfo = {
  name: string
  mediaType: string
  size: number
}

export type ChatAttachmentPayload = ChatAttachmentInfo & {
  text?: string
  dataUrl?: string
}

export type CommandActivity = {
  id: string
  command: string
  status: 'running' | 'completed' | 'error'
  exitCode?: number
  stdout?: string
  stderr?: string
  timedOut?: boolean
}

export type Project = {
  id: string
  name: string
  memory: string
  updatedAt: number
}

export type VoicePreference = {
  voiceId: string
  voiceName: string
}

export type VoiceOption = VoicePreference

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: ChatAttachmentInfo[]
  imageDataUrl?: string
  commandActivity?: CommandActivity[]
  error?: boolean
}

export type Conversation = {
  id: string
  title: string
  projectId: string
  searchSnippet?: string
  messages: Message[]
  mode: ChatMode
  updatedAt: number
}

export const MODE_LABELS: Record<ChatMode, { label: string; hint: string }> = {
  chat: { label: 'CTECH Chat', hint: 'Helpful everyday answers from CTECH AI' },
  code: { label: 'CTECH Code', hint: 'Advanced coding and debugging' },
  reason: { label: 'CTECH Reason', hint: 'Careful reasoning with concise explanations' },
  creative: { label: 'CTECH Creative', hint: 'Stories, ideas and image generation' },
  research: { label: 'CTECH Research', hint: 'Web research with source citations' },
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
