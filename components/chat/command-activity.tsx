'use client'

import { ChevronRight, CircleAlert } from 'lucide-react'
import type { CommandActivity } from '@/lib/types'

export function CommandActivityPanel({ activities, live = false }: { activities: CommandActivity[]; live?: boolean }) {
  if (!activities.length) return null

  return (
    <section className="mt-3 text-sm" aria-label="Command activity">
      {live && <p className="sr-only" aria-live="polite">{activities.map((activity) => `${activity.command}: ${activity.status === 'running' ? 'running' : activity.status === 'error' ? 'could not run' : `finished with exit code ${activity.exitCode ?? 0}`}`).join('. ')}</p>}
      <ul className="flex flex-col gap-1">
        {activities.map((activity) => {
          const running = activity.status === 'running'
          const failed = activity.status === 'error'
          return (
            <li key={activity.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-1 py-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground [&::-webkit-details-marker]:hidden">
                  {running ? (
                    <span className="flex w-5 items-center justify-center gap-0.5" aria-hidden="true">
                      {[0, 1, 2].map((dot) => <span key={dot} className="size-1 rounded-full bg-red-400/80 animate-pulse" style={{ animationDelay: `${dot * 140}ms` }} />)}
                    </span>
                  ) : failed ? (
                    <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                  ) : (
                    <span className="w-5 text-center text-xs text-red-400" aria-hidden="true">✓</span>
                  )}
                  <span className="font-medium">{running ? 'Running command' : failed ? 'Command failed' : 'Command completed'}</span>
                  <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                  {activity.timedOut && <span className="text-xs text-muted-foreground">Timed out</span>}
                </summary>
                <div className="ml-7 mt-1 border-l border-red-500/20 pl-3 text-xs">
                  <code className="block break-all font-mono text-muted-foreground">{activity.command}</code>
                  {activity.stdout && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/20 p-2 font-mono text-xs text-foreground">{activity.stdout}</pre>}
                  {activity.stderr && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-red-950/20 p-2 font-mono text-xs text-red-200/80">{activity.stderr}</pre>}
                </div>
              </details>
            </li>
          )
        })}
      </ul>
      <p className="sr-only" role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
        Commands run in a disposable project snapshot. No persistent project files were changed.
      </p>
    </section>
  )
}
