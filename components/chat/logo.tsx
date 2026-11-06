import { cn } from '@/lib/utils'

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-400 via-red-600 to-red-950 shadow-[0_0_28px_-6px] shadow-red-500/70 ring-1 ring-red-300/30',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[62%] text-white" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.5 6.8A7 7 0 1 0 17.5 17.2" />
        <path d="M8.6 12h7.2" />
      </svg>
    </span>
  )
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">
        CTECH <span className="text-red-400">AI</span>
      </span>
    </span>
  )
}
