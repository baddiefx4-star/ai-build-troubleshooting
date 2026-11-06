'use client'

import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, Copy, ShieldCheck, Wallet } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { formatNaira, getPlan, OPAY_DETAILS, type PlanId } from '@/lib/billing/plans'
import type { BillingSummary } from '@/lib/billing/service'

type Props = {
  selectedPlanId: PlanId
  onPlanSelect: (planId: PlanId) => void
  initialPendingTransfer: BillingSummary['pendingTransfer']
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(value)
}

export function OpayTransferForm({ selectedPlanId, onPlanSelect, initialPendingTransfer }: Props) {
  const [reference, setReference] = useState('')
  const [pendingTransfer, setPendingTransfer] = useState(initialPendingTransfer)
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const plan = getPlan(selectedPlanId)

  async function copyAccountNumber() {
    try {
      await navigator.clipboard.writeText(OPAY_DETAILS.accountNumber)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_800)
    } catch {
      setError('Could not copy the account number. Please copy it manually.')
    }
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const response = await fetch('/api/billing/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: selectedPlanId, reference }),
      })
      const result = await response.json()
      if (!response.ok || typeof result.id !== 'string') {
        throw new Error(typeof result.error === 'string' ? result.error : 'Transfer could not be submitted.')
      }

      setPendingTransfer({
        id: result.id,
        planId: selectedPlanId,
        amountMinor: plan.amountMinor,
        reference: reference.trim(),
        createdAt: new Date(),
      })
      setReference('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Transfer could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  function guardImeEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault()
  }

  return (
    <section id="opay-transfer" aria-labelledby="opay-heading" className="scroll-mt-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle id="opay-heading" className="flex items-center gap-2">
                <Wallet aria-hidden="true" />
                Pay with OPay
              </CardTitle>
              <CardDescription>Manual transfers are activated after the account owner verifies the payment.</CardDescription>
            </div>
            <Badge variant="outline">Manual review</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Transfer exactly</p>
              <p className="text-2xl font-semibold">{formatNaira(plan.priceNaira)}</p>
              <p className="text-sm text-muted-foreground">{plan.label} CTECH AI plan</p>
            </div>
            <Separator />
            <dl className="flex flex-col gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">Bank</dt>
                <dd className="font-medium">{OPAY_DETAILS.bank}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">Account number</dt>
                <dd className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-base font-semibold tracking-wider">{OPAY_DETAILS.accountNumber}</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => void copyAccountNumber()}>
                    {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">Account name</dt>
                <dd className="font-medium">{OPAY_DETAILS.accountName}</dd>
              </div>
            </dl>
            <Alert>
              <ShieldCheck aria-hidden="true" />
              <AlertTitle>Keep your transaction reference</AlertTitle>
              <AlertDescription>Submit the reference shown on your OPay receipt. It does not activate access by itself; we review the payment and activate your plan only after confirming receipt. Never share your PIN or one-time password.</AlertDescription>
            </Alert>
          </div>

          <div className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Transfer not submitted</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {pendingTransfer ? (
              <Alert>
                <ShieldCheck aria-hidden="true" />
                <AlertTitle>Transfer awaiting review</AlertTitle>
                <AlertDescription>
                  {getPlan(pendingTransfer.planId).label} · {pendingTransfer.reference} · submitted {formatDate(pendingTransfer.createdAt)}. Access is not activated until approval.
                </AlertDescription>
              </Alert>
            ) : (
              <form onSubmit={submitTransfer} className="flex flex-col gap-5">
                <FieldGroup>
                  <Field>
                    <p id="opay-plan-label" className="text-sm font-medium">Plan selection</p>
                    <div role="group" aria-labelledby="opay-plan-label" className="flex flex-wrap gap-2">
                      {(['weekly', 'monthly', 'yearly'] as const).map((planId) => (
                        <Button
                          key={planId}
                          type="button"
                          size="sm"
                          variant={selectedPlanId === planId ? 'default' : 'outline'}
                          aria-pressed={selectedPlanId === planId}
                          onClick={() => onPlanSelect(planId)}
                        >
                          {getPlan(planId).label}
                        </Button>
                      ))}
                    </div>
                    <FieldDescription>Transfer the exact amount shown for your selected plan.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="opay-reference">OPay transaction reference</FieldLabel>
                    <Input
                      id="opay-reference"
                      name="reference"
                      autoComplete="off"
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      onKeyDown={guardImeEnter}
                      placeholder="Enter the reference from your receipt"
                      minLength={4}
                      maxLength={120}
                      required
                    />
                    <FieldDescription>Use the transaction reference from the completed bank transfer.</FieldDescription>
                  </Field>
                </FieldGroup>
                <Button type="submit" disabled={submitting || reference.trim().length < 4}>
                  {submitting ? 'Submitting for review…' : 'Submit transfer for review'}
                </Button>
              </form>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Never send your OPay PIN, password, or verification code. A submitted reference is only a review request; it does not confirm payment by itself.
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
