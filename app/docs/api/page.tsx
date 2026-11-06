import type { Metadata } from 'next'
import Link from 'next/link'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { ApiKeyManager } from '@/components/api/api-key-manager'
import { ApiPlayground } from '@/components/api/api-playground'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { ctechApiKeys } from '@/lib/db/schema'
import { headers } from 'next/headers'

export const metadata: Metadata = {
  title: 'CTECH AI API Reference',
  description: 'Generate a CTECH AI API key, test it in the playground, and connect your app or GPT Action.'
}

const javascriptExample = `const response = await fetch("https://ai-build-troubleshooting.vercel.app/api/v1/chat", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_CTECH_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "ctech-chat",
    messages: [{ role: "user", content: "Hello!" }]
  })
});

const result = await response.json();
console.log(result.choices[0].message.content);`

const curlExample = `curl https://ai-build-troubleshooting.vercel.app/api/v1/chat \\
  -X POST \\
  -H "Authorization: Bearer YOUR_CTECH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"ctech-chat","messages":[{"role":"user","content":"Hello!"}]}'`

export default async function ApiDocsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const keyRows = session?.user
    ? await db
        .select({
          id: ctechApiKeys.id,
          name: ctechApiKeys.name,
          prefix: ctechApiKeys.keyPrefix,
          createdAt: ctechApiKeys.createdAt,
          lastUsedAt: ctechApiKeys.lastUsedAt,
        })
        .from(ctechApiKeys)
        .where(and(eq(ctechApiKeys.userId, session.user.id), isNull(ctechApiKeys.revokedAt)))
        .orderBy(desc(ctechApiKeys.createdAt))
    : []

  const keys = keyRows.map((key) => ({
    ...key,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
  }))

  return (
    <div className="min-h-screen bg-[#100b0c] text-slate-100 selection:bg-red-500/30">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-red-950/60 bg-[#0e090a] px-5 py-6 md:flex">
        <Link href="/" className="flex items-center gap-3 rounded-xl px-2 py-2" aria-label="CTECH AI home">
          <span className="grid size-9 place-items-center rounded-xl bg-red-600/10 font-mono text-sm font-bold text-red-400" aria-hidden="true">C</span>
          <span>
            <span className="block text-sm font-semibold text-white">CTECH AI</span>
            <span className="block text-xs text-red-200/45">Developer platform</span>
          </span>
        </Link>
        <nav aria-label="API documentation" className="mt-10 flex flex-col gap-1 text-sm">
          <a href="#overview" className="rounded-lg px-3 py-2 text-slate-300 transition hover:bg-[#1b1012] hover:text-white">Overview</a>
          <a href="#keys" className="rounded-lg px-3 py-2 text-slate-400 transition hover:bg-[#1b1012] hover:text-white">API keys</a>
          <a href="#playground" className="rounded-lg px-3 py-2 text-slate-400 transition hover:bg-[#1b1012] hover:text-white">Playground</a>
          <a href="#authentication" className="rounded-lg px-3 py-2 text-slate-400 transition hover:bg-[#1b1012] hover:text-white">Authentication</a>
          <a href="#chat-endpoint" className="rounded-lg px-3 py-2 text-slate-400 transition hover:bg-[#1b1012] hover:text-white">Chat completions</a>
          <a href="#errors" className="rounded-lg px-3 py-2 text-slate-400 transition hover:bg-[#1b1012] hover:text-white">Errors &amp; limits</a>
        </nav>
        <div className="mt-auto rounded-2xl border border-red-950/70 bg-gradient-to-br from-red-950/40 to-[#1b1012] p-4 shadow-[0_18px_45px_-30px_rgba(239,68,68,0.9)]">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">API status</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-200">
            <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
            Chat API v1 available
          </p>
        </div>
      </aside>

      <div className="md:pl-64">
        <nav aria-label="API documentation" className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-red-950/60 bg-[#120b0c]/95 px-4 py-3 backdrop-blur md:hidden">
          <a href="#overview" className="shrink-0 rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-200">Overview</a>
          <a href="#keys" className="shrink-0 rounded-full border border-red-950/70 px-3 py-1.5 text-xs text-slate-400">API keys</a>
          <a href="#playground" className="shrink-0 rounded-full border border-red-950/70 px-3 py-1.5 text-xs text-slate-400">Playground</a>
          <a href="#authentication" className="shrink-0 rounded-full border border-red-950/70 px-3 py-1.5 text-xs text-slate-400">Authentication</a>
          <a href="#chat-endpoint" className="shrink-0 rounded-full border border-red-950/70 px-3 py-1.5 text-xs text-slate-400">Chat</a>
          <a href="#errors" className="shrink-0 rounded-full border border-red-950/70 px-3 py-1.5 text-xs text-slate-400">Errors</a>
        </nav>

        <main id="overview" className="relative mx-auto max-w-6xl overflow-hidden px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
          <div className="pointer-events-none absolute -right-40 -top-32 h-96 w-96 rounded-full bg-red-600/10 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute left-1/3 top-20 h-px w-2/3 bg-gradient-to-r from-red-500/40 via-red-500/5 to-transparent" aria-hidden="true" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/" className="text-sm text-slate-400 transition hover:text-white md:hidden">← Back to CTECH AI</Link>
            <span className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300">
              <span className="size-1.5 rounded-full bg-red-600" aria-hidden="true" />
              API version 1
            </span>
          </div>

          <header className="mt-8 max-w-3xl">
            <p className="text-sm font-medium tracking-wide text-red-400">CTECH AI · DEVELOPER PLATFORM</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">API Reference</h1>
            <p className="mt-4 text-base leading-7 text-slate-400 sm:text-lg">
              Generate a key, test it in the playground, then connect your app or GPT Action to the CTECH AI chat API.
            </p>
          </header>

          <section className="mt-8 grid gap-3 sm:grid-cols-3" aria-label="API overview">
            <div className="rounded-2xl border border-red-950/60 bg-[#1b1012]/80 p-4 shadow-[0_16px_50px_-35px_rgba(239,68,68,0.8)] transition-colors hover:border-red-800/70">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Base path</p>
              <code className="mt-2 block font-mono text-sm text-red-400">/api/v1</code>
            </div>
            <div className="rounded-2xl border border-red-950/60 bg-[#1b1012]/80 p-4 shadow-[0_16px_50px_-35px_rgba(239,68,68,0.8)] transition-colors hover:border-red-800/70">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Authentication</p>
              <p className="mt-2 text-sm text-slate-200">Bearer API key</p>
            </div>
            <div className="rounded-2xl border border-red-950/60 bg-[#1b1012]/80 p-4 shadow-[0_16px_50px_-35px_rgba(239,68,68,0.8)] transition-colors hover:border-red-800/70">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Response format</p>
              <p className="mt-2 text-sm text-slate-200">OpenAI-compatible JSON</p>
            </div>
          </section>

          <section aria-labelledby="quick-start-title" className="mt-8 rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-950/70 via-[#1b1012] to-[#120b0c] p-5 sm:p-6">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-400">Quick start</p>
              <h2 id="quick-start-title" className="mt-2 text-xl font-semibold text-white">Generate a key. Connect your first app.</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">Use one key for direct API requests, the interactive playground, or a GPT Action.</p>
            </div>
            <ol className="mt-5 grid gap-3 sm:grid-cols-3">
              <li className="rounded-xl border border-red-950/70 bg-[#120b0c]/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-400">01 · Generate</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">Sign in and create a named API key below. The full secret appears once.</p>
              </li>
              <li className="rounded-xl border border-red-950/70 bg-[#120b0c]/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-400">02 · Add</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">Paste it into the playground or send it as a Bearer key from your server.</p>
              </li>
              <li className="rounded-xl border border-red-950/70 bg-[#120b0c]/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-red-400">03 · Test</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">Send a chat request below. Successful requests use your CTECH AI allowance.</p>
              </li>
            </ol>
            <div className="mt-5 flex flex-wrap gap-3">
              <a href="#keys" className="inline-flex h-9 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-600/90">Create an API key</a>
              <a href="#playground" className="inline-flex h-9 items-center justify-center rounded-lg border border-red-500/30 px-4 text-sm font-medium text-red-400 transition hover:bg-red-600/10">Try the playground</a>
            </div>
          </section>

          <div className="mt-8">
            {session?.user ? (
              <ApiKeyManager initialKeys={keys} />
            ) : (
              <section id="keys" className="scroll-mt-24 rounded-2xl border border-red-950/70 bg-[#1b1012]/70 p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Create an API key</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-400">Sign in to generate a key. Copy the full secret when it appears; for security, it is shown only once.</p>
                  </div>
                  <Link href="/sign-in" className="inline-flex h-9 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-600/90">
                    Sign in to manage keys
                  </Link>
                </div>
              </section>
            )}
          </div>

          <ApiPlayground />

          <section id="authentication" className="scroll-mt-8 border-b border-red-950/60 py-10 sm:py-12">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-400">01 · Authentication</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">Use your key securely</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Send your API key in the <code className="rounded bg-[#1b1012] px-1.5 py-0.5 font-mono text-xs text-slate-200">Authorization</code> header using the Bearer scheme. The full key is shown only once, stored as a hash, and can be revoked from this page.
              </p>
              <div className="mt-5 rounded-xl border border-red-950/70 bg-[#1b1012]/70 p-4">
                <pre className="overflow-x-auto whitespace-pre font-mono text-xs leading-6 text-emerald-300"><code>{'Authorization: Bearer YOUR_CTECH_API_KEY'}</code></pre>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                The built-in playground uses a pasted test key only in this browser tab and sends it to this CTECH origin. For production integrations, keep secret keys on your server; never bundle them into public client code or a repository.
              </p>
            </div>
          </section>

          <section id="chat-endpoint" className="scroll-mt-8 border-b border-red-950/60 py-10 sm:py-12">
            <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-400">02 · Chat completions</p>
                <div className="mt-3 flex items-center gap-3">
                  <span className="rounded-md bg-emerald-400/10 px-2.5 py-1 font-mono text-xs font-bold text-emerald-300">POST</span>
                  <span className="text-xs text-slate-500">JSON · non-streaming</span>
                </div>
                <h2 className="mt-4 text-2xl font-semibold text-white">Generate a chat response</h2>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                Send up to 40 user and assistant messages with 60,000 combined characters max. CTECH AI supplies its system instructions server-side; custom system messages are not accepted.
              </p>
              <a href="#playground" className="mt-3 inline-flex text-sm font-medium text-red-400 transition hover:text-red-400">Try a request in the playground →</a>
                <div className="mt-5 rounded-lg border border-red-950/70 bg-[#1b1012] px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Endpoint</p>
                  <code className="mt-1 block break-all font-mono text-sm text-red-400">https://ai-build-troubleshooting.vercel.app/api/v1/chat</code>
                </div>
                <dl className="mt-5 flex min-w-0 flex-col gap-3 text-sm">
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3"><dt className="text-slate-500">model</dt><dd className="min-w-0 break-words text-right font-mono text-slate-300">ctech-chat</dd></div>
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3"><dt className="text-slate-500">messages</dt><dd className="min-w-0 break-words text-right text-slate-300">1–40 user / assistant messages</dd></div>
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3"><dt className="text-slate-500">max_tokens</dt><dd className="min-w-0 break-words text-right font-mono text-slate-300">1–4096 · default 1024</dd></div>
                </dl>
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                <div className="min-w-0 overflow-hidden rounded-xl border border-red-900/60 bg-[#160b0d] shadow-[0_18px_50px_-35px_rgba(239,68,68,0.85)]">
                  <div className="flex items-center justify-between border-b border-red-950/60 px-4 py-3">
                    <p className="text-xs font-medium text-slate-400">JavaScript</p>
                    <span className="text-[10px] uppercase tracking-wider text-slate-600">Example request</span>
                  </div>
                  <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-5 text-slate-300"><code>{javascriptExample}</code></pre>
                </div>
                <div className="min-w-0 overflow-hidden rounded-xl border border-red-900/60 bg-[#160b0d] shadow-[0_18px_50px_-35px_rgba(239,68,68,0.85)]">
                  <div className="flex items-center justify-between border-b border-red-950/60 px-4 py-3">
                    <p className="text-xs font-medium text-slate-400">cURL</p>
                    <span className="text-[10px] uppercase tracking-wider text-slate-600">Example request</span>
                  </div>
                  <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-5 text-slate-300"><code>{curlExample}</code></pre>
                </div>
              </div>
            </div>
            <div className="mt-6 rounded-xl border border-red-950/70 bg-[#1b1012]/60 p-4 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Response shape</p>
              <pre className="mt-3 overflow-x-auto font-mono text-xs leading-6 text-slate-300"><code>{`{
  "id": "chatcmpl_…",
  "object": "chat.completion",
  "model": "ctech-chat",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "Hello!" },
    "finish_reason": "stop"
  }]
}`}</code></pre>
            </div>
          </section>

          <section id="errors" className="scroll-mt-8 py-10 sm:py-12">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-400">03 · Errors &amp; limits</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">Predictable failures</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
              Requests use your account&apos;s existing CTECH AI allowance. Failed upstream generations return a safe error message; request contents and API secrets are never included in error responses.
            </p>
            <div className="mt-5 overflow-hidden rounded-xl border border-red-950/70">
              <div className="grid grid-cols-[5rem_1fr] gap-3 border-b border-red-950/60 bg-[#1b1012]/70 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <span>Status</span><span>Meaning</span>
              </div>
              <div className="grid grid-cols-[5rem_1fr] gap-3 border-b border-red-950/60 px-4 py-3 text-sm"><code className="text-rose-300">400</code><span className="text-slate-400">Invalid JSON or unsupported message format.</span></div>
              <div className="grid grid-cols-[5rem_1fr] gap-3 border-b border-red-950/60 px-4 py-3 text-sm"><code className="text-rose-300">401</code><span className="text-slate-400">Missing, invalid, or revoked API key.</span></div>
              <div className="grid grid-cols-[5rem_1fr] gap-3 border-b border-red-950/60 px-4 py-3 text-sm"><code className="text-rose-300">429</code><span className="text-slate-400">The account&apos;s current AI request allowance is exhausted.</span></div>
              <div className="grid grid-cols-[5rem_1fr] gap-3 px-4 py-3 text-sm"><code className="text-rose-300">502 / 503</code><span className="text-slate-400">Temporary model-service or server issue; retry with backoff.</span></div>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">
              API v1 currently supports chat completions only. Voice and streaming endpoints are not exposed through the public API yet.
            </p>
          </section>

          <footer className="border-t border-red-950/70 py-6 text-xs text-slate-500">
            <Link href="/" className="transition hover:text-slate-300">CTECH AI</Link>
            <span className="px-2">/</span>
            <span>API Reference · v1</span>
          </footer>
        </main>
      </div>
    </div>
  )
}
