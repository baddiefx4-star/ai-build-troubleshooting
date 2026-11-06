'use client'

import { Braces, CreditCard, FolderKanban, LogOut, MessageSquare, PanelLeftClose, Plus, Search, Settings2, SquarePen, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import type { Conversation, Project } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Logo } from './logo'

type Props = {
  open: boolean
  userEmail: string
  signingOut: boolean
  onSignOut: () => void
  conversations: Conversation[]
  projects: Project[]
  activeProjectId: string | null
  activeProjectMemory: string
  onProjectChange: (projectId: string) => void
  onCreateProject: (name: string) => Promise<void>
  onSaveMemory: (projectId: string, memory: string) => Promise<void>
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onClose: () => void
}

async function fetchSearchResults(url: string): Promise<Conversation[]> {
  const response = await fetch(url, { cache: 'no-store' })
  const data = await response.json().catch(() => [])
  if (!response.ok) throw new Error(data?.error || 'Could not search conversations.')
  return data as Conversation[]
}

export function Sidebar({
  open,
  userEmail,
  signingOut,
  onSignOut,
  conversations,
  projects,
  activeProjectId,
  activeProjectMemory,
  onProjectChange,
  onCreateProject,
  onSaveMemory,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectError, setProjectError] = useState<string | null>(null)
  const [memoryDraft, setMemoryDraft] = useState(activeProjectMemory)
  const [memorySaving, setMemorySaving] = useState(false)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [memorySaved, setMemorySaved] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setMemoryDraft(activeProjectMemory)
    setMemoryError(null)
    setMemorySaved(false)
  }, [activeProjectId, activeProjectMemory])

  const searchUrl = activeProjectId && debouncedQuery
    ? `/api/conversations?projectId=${encodeURIComponent(activeProjectId)}&q=${encodeURIComponent(debouncedQuery)}`
    : null
  const { data: searchResults, isLoading: searchLoading, error: searchError } = useSWR<Conversation[]>(searchUrl, fetchSearchResults, { revalidateOnFocus: false })
  const waitingForSearch = Boolean(query.trim() && (!debouncedQuery || debouncedQuery !== query.trim() || searchLoading))
  const filtered = [...(query.trim() ? (waitingForSearch ? [] : searchResults ?? []) : conversations)]
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const createProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!projectName.trim()) return
    setProjectError(null)
    try {
      await onCreateProject(projectName.trim())
      setProjectName('')
      setCreatingProject(false)
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Could not create this project.')
    }
  }

  const saveMemory = async () => {
    if (!activeProjectId) return
    setMemorySaving(true)
    setMemoryError(null)
    setMemorySaved(false)
    try {
      await onSaveMemory(activeProjectId, memoryDraft)
      setMemorySaved(true)
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'Could not save project memory.')
    } finally {
      setMemorySaving(false)
    }
  }

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn('fixed inset-0 z-30 bg-black/60 transition-opacity md:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <aside
        aria-label="Chat history"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 md:static md:z-auto md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full md:hidden',
        )}
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="px-1">
            <Logo />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftClose className="size-[18px]" />
          </button>
        </div>

        <div className="flex flex-col gap-1 px-3 py-2">
          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent"
          >
            <SquarePen className="size-4" />
            New chat
          </button>
          <Link
            href="/plans"
            onClick={onClose}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent"
          >
            <CreditCard className="size-4" />
            Plans &amp; billing
          </Link>
          <Link
            href="/settings"
            onClick={onClose}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent"
          >
            <Settings2 className="size-4" />
            Settings
          </Link>
          <Link
            href="/docs/api"
            onClick={onClose}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent"
          >
            <Braces className="size-4" />
            API reference
          </Link>
          <div className="mt-2 flex items-center gap-2">
            <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="active-project" className="sr-only">Active project</label>
            <select
              id="active-project"
              value={activeProjectId ?? ''}
              onChange={(event) => onProjectChange(event.target.value)}
              disabled={!projects.length}
              className="min-w-0 flex-1 rounded-lg border border-sidebar-border bg-background px-2 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => {
                setCreatingProject((current) => !current)
                setProjectError(null)
              }}
              aria-label="Create project"
              className="rounded-lg border border-sidebar-border p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>
          {creatingProject && (
            <form onSubmit={createProject} className="mt-2 flex flex-col gap-2 rounded-lg border border-sidebar-border p-2">
              <label htmlFor="new-project-name" className="text-xs font-medium text-muted-foreground">New project</label>
              <input
                id="new-project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                maxLength={60}
                required
                autoFocus
                placeholder="Project name"
                className="w-full rounded-md border border-sidebar-border bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {projectError && <p role="alert" className="text-xs text-destructive">{projectError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCreatingProject(false)} className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent">Cancel</button>
                <button type="submit" className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground">Create</button>
              </div>
            </form>
          )}
          <details className="mt-1 rounded-lg border border-sidebar-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">Project memory</summary>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Notes saved here are included as context in this project&apos;s chats.</p>
            <label htmlFor="project-memory" className="sr-only">Project memory notes</label>
            <textarea
              id="project-memory"
              value={memoryDraft}
              onChange={(event) => {
                setMemoryDraft(event.target.value)
                setMemorySaved(false)
              }}
              maxLength={8000}
              rows={5}
              placeholder="Add project facts, goals, or preferences…"
              className="mt-2 w-full resize-y rounded-md border border-sidebar-border bg-background px-2.5 py-2 text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {memoryError && <p role="alert" className="mt-1 text-xs text-destructive">{memoryError}</p>}
            {memorySaved && <p role="status" className="mt-1 text-xs text-muted-foreground">Memory saved.</p>}
            <button
              type="button"
              onClick={() => void saveMemory()}
              disabled={!activeProjectId || memorySaving || memoryDraft === activeProjectMemory}
              className="mt-2 w-full rounded-md bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {memorySaving ? 'Saving…' : 'Save memory'}
            </button>
          </details>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="w-full rounded-lg bg-transparent py-2 pr-3 pl-10 text-sm outline-none placeholder:text-muted-foreground hover:bg-sidebar-accent focus:bg-sidebar-accent"
            />
          </div>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-3">
          <p className="px-3 pt-3 pb-2 text-xs font-medium text-muted-foreground">Chats</p>
          {searchError && query.trim() ? (
            <p role="alert" className="px-3 py-2 text-sm text-destructive">Could not search this project&apos;s chats.</p>
          ) : waitingForSearch ? (
            <p className="px-3 py-2 text-sm text-muted-foreground" role="status">Searching messages…</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{query ? 'No matching chats' : 'Your conversations will appear here.'}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filtered.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    aria-current={c.id === activeId ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg py-2 pr-9 pl-3 text-left text-sm transition-colors hover:bg-sidebar-accent',
                      c.id === activeId && 'bg-sidebar-accent',
                    )}
                  >
                    <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.title}</span>
                      {query.trim() && c.searchSnippet && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{c.searchSnippet}</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    aria-label={`Delete ${c.title}`}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100 focus:opacity-100 max-md:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary" aria-hidden="true">
              {userEmail.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Your account</p>
              <p className="truncate text-xs text-muted-foreground" title={userEmail}>{userEmail}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            aria-busy={signingOut}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          >
            <LogOut className="size-4" aria-hidden="true" />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>
    </>
  )
}
