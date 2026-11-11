'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { PanelLeft, LoaderCircle } from 'lucide-react'
import { limitChatTranscript, readChatStream } from '@/lib/chat-stream'
import type { ChatMode } from '@/lib/prompt'
import { uid, type ChatAttachmentPayload, type CommandActivity, type Conversation, type Message, type Project, type VoicePreference } from '@/lib/types'
import { speak, stopSpeaking } from '@/lib/voice'
import { DEFAULT_ELEVENLABS_VOICE_ID, DEFAULT_ELEVENLABS_VOICE_NAME } from '@/lib/voice-config'
import { cn } from '@/lib/utils'
import { Sidebar } from './sidebar'
import { Composer } from './composer'
import { EmptyState } from './empty-state'
import { MessageItem, ThinkingIndicator } from './message-item'
import { VoiceMode } from './voice-mode'
import { CommandActivityPanel } from './command-activity'

const DEFAULT_VOICE_PREFERENCE: VoicePreference = { voiceId: DEFAULT_ELEVENLABS_VOICE_ID, voiceName: DEFAULT_ELEVENLABS_VOICE_NAME }

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || 'New chat'
}

function isImageGenerationRequest(text: string) {
  return /\b(?:generate|create|draw|make|illustrate|render|design)\b.{0,48}\b(?:image|picture|photo|artwork|illustration|wallpaper|logo)\b|\b(?:image|picture|photo|artwork|illustration|wallpaper|logo)\b.{0,48}\b(?:of|for|with)\b/i.test(text)
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || 'Could not load saved chats.')
  return data as T
}

export function ChatApp({ userEmail }: { userEmail: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [mode, setMode] = useState<ChatMode>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [typingId, setTypingId] = useState<string | null>(null)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [activityLabel, setActivityLabel] = useState<string | null>(null)
  const [liveCommandActivity, setLiveCommandActivity] = useState<CommandActivity[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const didRestoreHistoryRef = useRef(false)

  const { data: projects = [], isLoading: isLoadingProjects, error: projectLoadError, mutate: mutateProjects } = useSWR<Project[]>(
    '/api/projects',
    fetchJson,
    { revalidateOnFocus: false },
  )
  const { data: voicePreference } = useSWR<VoicePreference>(
    '/api/preferences/voice',
    fetchJson,
    { fallbackData: DEFAULT_VOICE_PREFERENCE, revalidateOnFocus: false },
  )
  const { data: savedConversations, isLoading: isLoadingHistory, error: historyLoadError, mutate: mutateHistory } = useSWR<Conversation[]>(
    activeProjectId ? `/api/conversations?projectId=${encodeURIComponent(activeProjectId)}` : null,
    fetchJson,
    { revalidateOnFocus: false },
  )
  const { data: loadedConversation, isLoading: isLoadingConversation, error: conversationLoadError } = useSWR<Conversation>(
    activeId ? `/api/conversations/${encodeURIComponent(activeId)}` : null,
    fetchJson,
    { revalidateOnFocus: false },
  )

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId
  const conversationsRef = useRef(conversations)
  conversationsRef.current = conversations
  const attachmentPayloadsRef = useRef(new Map<string, ChatAttachmentPayload[]>())
  const activeProject = useMemo(() => projects.find((project) => project.id === activeProjectId) ?? null, [activeProjectId, projects])

  useEffect(() => {
    if (!projects.length) return
    if (!activeProjectId || !projects.some((project) => project.id === activeProjectId)) {
      didRestoreHistoryRef.current = false
      activeIdRef.current = null
      setActiveId(null)
      setConversations([])
      setActiveProjectId(projects[0].id)
    }
  }, [activeProjectId, projects])

  useEffect(() => {
    if (!savedConversations || !activeProjectId || didRestoreHistoryRef.current) return
    didRestoreHistoryRef.current = true
    setConversations(savedConversations)
    const mostRecent = savedConversations[0]
    if (mostRecent) {
      activeIdRef.current = mostRecent.id
      setActiveId(mostRecent.id)
      setMode(mostRecent.mode)
    }
  }, [activeProjectId, savedConversations])

  useEffect(() => {
    if (!loadedConversation || loadedConversation.projectId !== activeProjectId) return
    setConversations((current) => {
      if (current.some((conversation) => conversation.id === loadedConversation.id)) {
        return current.map((conversation) => conversation.id === loadedConversation.id ? loadedConversation : conversation)
      }
      return [loadedConversation, ...current]
    })
    setMode(loadedConversation.mode)
  }, [activeProjectId, loadedConversation])

  const active = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId])
  const messages = active?.messages ?? []
  const busy = pending || typingId !== null
  const historyLoading = isLoadingProjects || !activeProjectId || (!historyLoadError && isLoadingHistory) || (activeId !== null && isLoadingConversation)
  const historyActivity = isLoadingProjects || !activeProjectId
    ? 'Loading your projects…'
    : isLoadingHistory
      ? 'Remembering your chats…'
      : isLoadingConversation
        ? 'Remembering this conversation…'
        : null
  const visibleHistoryError = historyError || (projectLoadError || historyLoadError || conversationLoadError ? 'Saved chat data could not be loaded.' : null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    if (nearBottom || pending) el.scrollTo({ top: el.scrollHeight, behavior: pending ? 'smooth' : 'auto' })
  }, [messages, pending])

  const updateConversation = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)))
  }, [])

  const ensureConversation = useCallback(
    (firstText: string): string => {
      if (!activeProjectId) return ''
      const current = activeIdRef.current
      if (current) return current
      const id = uid()
      setConversations((prev) => [{ id, projectId: activeProjectId, title: titleFrom(firstText), messages: [], mode, updatedAt: Date.now() }, ...prev])
      setActiveId(id)
      activeIdRef.current = id
      return id
    },
    [activeProjectId, mode],
  )

  const generate = useCallback(
    async (convId: string, projectId: string, history: Message[], chatMode: ChatMode, attachments: ChatAttachmentPayload[] = []) => {
      setPending(true)
      setActivityLabel('Thinking…')
      setLiveCommandActivity([])
      const commandActivity: CommandActivity[] = []
      const assistantId = uid()
      setTypingId(assistantId)
      updateConversation(convId, (conversation) => ({
        ...conversation,
        updatedAt: Date.now(),
        messages: [...conversation.messages, { id: assistantId, role: 'assistant', content: '' }],
      }))
      const controller = new AbortController()
      abortRef.current = controller
      const safeHistory = limitChatTranscript(history.filter((message) => !message.error))
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: convId, projectId, messages: safeHistory, mode: chatMode, attachments, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
          signal: controller.signal,
        })
        const result = await readChatStream(response, setActivityLabel, (delta) => {
          updateConversation(convId, (conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) => message.id === assistantId
              ? { ...message, content: message.content + delta }
              : message),
          }))
        }, (activity) => {
          const index = commandActivity.findIndex((item) => item.id === activity.id)
          if (index < 0) commandActivity.push(activity)
          else commandActivity[index] = activity
          setLiveCommandActivity([...commandActivity])
        })
        updateConversation(convId, (conversation) => ({
          ...conversation,
          updatedAt: Date.now(),
          messages: conversation.messages.map((message) => message.id === assistantId
            ? { ...message, id: result.messageId, content: result.text || '(No response)', commandActivity: result.commandActivity.length ? result.commandActivity : undefined }
            : message),
        }))
        setPending(false)
        setTypingId(null)
        setActivityLabel(null)
        setLiveCommandActivity([])
        void mutateHistory()
      } catch (error) {
        setPending(false)
        setTypingId(null)
        setActivityLabel(null)
        setLiveCommandActivity([])
        if (controller.signal.aborted) {
          updateConversation(convId, (conversation) => ({
            ...conversation,
            messages: conversation.messages.filter((message) => message.id !== assistantId),
          }))
          return
        }
        updateConversation(convId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => message.id === assistantId
            ? { ...message, content: error instanceof Error ? error.message : 'Something went wrong.', error: true }
            : message),
        }))
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [mutateHistory, updateConversation],
  )

  const generateImage = useCallback(
    async (prompt: string) => {
      if (busy || historyLoading || !activeProjectId || !prompt.trim()) return
      const cleanPrompt = prompt.trim()
      const convId = ensureConversation(cleanPrompt)
      if (!convId) return
      const userMsg: Message = { id: uid(), role: 'user', content: cleanPrompt }
      const existing = conversationsRef.current.find((conversation) => conversation.id === convId)?.messages ?? []
      const history = [...existing, userMsg]
      setMode('creative')
      updateConversation(convId, (conversation) => ({
        ...conversation,
        mode: 'creative',
        updatedAt: Date.now(),
        messages: [...conversation.messages, userMsg],
      }))
      setPending(true)
      setActivityLabel('Creating your image…')
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const response = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: convId, projectId: activeProjectId, messages: limitChatTranscript(history), prompt: cleanPrompt }),
          signal: controller.signal,
        })
        const data = await response.json().catch(() => null)
        if (!response.ok || typeof data?.imageDataUrl !== 'string' || typeof data?.messageId !== 'string') {
          throw new Error(data?.error || 'The image could not be generated. Try again.')
        }
        updateConversation(convId, (conversation) => ({
          ...conversation,
          updatedAt: Date.now(),
          messages: [...conversation.messages, {
            id: data.messageId as string,
            role: 'assistant',
            content: 'Image generated. Download it from this chat to keep a copy.',
            imageDataUrl: data.imageDataUrl as string,
          }],
        }))
        void mutateHistory()
      } catch (error) {
        if (!controller.signal.aborted) {
          updateConversation(convId, (conversation) => ({
            ...conversation,
            messages: [...conversation.messages, {
              id: uid(),
              role: 'assistant',
              content: error instanceof Error ? error.message : 'The image could not be generated. Try again.',
              error: true,
            }],
          }))
        }
      } finally {
        setPending(false)
        setActivityLabel(null)
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [activeProjectId, busy, ensureConversation, historyLoading, mutateHistory, updateConversation],
  )

  const send = useCallback(
    (text: string, overrideMode?: ChatMode, attachments: ChatAttachmentPayload[] = []) => {
      if (busy || historyLoading || !activeProjectId) return
      const cleanText = text.trim()
      if (!cleanText && attachments.length === 0) return
      const attachmentList = attachments.map(({ name, mediaType, size }) => ({ name, mediaType, size }))
      const messageText = cleanText || 'Please review the attached files.'
      const chatMode = overrideMode ?? mode
      if (overrideMode) setMode(overrideMode)
      if (!attachments.length && isImageGenerationRequest(cleanText)) {
        void generateImage(cleanText)
        return
      }
      const convId = ensureConversation(messageText)
      const userMsg: Message = { id: uid(), role: 'user', content: messageText, attachments: attachmentList }
      if (attachments.length) attachmentPayloadsRef.current.set(userMsg.id, attachments)
      const existing = conversationsRef.current.find((conversation) => conversation.id === convId)?.messages ?? []
      const history = [...existing, userMsg]
      updateConversation(convId, (conversation) => ({ ...conversation, mode: chatMode, updatedAt: Date.now(), messages: [...conversation.messages, userMsg] }))
      generate(convId, activeProjectId, history, chatMode, attachments)
    },
    [activeProjectId, busy, ensureConversation, generate, generateImage, historyLoading, mode, updateConversation],
  )

  const stop = () => {
    abortRef.current?.abort()
    setPending(false)
    setTypingId(null)
    setActivityLabel(null)
    setLiveCommandActivity([])
  }

  const regenerate = () => {
    if (!active || busy) return
    const lastUser = active.messages.map((m) => m.role).lastIndexOf('user')
    if (lastUser < 0) return
    const history = active.messages.slice(0, lastUser + 1)
    updateConversation(active.id, (c) => ({ ...c, messages: history }))
    const lastUserMessage = history[history.length - 1]
    generate(active.id, active.projectId, history, mode, attachmentPayloadsRef.current.get(lastUserMessage.id) ?? [])
  }

  const editMessage = (msgId: string, content: string) => {
    if (!active || busy) return
    const idx = active.messages.findIndex((m) => m.id === msgId)
    if (idx < 0) return
    const history = [...active.messages.slice(0, idx), { ...active.messages[idx], content }]
    updateConversation(active.id, (c) => ({ ...c, messages: history, updatedAt: Date.now() }))
    const lastUserMessage = history[history.length - 1]
    generate(active.id, active.projectId, history, mode, attachmentPayloadsRef.current.get(lastUserMessage.id) ?? [])
  }

  const toggleSpeak = async (msg: Message) => {
    if (speakingId === msg.id) {
      stopSpeaking()
      setSpeakingId(null)
      return
    }
    setSpeakingId(msg.id)
    await speak(msg.content)
    setSpeakingId((cur) => (cur === msg.id ? null : cur))
  }

  const newChat = () => {
    stop()
    stopSpeaking()
    activeIdRef.current = null
    setActiveId(null)
    if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false)
  }

  const selectProject = (projectId: string) => {
    if (projectId === activeProjectId) return
    stop()
    stopSpeaking()
    didRestoreHistoryRef.current = false
    activeIdRef.current = null
    setActiveId(null)
    setConversations([])
    setMode('chat')
    setActiveProjectId(projectId)
  }

  const createProject = async (name: string) => {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data?.id) throw new Error(data?.error || 'Could not create this project.')
    const project = data as Project
    await mutateProjects((current) => [project, ...(current ?? []).filter((item) => item.id !== project.id)], false)
    selectProject(project.id)
  }

  const saveProjectMemory = async (projectId: string, memory: string) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memory }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.error || 'Could not save project memory.')
    const updatedProject = data as Project
    await mutateProjects((current) => (current ?? []).map((project) => project.id === updatedProject.id ? updatedProject : project), false)
  }

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)

    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.success !== true) throw new Error('Sign-out request failed.')
      window.location.replace('/sign-in')
    } catch {
      setSigningOut(false)
    }
  }

  const onVoiceExchange = useCallback(
    (userText: string, aiText: string) => {
      const convId = ensureConversation(userText)
      updateConversation(convId, (conversation) => ({
        ...conversation,
        title: conversation.messages.length ? conversation.title : titleFrom(userText),
        mode: 'chat',
        projectId: activeProjectId ?? conversation.projectId,
        updatedAt: Date.now(),
        messages: [...conversation.messages, { id: uid(), role: 'user', content: userText }, { id: uid(), role: 'assistant', content: aiText }],
      }))
      void mutateHistory()
    },
    [activeProjectId, ensureConversation, mutateHistory, updateConversation],
  )
  const voiceExchangeRef = useRef(onVoiceExchange)
  voiceExchangeRef.current = onVoiceExchange
  const stableVoiceExchange = useCallback((u: string, a: string) => voiceExchangeRef.current(u, a), [])
  const closeVoice = useCallback(() => setVoiceOpen(false), [])

  const openVoice = () => {
    if (busy || historyLoading || !activeProjectId) return
    stop()
    stopSpeaking()
    setSpeakingId(null)
    setMode('chat')
    ensureConversation('Voice conversation')
    setVoiceOpen(true)
  }

  const deleteConversation = async (id: string) => {
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not delete this conversation.')
      setHistoryError(null)
      setConversations((current) => current.filter((conversation) => conversation.id !== id))
      if (id === activeIdRef.current) {
        activeIdRef.current = null
        setActiveId(null)
      }
      await mutateHistory()
    } catch {
      setHistoryError('Could not delete this saved conversation. Please try again.')
    }
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        open={sidebarOpen}
        userEmail={userEmail}
        signingOut={signingOut}
        onSignOut={signOut}
        conversations={conversations}
        projects={projects}
        activeProjectId={activeProjectId}
        activeProjectMemory={activeProject?.memory ?? ''}
        onProjectChange={selectProject}
        onCreateProject={createProject}
        onSaveMemory={saveProjectMemory}
        activeId={activeId}
        onSelect={(id) => {
          stop()
          activeIdRef.current = id
          setActiveId(id)
          const conversation = conversations.find((item) => item.id === id)
          if (conversation) setMode(conversation.mode)
          if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false)
        }}
        onNew={newChat}
        onDelete={deleteConversation}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        {!sidebarOpen && (
          <header className="flex h-14 shrink-0 items-center gap-1 px-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <PanelLeft className="size-[18px]" />
            </button>
          </header>
        )}

        {visibleHistoryError && <p role="alert" className="mx-auto w-full max-w-3xl px-4 pb-2 text-sm text-destructive">{visibleHistoryError}</p>}

        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-8">
            <div className="w-full max-w-3xl">
              {(historyActivity || historyLoadError || projectLoadError) && (
                <p role={historyLoadError || projectLoadError ? 'alert' : 'status'} aria-live="polite" className="mb-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  {!historyLoadError && !projectLoadError && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
                  {historyLoadError || projectLoadError ? 'Saved chat data is temporarily unavailable.' : historyActivity}
                </p>
              )}
              <EmptyState mode={mode} onModeChange={setMode} />
              <div className="mt-8">
                <Composer busy={busy} disabled={historyLoading} mode={mode} onModeChange={setMode} onSend={(text, attachments) => send(text, undefined, attachments)} onGenerateImage={generateImage} onStop={stop} onVoiceMode={openVoice} autoFocus />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-4 pb-10">
                {messages.map((m, i) => (
                  <MessageItem
                    key={m.id}
                    message={m}
                    isLast={i === messages.length - 1}
                    isTyping={typingId === m.id}
                    speaking={speakingId === m.id}
                    onRegenerate={regenerate}
                    onEdit={(content) => editMessage(m.id, content)}
                    onSpeak={() => toggleSpeak(m)}
                  />
                ))}
                {pending && <ThinkingIndicator label={activityLabel ?? 'Thinking…'} />}
                {liveCommandActivity.length > 0 && <CommandActivityPanel activities={liveCommandActivity} live />}
              </div>
            </div>
            <div className={cn('mx-auto w-full max-w-3xl px-4 pb-4')}>
              <Composer busy={busy} disabled={historyLoading} mode={mode} onModeChange={setMode} onSend={(text, attachments) => send(text, undefined, attachments)} onGenerateImage={generateImage} onStop={stop} onVoiceMode={openVoice} />
              <p className="mt-2 text-center text-xs text-muted-foreground">CTECH AI can make mistakes. Check important info.</p>
            </div>
          </>
        )}
      </main>

      {voiceOpen && activeId && activeProjectId && (
        <VoiceMode
          conversationId={activeId}
          projectId={activeProjectId}
          history={messages}
          onExchange={stableVoiceExchange}
          onClose={closeVoice}
        />
      )}
    </div>
  )
}
