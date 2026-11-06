'use client'

import { Check, Copy, KeyRound, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

type ApiKeySummary = {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
}

type CreateKeyResponse = {
  key: string
  apiKey: ApiKeySummary
}

export function ApiKeyManager({ initialKeys }: { initialKeys: ApiKeySummary[] }) {
  const [keys, setKeys] = useState(initialKeys)
  const [name, setName] = useState('')
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const activeKeys = keys

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    setNotice('')
    setRevealedKey(null)
    setCopied(false)

    try {
      const response = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const payload = await response.json().catch(() => null) as CreateKeyResponse | { error?: string } | null
      if (!response.ok || !payload || !('key' in payload) || !('apiKey' in payload)) {
        throw new Error(payload && 'error' in payload ? payload.error : 'Could not create an API key.')
      }

      setKeys((current) => [payload.apiKey, ...current])
      setRevealedKey(payload.key)
      setName('')
      setNotice('Your new API key is ready. Copy it now; it will not be shown again.')
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : 'Could not create an API key.')
    } finally {
      setPending(false)
    }
  }

  async function copyKey() {
    if (!revealedKey) return
    try {
      await navigator.clipboard.writeText(revealedKey)
      setCopied(true)
    } catch {
      setError('Clipboard access is unavailable. Select the key and copy it manually.')
    }
  }

  async function revokeKey(id: string, keyName: string) {
    if (!window.confirm(`Revoke the API key “${keyName}”? Applications using it will stop working.`)) return
    setRevokingId(id)
    setError('')
    setNotice('')

    try {
      const response = await fetch(`/api/v1/keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error ?? 'Could not revoke this API key.')
      }
      setKeys((current) => current.filter((key) => key.id !== id))
      setNotice(`“${keyName}” was revoked.`)
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke this API key.')
    } finally {
      setRevokingId(null)
    }
  }

  function handleNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) {
      event.preventDefault()
    }
  }

  return (
    <section id="keys" className="scroll-mt-8 rounded-2xl border border-red-950/70 bg-[#1b1012]/85 shadow-[0_18px_50px_-35px_rgba(239,68,68,0.8)] p-5 shadow-xl shadow-black/10 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-red-400" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-white">API keys</h2>
          </div>
          <p className="mt-1 max-w-xl text-sm leading-6 text-slate-400">
            Create keys for your integrations. Keys are stored as hashes and can be revealed only once.
          </p>
        </div>
        <span className="rounded-full border border-red-900/70 bg-red-500/5 px-3 py-1 text-xs font-medium text-red-200">
          {activeKeys.length} / 10 active
        </span>
      </div>

      <form onSubmit={createKey} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <FieldGroup className="flex-1">
          <Field>
            <FieldLabel htmlFor="api-key-name" className="text-slate-200">Key name</FieldLabel>
            <Input
              id="api-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={handleNameKeyDown}
              maxLength={60}
              required
              placeholder="Production app"
              autoComplete="off"
              className="h-10 border-red-950/70 bg-[#120b0c] text-slate-100 placeholder:text-slate-500"
            />
            <FieldDescription className="text-slate-500">Use a label that helps you identify where the key is used.</FieldDescription>
          </Field>
        </FieldGroup>
        <Button type="submit" disabled={pending || activeKeys.length >= 10} className="h-10 shrink-0">
          {pending ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Plus data-icon="inline-start" aria-hidden="true" />}
          {pending ? 'Creating…' : activeKeys.length >= 10 ? 'Key limit reached' : 'Create API key'}
        </Button>
      </form>

      {error && <FieldError className="mt-3" role="alert">{error}</FieldError>}
      {notice && <p className="mt-3 text-sm text-emerald-300" role="status">{notice}</p>}

      {revealedKey && (
        <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-200">Copy your key now</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">For security, the full key is not saved and cannot be retrieved later.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={copyKey}>
              {copied ? <Check data-icon="inline-start" aria-hidden="true" /> : <Copy data-icon="inline-start" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy key'}
            </Button>
          </div>
          <code className="mt-3 block overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 px-3 py-3 font-mono text-xs leading-5 text-emerald-200 [overflow-wrap:anywhere]">
            {revealedKey}
          </code>
          <Button type="button" variant="ghost" size="sm" className="mt-2 text-slate-400" onClick={() => setRevealedKey(null)}>
            Hide key
          </Button>
        </div>
      )}

      <div className="mt-6 border-t border-slate-800 pt-5">
        <h3 className="text-sm font-semibold text-slate-200">Active keys</h3>
        {activeKeys.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-700 px-4 py-5 text-sm text-slate-400">
            No active keys yet. Create one to authenticate your first API request.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-slate-800">
            {activeKeys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">{key.name}</p>
                  <p className="mt-1 font-mono text-xs text-slate-500">{key.prefix} · Created {key.createdAt.slice(0, 10)}</p>
                  <p className="mt-1 text-xs text-slate-500">Last used: {key.lastUsedAt ? key.lastUsedAt.slice(0, 10) : 'Never'}</p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={revokingId === key.id}
                  aria-busy={revokingId === key.id}
                  onClick={() => revokeKey(key.id, key.name)}
                >
                  {revokingId === key.id ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Trash2 data-icon="inline-start" aria-hidden="true" />}
                  {revokingId === key.id ? 'Revoking…' : 'Revoke'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
