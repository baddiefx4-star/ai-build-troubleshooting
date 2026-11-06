import { BrainCircuit, Code2, Search } from 'lucide-react'
import type { ChatMode } from '@/lib/prompt'

const QUICK_ACTIONS = [
  { mode: 'research', title: 'Research with sources', detail: 'Search the web and cite sources.', icon: Search },
  { mode: 'code', title: 'Build and debug', detail: 'Work through code and errors.', icon: Code2 },
  { mode: 'reason', title: 'Think it through', detail: 'Get a careful, structured answer.', icon: BrainCircuit },
] as const

type Props = {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
}

export function EmptyState({ mode, onModeChange }: Props) {
  return (
    <section className="flex flex-col items-center text-center" aria-labelledby="welcome-heading">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">Your private AI workspace</p>
      <h1 id="welcome-heading" className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        One workspace.<br className="sm:hidden" /> More ways to work<span className="text-primary">.</span>
      </h1>
      <p className="mt-3 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
        Chat, research, build, or ask CTECH AI to run a project check when it helps.
      </p>

      <div className="mt-6 grid w-full grid-cols-2 gap-2 text-left sm:grid-cols-3">
        {QUICK_ACTIONS.map(({ mode: actionMode, title, detail, icon: Icon }) => (
          <button
            key={actionMode}
            type="button"
            aria-pressed={mode === actionMode}
            onClick={() => onModeChange(actionMode)}
            className={`min-h-24 rounded-2xl border border-border/80 bg-card/60 p-3 text-left transition-colors hover:border-primary/50 hover:bg-card aria-pressed:border-primary/60 aria-pressed:bg-primary/5 ${actionMode === 'reason' ? 'col-span-2 sm:col-span-1' : ''}`}
          >
            <Icon className="size-4 text-primary" aria-hidden="true" />
            <span className="mt-2 block text-xs font-semibold sm:text-sm">{title}</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{detail}</span>
          </button>
        ))}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Image creation, live voice, and file uploads are available in the controls below.
      </p>
    </section>
  )
}
