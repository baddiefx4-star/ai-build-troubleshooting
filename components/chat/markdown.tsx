'use client'

import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy, Download } from 'lucide-react'

const EXTENSIONS: Record<string, string> = {
  bash: 'sh', c: 'c', cpp: 'cpp', css: 'css', go: 'go', html: 'html', java: 'java',
  js: 'js', javascript: 'js', json: 'json', jsx: 'jsx', markdown: 'md', md: 'md',
  py: 'py', python: 'py', rb: 'rb', rust: 'rs', sql: 'sql', ts: 'ts', tsx: 'tsx',
  txt: 'txt', yaml: 'yaml', yml: 'yml',
}

function safeFileName(candidate: string | undefined, extension: string) {
  const base = candidate?.trim().replace(/^[`'\"]|[`'\"]$/g, '').split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, '-')
  if (!base) return `ctech-ai-code.${extension}`
  return /\.[a-zA-Z0-9]{1,10}$/.test(base) ? base : `${base}.${extension}`
}

function CodeBlock({ language, code, filename }: { language: string; code: string; filename?: string }) {
  const [copied, setCopied] = useState(false)
  const extension = EXTENSIONS[language.toLowerCase()] ?? 'txt'
  const downloadName = safeFileName(filename, extension)
  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = downloadName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="not-prose my-4 overflow-hidden rounded-xl border border-border bg-[#1e1a1b]">
      <div className="flex items-center justify-between border-b border-border bg-secondary/60 px-4 py-2">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{filename || language || 'text'}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={download}
            aria-label={`Download ${downloadName}`}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Download className="size-3.5" aria-hidden="true" />
            <span className="max-sm:hidden">Download file</span>
          </button>
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? 'Code copied' : 'Copy code'}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '0.85rem' }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
        wrapLongLines={false}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, node }) => {
            const match = /language-(\w+)/.exec(className || '')
            const text = String(children ?? '')
            if (match || text.includes('\n')) {
              const offset = node?.position?.start.offset
              const precedingText = typeof offset === 'number' ? content.slice(0, offset).trimEnd().split('\n').slice(-3).join('\n') : ''
              const fileMatch = /(?:^|\n)\s*(?:\*\*)?File:\s*([^\n*]+?)(?:\*\*)?\s*$/i.exec(precedingText)
              return <CodeBlock language={match?.[1] ?? ''} code={text.replace(/\n$/, '')} filename={fileMatch?.[1].trim().replace(/[`*_]/g, '')} />
            }
            return <code>{children}</code>
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
