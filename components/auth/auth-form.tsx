'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, AudioLines, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Logo, LogoMark } from '@/components/chat/logo'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

type AuthMode = 'sign-in' | 'sign-up'

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter()
  const isSignUp = mode === 'sign-up'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    let cancelled = false
    audio.volume = 0.2

    const removeListeners = () => {
      window.removeEventListener('pointerdown', startAfterGesture)
      window.removeEventListener('keydown', startAfterGesture)
    }
    const startAfterGesture = () => {
      if (cancelled || !audio.paused) return
      void audio.play().then(removeListeners).catch(() => undefined)
    }

    if (audio.paused) {
      void audio.play().then(removeListeners).catch(() => {
        if (!cancelled) {
          window.addEventListener('pointerdown', startAfterGesture)
          window.addEventListener('keydown', startAfterGesture)
        }
      })
    }

    return () => {
      cancelled = true
      removeListeners()
      audio.pause()
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password })

      if (result.error) {
        const message = result.error.message?.trim() ?? ''
        const originRejected = /invalid origin|origin.*(?:not allowed|trusted)|trusted.*origin/i.test(message)
        setError(originRejected
          ? 'This app address is not enabled for sign-in. Open CTECH AI from its official link and try again.'
          : 'We could not verify those details. Check your information and try again.')
        return
      }

      router.replace('/')
      router.refresh()
    } catch {
      setError('The account service is taking a moment. Please try again shortly.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="auth-backdrop flex min-h-svh items-center justify-center overflow-x-hidden overflow-y-auto px-4 py-3 sm:px-6 sm:py-10 lg:overflow-hidden">
      <div className="auth-shell-enter relative grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-border/80 bg-card/90 shadow-2xl shadow-black/35 backdrop-blur-xl lg:min-h-[680px] lg:grid-cols-[1.04fr_0.96fr]">
        <section className="auth-art relative hidden min-h-[680px] flex-col overflow-hidden p-10 lg:flex xl:p-12" aria-label="About CTECH AI">
          <div className="relative z-10 flex items-center justify-between gap-4">
            <Logo />
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <span className="rounded-full border border-border/70 bg-background/45 px-3 py-1.5 font-mono text-[9px] tracking-[0.16em] text-muted-foreground">PRIVATE BY DESIGN</span>
            </div>
          </div>

          <div className="auth-orbit-scene" aria-hidden="true">
            <span className="auth-orbit auth-orbit-one" />
            <span className="auth-orbit auth-orbit-two" />
            <span className="auth-orbit auth-orbit-three" />
            <span className="auth-orb-core"><LogoMark className="size-16 rounded-2xl shadow-none" /></span>
          </div>

          <div className="auth-visual-copy relative z-10 mt-auto max-w-lg">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
              <ShieldCheck className="size-3.5" aria-hidden="true" /> A space that stays yours
            </p>
            <h2 className="text-4xl font-semibold leading-[1.08] tracking-tight xl:text-5xl">Your next bright idea starts here.</h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              Think out loud, explore a project, or pick up right where you left off. CTECH keeps your work moving with you.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground"><LockKeyhole className="size-3.5 text-primary" aria-hidden="true" />Private chats</span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground"><AudioLines className="size-3.5 text-primary" aria-hidden="true" />Live voice</span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground"><Sparkles className="size-3.5 text-primary" aria-hidden="true" />Made for ideas</span>
            </div>
          </div>

          <p className="relative z-10 mt-10 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/65">CTECH AI / PERSONAL ACCESS</p>
        </section>

        <section className="flex items-center justify-center px-5 py-8 sm:px-10 sm:py-12 lg:px-12" aria-labelledby="auth-title">
          <div className="w-full max-w-md">
            <audio
              ref={audioRef}
              src="/audio/ctech-ambient-loop.wav"
              autoPlay
              loop
              preload="auto"
              aria-hidden="true"
              className="sr-only"
            />
            <div className="mb-5 flex items-center justify-between gap-4 lg:hidden">
              <Logo />
              <ThemeToggle />
            </div>

            <Card className="border-0 bg-transparent py-0 shadow-none ring-0">
              <CardHeader className="px-0">
                <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
                  <span className="size-1.5 rounded-full bg-primary shadow-[0_0_12px] shadow-primary/70" aria-hidden="true" />
                  {isSignUp ? 'Create your private space' : 'Your workspace is waiting'}
                </p>
                <h1 id="auth-title" className="mt-3 text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
                  {isSignUp ? 'Make room for what’s next.' : 'Welcome back.'}
                </h1>
                <CardDescription className="mt-2 text-xs leading-5 sm:text-sm sm:leading-6">
                  {isSignUp ? 'One account for thoughtful conversations, voice, and project work.' : 'Sign in and continue exactly where your ideas left off.'}
                </CardDescription>
              </CardHeader>

              <CardContent className="mt-5 px-0">
                <form onSubmit={handleSubmit} aria-busy={pending} className="flex flex-col gap-4">
                  <FieldGroup className="gap-3">
                    {isSignUp && (
                      <Field>
                        <FieldLabel htmlFor="name">Your name</FieldLabel>
                        <Input id="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={80} required disabled={pending} className="h-10 rounded-xl bg-background/55" />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel htmlFor="email">Email address</FieldLabel>
                      <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} required disabled={pending} className="h-10 rounded-xl bg-background/55" />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isSignUp ? 'new-password' : 'current-password'} minLength={8} maxLength={128} required disabled={pending} className="h-10 rounded-xl bg-background/55" />
                      {isSignUp && <FieldDescription>Use at least 8 characters.</FieldDescription>}
                    </Field>
                  </FieldGroup>

                  {error && <FieldError>{error}</FieldError>}

                  <Button type="submit" size="lg" className="mt-1 h-11 w-full rounded-xl shadow-lg shadow-primary/15 transition-transform hover:-translate-y-0.5" disabled={pending}>
                    {pending ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : null}
                    {pending ? 'Opening your workspace…' : isSignUp ? 'Create my account' : 'Sign in to CTECH'}
                    {!pending && <ArrowRight data-icon="inline-end" aria-hidden="true" />}
                  </Button>
                </form>

                <p className="mt-4 text-center text-sm text-muted-foreground">
                  {isSignUp ? 'Already have an account?' : 'New to CTECH AI?'}{' '}
                  <Link href={isSignUp ? '/sign-in' : '/sign-up'} className="font-medium text-foreground underline decoration-primary/50 underline-offset-4 transition-colors hover:text-primary">
                    {isSignUp ? 'Sign in' : 'Create an account'}
                  </Link>
                </p>
                <p className="mt-5 border-t border-border/70 pt-4 text-center text-xs leading-5 text-muted-foreground">
                  Your saved chats are private to your account. Create an account to keep conversations synced to your own space.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  )
}
