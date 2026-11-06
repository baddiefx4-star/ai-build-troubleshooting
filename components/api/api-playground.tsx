'use client'

import { MessageScroller as MessageScrollerPrimitive } from '@shadcn/react/message-scroller'
import { ArrowUp, Check, Copy, LoaderCircle, RotateCcw } from 'lucide-react'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent, MessageHeader } from '@/components/ui/message'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

const suggestedPrompts = ['What time is it?', 'What can you do?']

function prepareApiMessages(messages: ChatMessage[]) {
  const selected: ChatMessage[] = []
  let totalCharacters = 0

  for (const message of [...messages].reverse()) {
    if (selected.length >= 40 || totalCharacters + message.content.length > 60_000) break
    selected.push(message)
    totalCharacters += message.content.length
  }

  return selected.reverse()
}

export function ApiPlayground() {
  const [apiKey, setApiKey] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [requestStatus, setRequestStatus] = useState<number | null>(null)
const [copiedResource, setCopiedResource] = useState<'endpoint' | 'schema' | 'curl' | null>(null)

async function copyResource(resource: 'endpoint' | 'schema' | 'curl') {
  const endpoint = `${window.location.origin}/api/v1/chat`
  const value = resource === 'endpoint'
    ? endpoint
    : resource === 'schema'
      ? `${window.location.origin}/api/v1/openapi.json`
      : `curl ${endpoint} \\\n  -X POST \\\n  -H "Authorization: Bearer YOUR_CTECH_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"ctech-chat","messages":[{"role":"user","content":"Hello!"}]}'`
  try {
    await navigator.clipboard.writeText(value)
      setCopiedResource(resource)
      setError('')
    } catch {
      setError('Clipboard access is unavailable. Copy the URL from the address bar instead.')
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    const key = apiKey.trim()

    if (!key) {
      setError('Paste an API key created above before sending a request.')
      return
    }
    if (!content || pending) return

    const userMessage: ChatMessage = { role: 'user', content }
    const requestMessages = prepareApiMessages([...messages, userMessage])
    setMessages(requestMessages)
    setDraft('')
    setPending(true)
    setError('')
    setRequestStatus(null)

    try {
      const response = await fetch('/api/v1/chat', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'ctech-chat', messages: requestMessages }),
      })
      setRequestStatus(response.status)
      const payload = await response.json().catch(() => null) as ChatResponse | null

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? `The API returned HTTP ${response.status}.`)
      }

      const reply = payload?.choices?.[0]?.message?.content
      if (typeof reply !== 'string' || !reply.trim()) {
        throw new Error('The API responded, but no assistant message was returned.')
      }

      const assistantMessage: ChatMessage = { role: 'assistant', content: reply }
      setMessages([...requestMessages, assistantMessage].slice(-40))
    } catch (requestError) {
      setMessages(messages)
      setDraft(content)
      setError(requestError instanceof Error ? requestError.message : 'Could not reach the CTECH API.')
    } finally {
      setPending(false)
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  function clearChat() {
    setMessages([])
    setDraft('')
    setError('')
    setRequestStatus(null)
  }

  return (
    <section id="playground" className="scroll-mt-8 border-b border-red-950/60 py-10 sm:py-12">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-400">04 · Interactive playground</p>
        <h2 className="mt-3 text-2xl font-semibold text-white">Try your API</h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Paste a key from above and send a real request to your CTECH chat endpoint. Each successful request uses your account&apos;s AI allowance.
        </p>
      </div>

      <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(17rem,0.8fr)]">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-red-950/70 bg-[#1b1012]/85 shadow-[0_18px_50px_-35px_rgba(239,68,68,0.8)] shadow-xl shadow-black/10">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-950/70 px-4 py-3 sm:px-5">
            <div>
              <p className="text-sm font-semibold text-slate-100">Chat tester</p>
              <code className="mt-1 block font-mono text-xs text-slate-500">POST /api/v1/chat</code>
            </div>
            <div className="flex items-center gap-2">
              {requestStatus !== null && (
                <Badge variant={requestStatus === 200 ? 'secondary' : 'destructive'}>HTTP {requestStatus}</Badge>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={clearChat} disabled={pending || messages.length === 0} aria-label="Clear chat">
                <RotateCcw data-icon="inline-start" aria-hidden="true" />
                Clear
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <FieldGroup>
              <Field>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <FieldLabel htmlFor="ctech-playground-key" className="text-slate-200">API key</FieldLabel>
                  {apiKey && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-slate-400" onClick={() => setApiKey('')}>
                      Forget key
                    </Button>
                  )}
                </div>
                <Input
                  id="ctech-playground-key"
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="ctech_live_…"
                  aria-describedby="ctech-playground-key-help"
                  className="h-10 border-red-950/70 bg-[#120b0c] font-mono text-sm text-slate-100 placeholder:text-slate-600"
                />
                <FieldDescription id="ctech-playground-key-help" className="text-slate-500">
                  Kept only in this tab&apos;s memory; it is sent in the Authorization header and never saved.
                </FieldDescription>
              </Field>
            </FieldGroup>

            <MessageScrollerPrimitive.Provider>
              <MessageScrollerPrimitive.Root className="flex h-80 min-h-64 flex-col overflow-hidden rounded-xl border border-red-950/70 bg-[#120b0c]/90">
              <MessageScrollerPrimitive.Viewport role="log" aria-label="API chat transcript" aria-live="polite" className="h-full min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
                <MessageScrollerPrimitive.Content className="flex min-h-full flex-col justify-end gap-4">
                  {messages.length === 0 ? (
                    <div className="flex min-h-56 flex-col items-center justify-center text-center">
                      <p className="text-sm font-medium text-slate-200">Your API replies will show up here</p>
                      <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">Try a prompt to test the endpoint, key, and model response.</p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {suggestedPrompts.map((prompt) => (
                          <Button key={prompt} type="button" variant="outline" size="sm" className="border-red-950/70 bg-[#1b1012] text-slate-300 hover:bg-slate-800" onClick={() => setDraft(prompt)}>
                            {prompt}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((message, index) => (
                      <MessageScrollerPrimitive.Item key={`${index}-${message.role}`} scrollAnchor={index === messages.length - 1}>
                        <Message align={message.role === 'user' ? 'end' : 'start'}>
                          <MessageContent className="max-w-[90%]">
                            <MessageHeader className="px-1 text-slate-500">{message.role === 'user' ? 'You' : 'CTECH AI'}</MessageHeader>
                            <Bubble align={message.role === 'user' ? 'end' : 'start'} variant={message.role === 'user' ? 'default' : 'secondary'}>
                              <BubbleContent className="whitespace-pre-wrap">{message.content}</BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      </MessageScrollerPrimitive.Item>
                    ))
                  )}
                  {pending && (
                    <MessageScrollerPrimitive.Item scrollAnchor>
                      <Marker className="px-1 text-slate-400">
                        <MarkerIcon><LoaderCircle className="animate-spin" /></MarkerIcon>
                        <MarkerContent>Waiting for CTECH AI…</MarkerContent>
                      </Marker>
                    </MessageScrollerPrimitive.Item>
                  )}
                </MessageScrollerPrimitive.Content>
              </MessageScrollerPrimitive.Viewport>
              </MessageScrollerPrimitive.Root>
            </MessageScrollerPrimitive.Provider>

            {error && <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-sm text-rose-200">{error}</p>}

            <form onSubmit={sendMessage} className="flex flex-col gap-3">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="ctech-playground-message" className="sr-only">Message</FieldLabel>
                  <textarea
                    id="ctech-playground-message"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    maxLength={20_000}
                    rows={3}
                    placeholder="Ask your CTECH API something…"
                    aria-describedby="ctech-playground-message-help"
                    className="w-full resize-y rounded-lg border border-red-950/70 bg-[#120b0c] px-3 py-2.5 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus-visible:border-red-500 focus-visible:ring-2 focus-visible:ring-red-500/20"
                  />
                  <FieldDescription id="ctech-playground-message-help" className="text-slate-500">
                    Enter to send · Shift+Enter for a new line · 20,000 characters max
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <div className="flex items-center justify-end">
                <Button type="submit" disabled={pending || !draft.trim()} className="bg-red-600 text-white hover:bg-red-500">
                  {pending ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <ArrowUp data-icon="inline-start" aria-hidden="true" />}
                  {pending ? 'Sending…' : 'Send request'}
                </Button>
              </div>
            </form>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <div className="rounded-2xl border border-red-950/70 bg-[#1b1012]/85 shadow-[0_18px_50px_-35px_rgba(239,68,68,0.8)] p-5">
            <p className="text-sm font-semibold text-slate-100">Connect a GPT Action</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Generate a key above, import the OpenAPI document in your GPT&apos;s Actions setup, then add the key as Bearer authentication.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="border-red-950/70 bg-[#120b0c] text-slate-200 hover:bg-slate-800" onClick={() => copyResource('schema')}>
                {copiedResource === 'schema' ? <Check data-icon="inline-start" aria-hidden="true" /> : <Copy data-icon="inline-start" aria-hidden="true" />}
                {copiedResource === 'schema' ? 'Schema URL copied' : 'Copy schema URL'}
              </Button>
              <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center rounded-lg border border-red-950/70 px-3 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white">
                Open schema
              </a>
            </div>
            <ol className="mt-4 flex flex-col gap-2 border-t border-red-950/70 pt-4 text-xs leading-5 text-slate-500">
              <li><span className="mr-2 font-mono text-red-400">01</span>Open GPT Builder → Configure → Actions.</li>
              <li><span className="mr-2 font-mono text-red-400">02</span>Import the copied schema URL.</li>
              <li><span className="mr-2 font-mono text-red-400">03</span>Choose Bearer authentication and paste the key you generated above.</li>
            </ol>
          </div>

          <div className="rounded-2xl border border-red-950/70 bg-[#1b1012]/85 shadow-[0_18px_50px_-35px_rgba(239,68,68,0.8)] p-5">
            <p className="text-sm font-semibold text-slate-100">Endpoint</p>
            <code className="mt-2 block break-all rounded-lg border border-red-900/60 bg-[#160b0d] px-3 py-2.5 font-mono text-xs leading-5 text-red-300">POST /api/v1/chat</code>
<div className="mt-2 flex flex-wrap gap-2">
 <Button type="button" variant="ghost" size="sm" className="px-2 text-red-300 hover:bg-red-500/10 hover:text-red-200" onClick={() => copyResource('endpoint')}>
  {copiedResource === 'endpoint' ? <Check data-icon="inline-start" aria-hidden="true" /> : <Copy data-icon="inline-start" aria-hidden="true" />}
  {copiedResource === 'endpoint' ? 'Endpoint URL copied' : 'Copy endpoint URL'}
 </Button>
 <Button type="button" variant="ghost" size="sm" className="px-2 text-red-300 hover:bg-red-500/10 hover:text-red-200" onClick={() => copyResource('curl')}>
  {copiedResource === 'curl' ? <Check data-icon="inline-start" aria-hidden="true" /> : <Copy data-icon="inline-start" aria-hidden="true" />}
  {copiedResource === 'curl' ? 'cURL copied' : 'Copy cURL'}
 </Button>
</div>
            <p className="mt-2 text-xs leading-5 text-slate-500">The API key is never included in either copied URL.</p>
          </div>
        </aside>
      </div>
    </section>
  )
}
