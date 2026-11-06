'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, CreditCard, ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { formatNaira, PLAN_CATALOG, type PlanDefinition, type PlanId } from '@/lib/billing/plans'
import type { BillingSummary } from '@/lib/billing/service'
import { OpayTransferForm } from './opay-transfer-form'

type CheckoutNotice = 'success' | 'cancelled' | 'error' | null

type Props = {
  email: string
  isOwner: boolean
  summary: BillingSummary
  checkoutNotice: CheckoutNotice
}

function formatDate(value: Date | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(value)
}

export function BillingPage({ email, isOwner, summary, checkoutNotice }: Props) {
  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null)
  const [portalBusy, setPortalBusy] = useState(false)
  const [opayPlanId, setOpayPlanId] = useState<PlanId>('monthly')
  const [error, setError] = useState<string | null>(null)

  async function startCheckout(planId: PlanId) {
    setError(null)
    setCheckoutPlan(planId)

    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, requestId: crypto.randomUUID() }),
      })
      const result = await response.json()
      if (!response.ok || typeof result.url !== 'string') {
        throw new Error(typeof result.error === 'string' ? result.error : 'Checkout could not be started.')
      }
      window.location.assign(result.url)
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Checkout could not be started.')
      setCheckoutPlan(null)
    }
  }

  async function openBillingPortal() {
    setError(null)
    setPortalBusy(true)

    try {
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const result = await response.json()
      if (!response.ok || typeof result.url !== 'string') {
        throw new Error(typeof result.error === 'string' ? result.error : 'The billing portal could not be opened.')
      }
      window.location.assign(result.url)
    } catch (portalError) {
      setError(portalError instanceof Error ? portalError.message : 'The billing portal could not be opened.')
      setPortalBusy(false)
    }
  }

  function chooseOpayPlan(planId: PlanId) {
    setOpayPlanId(planId)
    document.getElementById('opay-transfer')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const notice = checkoutNotice === 'success'
    ? { title: 'Subscription confirmed', description: 'Your Stripe subscription is active. Your account usage has been updated.' }
    : checkoutNotice === 'cancelled'
      ? { title: 'Checkout cancelled', description: 'No payment was taken. You can try again or use the OPay transfer option.' }
      : checkoutNotice === 'error'
        ? { title: 'Payment not confirmed', description: 'We could not verify that payment. Your access has not changed; contact support if Stripe charged you.' }
        : null

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-4">
            <Link href="/" className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft aria-hidden="true" />
              Back to chat
            </Link>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold tracking-[0.22em] text-primary">CTECH AI</p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Plans &amp; billing</h1>
              <p className="max-w-2xl text-sm text-muted-foreground">Choose a plan, check your chat usage, or submit an OPay transfer for review.</p>
              <p className="text-xs text-muted-foreground">Signed in as {email}</p>
            </div>
          </div>
          {isOwner && (
            <Link href="/admin" className="inline-flex w-fit items-center rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted">
              Owner dashboard
            </Link>
          )}
        </header>

        {notice && (
          <Alert variant={checkoutNotice === 'error' ? 'destructive' : 'default'}>
            <ShieldCheck aria-hidden="true" />
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription>{notice.description}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <BillingStatusCard summary={summary} portalBusy={portalBusy} onOpenPortal={openBillingPortal} />

        <section aria-labelledby="plans-heading" className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="plans-heading" className="text-xl font-semibold">Choose your plan</h2>
              <Badge variant="outline">Prices in NGN</Badge>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Paid plans include up to 160 AI requests per rolling 3 hours across chat, research, voice turns, file analysis, and image generation.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {PLAN_CATALOG.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                recommended={plan.id === 'monthly'}
                current={summary.isActive && summary.activePlanId === plan.id}
                locked={summary.isOwner || summary.isActive}
                opayLocked={summary.isOwner || (summary.isActive && summary.billingSource === 'stripe')}
                busy={checkoutPlan !== null}
                busyThisPlan={checkoutPlan === plan.id}
                onCheckout={() => void startCheckout(plan.id)}
                onOpay={() => chooseOpayPlan(plan.id)}
              />
            ))}
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Free accounts receive 10 CTECH AI requests per rolling 5 hours across chat, research, voice turns, file analysis, and image generation. Requests pause when the allowance is used and resume after it resets. CTECH AI provides chat, image understanding, image generation, voice, research, and PDF analysis; availability and usage limits depend on your plan.
          </p>
        </section>

        <Separator />
        {!isOwner && <OpayTransferForm selectedPlanId={opayPlanId} onPlanSelect={setOpayPlanId} initialPendingTransfer={summary.pendingTransfer} />}
      </div>
    </main>
  )
}

function BillingStatusCard({ summary, portalBusy, onOpenPortal }: {
  summary: BillingSummary
  portalBusy: boolean
  onOpenPortal: () => void
}) {
  const usedPercent = summary.limit ? Math.min(100, Math.round((summary.used / summary.limit) * 100)) : 0
  const plan = summary.activePlanId ? PLAN_CATALOG.find((item) => item.id === summary.activePlanId) : null
  const resetLabel = formatDate(summary.resetAt)
  const periodEndLabel = formatDate(summary.currentPeriodEnd)
  const billingSourceLabel = summary.billingSource === 'manual'
    ? 'Owner grant'
    : summary.billingSource === 'opay'
      ? 'OPay'
      : 'Stripe'

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Current access</CardTitle>
            <CardDescription>AI request usage in your current rolling window.</CardDescription>
          </div>
          <Badge variant={summary.isOwner ? 'default' : summary.isActive ? 'secondary' : 'outline'}>
            {summary.isOwner ? 'Owner access' : summary.isActive ? `${plan?.label ?? 'Paid'} · ${billingSourceLabel}` : 'Free plan'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">AI requests</p>
            <p className="text-2xl font-semibold tabular-nums">
              {summary.isOwner ? 'Unlimited' : `${summary.used} / ${summary.limit}`}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {summary.isOwner ? 'No usage cap' : `${summary.remaining} remaining · ${summary.windowHours}-hour window`}
          </p>
        </div>
        {!summary.isOwner && (
          <div
            role="progressbar"
            aria-label="AI request usage"
            aria-valuemin={0}
            aria-valuemax={summary.limit ?? 0}
            aria-valuenow={summary.used}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${usedPercent}%` }} />
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          {summary.isOwner
            ? 'Your owner account is exempt from subscription and usage caps.'
            : summary.isActive
              ? `${billingSourceLabel} access${periodEndLabel ? ` through ${periodEndLabel}` : ''}${summary.cancelAtPeriodEnd ? ' · scheduled to end' : ''}.`
              : 'Free access is available without a subscription. AI requests pause when the allowance is reached and resume after it resets.'}
        </p>
        {resetLabel && !summary.isOwner && (
          <p className="text-xs text-muted-foreground">Your AI request allowance resets around {resetLabel}.</p>
        )}
      </CardContent>
      {summary.billingSource === 'stripe' && summary.isActive && (
        <CardFooter>
          <Button onClick={onOpenPortal} disabled={portalBusy}>
            <CreditCard data-icon="inline-start" />
            {portalBusy ? 'Opening billing portal…' : 'Manage Stripe billing'}
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

function PlanCard({ plan, recommended, current, locked, opayLocked, busy, busyThisPlan, onCheckout, onOpay }: {
  plan: PlanDefinition
  recommended: boolean
  current: boolean
  locked: boolean
  opayLocked: boolean
  busy: boolean
  busyThisPlan: boolean
  onCheckout: () => void
  onOpay: () => void
}) {
  const cadence = plan.interval === 'week' ? 'week' : plan.interval === 'month' ? 'month' : 'year'

  return (
    <Card className={recommended ? 'border-primary/60 shadow-lg shadow-primary/5' : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{plan.label}</CardTitle>
          {recommended && <Badge>Popular</Badge>}
          {current && <Badge variant="secondary">Current</Badge>}
        </div>
        <CardDescription>{plan.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight">{formatNaira(plan.priceNaira)}</span>
          <span className="text-sm text-muted-foreground">/ {cadence}</span>
        </div>
        <Separator />
        <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            Up to 160 AI requests every 3 hours
          </li>
          <li className="flex items-start gap-2">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            Requests pause after the allowance until it resets
          </li>
          <li className="flex items-start gap-2">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            Secure Stripe checkout or OPay transfer
          </li>
        </ul>
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-2">
        <Button onClick={onCheckout} disabled={locked || busy}>
          {busyThisPlan ? 'Connecting to Stripe…' : current ? 'Current plan' : locked ? 'Plan already active' : 'Subscribe with Stripe'}
        </Button>
        <Button variant="outline" onClick={onOpay} disabled={opayLocked}>
          Pay by OPay transfer
        </Button>
      </CardFooter>
    </Card>
  )
}
