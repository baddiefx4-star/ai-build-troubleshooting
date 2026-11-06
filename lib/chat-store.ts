import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { ctechConversations, ctechMessages, ctechProjects, ctechUserPreferences } from '@/lib/db/schema'
import type { ChatMode } from '@/lib/prompt'
import type { CommandActivity, Conversation, Message, Project, VoicePreference } from '@/lib/types'
import { DEFAULT_ELEVENLABS_VOICE_ID, DEFAULT_ELEVENLABS_VOICE_NAME } from '@/lib/voice-config'

export type TranscriptMessage = Pick<Message, 'role' | 'content'>

const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/
const VALID_MODES = new Set<ChatMode>(['chat', 'code', 'reason', 'creative', 'research'])
const MAX_MESSAGES = 40
const MAX_MESSAGE_CHARS = 250_000
const MAX_ASSISTANT_CHARS = 60_000
const MAX_TRANSCRIPT_CHARS = 350_000

export function isValidConversationId(value: unknown): value is string {
  return typeof value === 'string' && CONVERSATION_ID_PATTERN.test(value)
}

export function normalizeMode(value: unknown): ChatMode {
  return typeof value === 'string' && VALID_MODES.has(value as ChatMode) ? (value as ChatMode) : 'chat'
}

export function sanitizeMessages(value: unknown): TranscriptMessage[] {
  if (!Array.isArray(value)) return []

  let totalChars = 0
  const sanitized: TranscriptMessage[] = []
  for (const item of value.slice(-MAX_MESSAGES).reverse()) {
    if (!item || (item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string') continue
    const remaining = MAX_TRANSCRIPT_CHARS - totalChars
    if (remaining <= 0) break
    const content = item.content.slice(0, Math.min(MAX_MESSAGE_CHARS, remaining))
    sanitized.push({ role: item.role, content })
    totalChars += content.length
  }
  return sanitized.reverse()
}

export function titleFromMessages(messages: TranscriptMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content ?? ''
  const title = firstUserMessage.replace(/\s+/g, ' ').trim()
  return title.length > 42 ? `${title.slice(0, 42)}…` : title || 'New chat'
}

function toConversationMode(value: string): ChatMode {
  return normalizeMode(value)
}

function toProject(row: { id: string; name: string; memory: string; updatedAt: Date }): Project {
  return { ...row, updatedAt: row.updatedAt.getTime() }
}

export async function ensureDefaultProject(userId: string): Promise<string> {
  await db.insert(ctechProjects).values({ id: `default-${randomUUID()}`, userId, name: 'My Project' }).onConflictDoNothing()
  const [project] = await db
    .select({ id: ctechProjects.id })
    .from(ctechProjects)
    .where(and(eq(ctechProjects.userId, userId), eq(ctechProjects.name, 'My Project')))
    .limit(1)
  if (!project) throw new Error('Could not create the default project.')
  return project.id
}

export async function listProjects(userId: string): Promise<Project[]> {
  await ensureDefaultProject(userId)
  const rows = await db
    .select({ id: ctechProjects.id, name: ctechProjects.name, memory: ctechProjects.memory, updatedAt: ctechProjects.updatedAt })
    .from(ctechProjects)
    .where(eq(ctechProjects.userId, userId))
    .orderBy(desc(ctechProjects.updatedAt), asc(ctechProjects.name))
  return rows.map(toProject)
}

export async function getProject(userId: string, projectId: string): Promise<Project | null> {
  const [row] = await db
    .select({ id: ctechProjects.id, name: ctechProjects.name, memory: ctechProjects.memory, updatedAt: ctechProjects.updatedAt })
    .from(ctechProjects)
    .where(and(eq(ctechProjects.id, projectId), eq(ctechProjects.userId, userId)))
    .limit(1)
  return row ? toProject(row) : null
}

export async function createProject(userId: string, name: string): Promise<Project> {
  const [row] = await db
    .insert(ctechProjects)
    .values({ id: randomUUID(), userId, name: name.trim(), memory: '' })
    .onConflictDoNothing()
    .returning({ id: ctechProjects.id, name: ctechProjects.name, memory: ctechProjects.memory, updatedAt: ctechProjects.updatedAt })
  if (!row) throw new Error('A project with that name already exists.')
  return toProject(row)
}

export async function updateProject(userId: string, projectId: string, changes: { name?: string; memory?: string }): Promise<Project | null> {
  const [row] = await db
    .update(ctechProjects)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(ctechProjects.id, projectId), eq(ctechProjects.userId, userId)))
    .returning({ id: ctechProjects.id, name: ctechProjects.name, memory: ctechProjects.memory, updatedAt: ctechProjects.updatedAt })
  return row ? toProject(row) : null
}

export async function getVoicePreference(userId: string): Promise<VoicePreference> {
  const [row] = await db
    .select({ voiceId: ctechUserPreferences.voiceId, voiceName: ctechUserPreferences.voiceName })
    .from(ctechUserPreferences)
    .where(eq(ctechUserPreferences.userId, userId))
    .limit(1)
  const fallback = {
    voiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID,
    voiceName: DEFAULT_ELEVENLABS_VOICE_NAME,
  }
  return row && /^[A-Za-z0-9_-]{1,128}$/.test(row.voiceId) ? row : fallback
}

export async function saveVoicePreference(userId: string, preference: VoicePreference): Promise<VoicePreference> {
  const [row] = await db
    .insert(ctechUserPreferences)
    .values({ userId, ...preference })
    .onConflictDoUpdate({
      target: ctechUserPreferences.userId,
      set: { ...preference, updatedAt: new Date() },
    })
    .returning({ voiceId: ctechUserPreferences.voiceId, voiceName: ctechUserPreferences.voiceName })
  return row
}

export async function listConversations(userId: string, projectId: string): Promise<Conversation[]> {
  const rows = await db
    .select({ id: ctechConversations.id, projectId: ctechConversations.projectId, title: ctechConversations.title, mode: ctechConversations.mode, updatedAt: ctechConversations.updatedAt })
    .from(ctechConversations)
    .where(and(eq(ctechConversations.userId, userId), eq(ctechConversations.projectId, projectId)))
    .orderBy(desc(ctechConversations.updatedAt))
    .limit(50)

  return rows.map((row) => ({
    ...row,
    mode: toConversationMode(row.mode),
    updatedAt: row.updatedAt.getTime(),
    messages: [],
  }))
}

export async function searchConversations(userId: string, projectId: string, query: string): Promise<Conversation[]> {
  const escapedQuery = query.trim().replace(/[\\%_]/g, '\\$&')
  if (!escapedQuery) return listConversations(userId, projectId)
  const pattern = `%${escapedQuery}%`
  const rows = await db
    .select({
      id: ctechConversations.id,
      projectId: ctechConversations.projectId,
      title: ctechConversations.title,
      mode: ctechConversations.mode,
      updatedAt: ctechConversations.updatedAt,
      matchedContent: ctechMessages.content,
    })
    .from(ctechConversations)
    .leftJoin(ctechMessages, and(eq(ctechMessages.conversationId, ctechConversations.id), eq(ctechMessages.userId, userId)))
    .where(and(
      eq(ctechConversations.userId, userId),
      eq(ctechConversations.projectId, projectId),
      or(ilike(ctechConversations.title, pattern), ilike(ctechMessages.content, pattern)),
    ))
    .orderBy(desc(ctechConversations.updatedAt))
    .limit(120)

  const matches = new Map<string, Conversation>()
  for (const row of rows) {
    if (matches.has(row.id)) continue
    const content = row.matchedContent?.replace(/\s+/g, ' ').trim() ?? ''
    const matchIndex = content.toLowerCase().indexOf(query.trim().toLowerCase())
    const start = Math.max(0, matchIndex - 48)
    const end = Math.min(content.length, Math.max(matchIndex, 0) + query.trim().length + 100)
    const searchSnippet = matchIndex >= 0 ? `${start ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}` : undefined
    matches.set(row.id, {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      mode: toConversationMode(row.mode),
      updatedAt: row.updatedAt.getTime(),
      searchSnippet,
      messages: [],
    })
  }
  return [...matches.values()].slice(0, 40)
}

export async function getConversation(userId: string, conversationId: string): Promise<Conversation | null> {
  const [row] = await db
    .select({ id: ctechConversations.id, projectId: ctechConversations.projectId, title: ctechConversations.title, mode: ctechConversations.mode, updatedAt: ctechConversations.updatedAt })
    .from(ctechConversations)
    .where(and(eq(ctechConversations.id, conversationId), eq(ctechConversations.userId, userId)))
    .limit(1)

  if (!row) return null

  const rows = await db
    .select({ id: ctechMessages.id, role: ctechMessages.role, content: ctechMessages.content, activity: ctechMessages.activity })
    .from(ctechMessages)
    .where(and(eq(ctechMessages.conversationId, conversationId), eq(ctechMessages.userId, userId)))
    .orderBy(asc(ctechMessages.createdAt))
    .limit(100)

  return {
    ...row,
    mode: toConversationMode(row.mode),
    updatedAt: row.updatedAt.getTime(),
    messages: rows.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      commandActivity: message.activity ?? undefined,
    })),
  }
}

export async function rememberConversation(userId: string, conversationId: string, projectId: string, mode: ChatMode, messages: TranscriptMessage[]) {
  const now = new Date()
  const title = titleFromMessages(messages)

  await db.transaction(async (transaction) => {
    const [project] = await transaction
      .select({ id: ctechProjects.id })
      .from(ctechProjects)
      .where(and(eq(ctechProjects.id, projectId), eq(ctechProjects.userId, userId)))
      .limit(1)
    if (!project) throw new Error('Project not found.')

    const [ownedConversation] = await transaction
      .select({ id: ctechConversations.id, projectId: ctechConversations.projectId })
      .from(ctechConversations)
      .where(and(eq(ctechConversations.id, conversationId), eq(ctechConversations.userId, userId)))
      .limit(1)

    if (ownedConversation && ownedConversation.projectId !== projectId) throw new Error('Conversation belongs to another project.')
    if (ownedConversation) {
      await transaction
        .update(ctechConversations)
        .set({ mode, updatedAt: now })
        .where(and(eq(ctechConversations.id, conversationId), eq(ctechConversations.userId, userId)))
    } else {
      await transaction.insert(ctechConversations).values({ id: conversationId, userId, projectId, title, mode, createdAt: now, updatedAt: now })
    }

    const previousMessages = await transaction
      .select({ role: ctechMessages.role, content: ctechMessages.content, activity: ctechMessages.activity })
      .from(ctechMessages)
      .where(and(eq(ctechMessages.conversationId, conversationId), eq(ctechMessages.userId, userId)))
      .orderBy(asc(ctechMessages.createdAt))
    const previousActivity = new Map<string, CommandActivity[][]>()
    for (const message of previousMessages) {
      if (!message.activity?.length) continue
      const key = `${message.role}\u0000${message.content}`
      const queue = previousActivity.get(key) ?? []
      queue.push(message.activity)
      previousActivity.set(key, queue)
    }

    await transaction
      .delete(ctechMessages)
      .where(and(eq(ctechMessages.conversationId, conversationId), eq(ctechMessages.userId, userId)))

    if (messages.length) {
      await transaction.insert(ctechMessages).values(
        messages.map((message, index) => {
          const key = `${message.role}\u0000${message.content}`
          const activity = previousActivity.get(key)?.shift()
          return {
            id: randomUUID(),
            userId,
            conversationId,
            role: message.role,
            content: message.content,
            activity: activity ?? null,
            createdAt: new Date(now.getTime() + index),
          }
        }),
      )
    }
  })

  return title
}

export async function rememberAssistantReply(userId: string, conversationId: string, mode: ChatMode, content: string, activity: CommandActivity[] = []) {
  const id = randomUUID()
  const now = new Date()

  await db.transaction(async (transaction) => {
    const [ownedConversation] = await transaction
      .select({ id: ctechConversations.id })
      .from(ctechConversations)
      .where(and(eq(ctechConversations.id, conversationId), eq(ctechConversations.userId, userId)))
      .limit(1)

    if (!ownedConversation) throw new Error('Conversation not found.')

    await transaction.insert(ctechMessages).values({
      id,
      userId,
      conversationId,
      role: 'assistant',
      content: content.slice(0, MAX_ASSISTANT_CHARS),
      activity: activity.length ? activity : null,
      createdAt: now,
    })
    await transaction
      .update(ctechConversations)
      .set({ mode, updatedAt: now })
      .where(and(eq(ctechConversations.id, conversationId), eq(ctechConversations.userId, userId)))
  })

  return id
}

export async function claimGuestConversations(guestUserId: string, userId: string, projectId?: string) {
  if (!guestUserId || guestUserId === userId) return
  const assignedProjectId = projectId ?? await ensureDefaultProject(userId)

  await db.transaction(async (transaction) => {
    await transaction
      .update(ctechConversations)
      .set({ userId, projectId: assignedProjectId })
      .where(eq(ctechConversations.userId, guestUserId))
    await transaction
      .update(ctechMessages)
      .set({ userId })
      .where(eq(ctechMessages.userId, guestUserId))
  })
}

export async function removeConversation(userId: string, conversationId: string) {
  await db.transaction(async (transaction) => {
    await transaction
      .delete(ctechMessages)
      .where(and(eq(ctechMessages.conversationId, conversationId), eq(ctechMessages.userId, userId)))
    await transaction
      .delete(ctechConversations)
      .where(and(eq(ctechConversations.id, conversationId), eq(ctechConversations.userId, userId)))
  })
}
