'use client'

import { useDeferredValue, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { Check, ShieldCheck, UserRound } from 'lucide-react'
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { formatNaira, getPlan, PLAN_CATALOG, type PlanId } from '@/lib/billing/plans'

type OwnerMember = {
  id: string
  name: string
  email: string
  planId: PlanId | null
  source: 'stripe' | 'opay' | 'manual' | null
  status: string | null
  currentPeriodEnd: string | null
}

type MemberSearchResult = { users: OwnerMember[] }

type ApiError = { error?: string }

async function fetchMembers(url: string): Promise<MemberSearchResult> {
  const response = await fetch(url, { cache: 'no-store' })
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Members could not be loaded.')
  return result as MemberSearchResult
}

function formatDate(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeZone: 'Africa/Lagos',
  }).format(new Date(value))
}

function sourceLabel(source: OwnerMember['source']) {
  if (source === 'manual') return 'Owner grant'
  if (source === 'opay') return 'OPay'
  if (source === 'stripe') return 'Stripe'
  return null
}

export function OwnerPlanManager() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const searchKey = deferredSearch.length >= 2 ? `/api/admin?q=${encodeURIComponent(deferredSearch)}` : null
  const { data, error: searchError, isLoading, mutate } = useSWR(searchKey, fetchMembers)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [planId, setPlanId] = useState<PlanId>('monthly')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentVerified, setPaymentVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedUser = data?.users.find((user) => user.id === selectedUserId) ?? null
  const selectedPlan = getPlan(planId)

  async function submitGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedUser || !paymentVerified) return

    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          planId,
          paymentReference: paymentReference.trim(),
          paymentVerified: true,
        }),
      })
      const result = await response.json() as ApiError & { currentPeriodEnd?: string }
      if (!response.ok || typeof result.currentPeriodEnd !== 'string') {
        throw new Error(typeof result.error === 'string' ? result.error : 'The plan could not be updated.')
      }

      const endDate = formatDate(result.currentPeriodEnd)
      setNotice(`${selectedPlan.label} access is active for ${selectedUser.email} through ${endDate ?? 'the new period'}.`)
      setSearch('')
      setSelectedUserId(null)
      setPaymentReference('')
      setPaymentVerified(false)
      await mutate()
      router.refresh()
    } catch (grantError) {
      setError(grantError instanceof Error ? grantError.message : 'The plan could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activate a paid plan</CardTitle>
        <CardDescription>Search for a member, verify their payment, then grant or extend access.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {notice && (
          <Alert>
            <Check aria-hidden="true" />
            <AlertTitle>Plan updated</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Plan not updated</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="owner-member-search">Find a member</FieldLabel>
            <Input
              id="owner-member-search"
              type="search"
              autoComplete="off"
              placeholder="Search name or email"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setSelectedUserId(null)
                setError(null)
              }}
            />
            <FieldDescription>Enter at least two characters. Results are limited to 20 members.</FieldDescription>
          </Field>
        </FieldGroup>

        {search.trim().length >= 2 && (
          <div className="flex flex-col gap-2" aria-live="polite">
            {isLoading ? <p className="text-sm text-muted-foreground">Searching members…</p> : null}
            {searchError && <p role="alert" className="text-sm text-destructive">{searchError.message}</p>}
            {!searchError && !isLoading && data?.users.length === 0 && (
              <p className="text-sm text-muted-foreground">No members match that search.</p>
            )}
            {data?.users.map((user) => {
              const isSelected = user.id === selectedUserId
              const endDate = formatDate(user.currentPeriodEnd)
              const active = Boolean(endDate && user.currentPeriodEnd && new Date(user.currentPeriodEnd).getTime() > Date.now())
              const currentPlan = user.planId ? getPlan(user.planId).label : null

              return (
                <Button
                  key={user.id}
                  type="button"
                  variant={isSelected ? 'secondary' : 'outline'}
                  className="h-auto w-full justify-between gap-3 px-3 py-3 text-left"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedUserId(user.id)
                    setError(null)
                    setNotice(null)
                  }}
                >
                  <span className="flex min-w-0 flex-col items-start gap-1">
                    <span className="flex max-w-full items-center gap-2 truncate font-medium">
                      <UserRound data-icon="inline-start" />
                      {user.name}
                    </span>
                    <span className="max-w-full truncate text-xs text-muted-foreground">{user.email}</span>
                    {currentPlan && (
                      <span className="text-xs text-muted-foreground">
                        {currentPlan}{sourceLabel(user.source) ? ` · ${sourceLabel(user.source)}` : ''}{endDate ? ` · through ${endDate}` : ''}
                      </span>
                    )}
                  </span>
                  <Badge variant={active ? 'secondary' : 'outline'}>{active ? 'Active' : 'Free'}</Badge>
                </Button>
              )
            })}
          </div>
        )}

        {selectedUser && (
          <form onSubmit={(event) => void submitGrant(event)} className="flex flex-col gap-4 rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Granting access to {selectedUser.name}</p>
              <p className="break-all text-xs text-muted-foreground">{selectedUser.email}</p>
              {selectedUser.planId && selectedUser.currentPeriodEnd && (
                <p className="text-xs text-muted-foreground">
                  Current access: {getPlan(selectedUser.planId).label} · {sourceLabel(selectedUser.source)} · through {formatDate(selectedUser.currentPeriodEnd)}
                </p>
              )}
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="owner-plan">Plan to grant</FieldLabel>
                <select
                  id="owner-plan"
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={planId}
                  onChange={(event) => setPlanId(event.target.value as PlanId)}
                >
                  {PLAN_CATALOG.map((plan) => (
                    <option key={plan.id} value={plan.id}>{plan.label} · {formatNaira(plan.priceNaira)}</option>
                  ))}
                </select>
                <FieldDescription>If the member already has an active OPay or owner-granted plan, the new period is added after its current expiry.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="owner-payment-reference">Payment reference</FieldLabel>
                <Input
                  id="owner-payment-reference"
                  autoComplete="off"
                  minLength={4}
                  maxLength={120}
                  placeholder="Transaction reference"
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  required
                />
                <FieldDescription>Each reference can be used only once. User-submitted references can be fabricated; confirm the completed payment directly in OPay before granting access.</FieldDescription>
              </Field>
              <Field orientation="horizontal" className="items-start">
                <input
                  id="payment-verified"
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  checked={paymentVerified}
                  onChange={(event) => setPaymentVerified(event.target.checked)}
                  required
                />
                <FieldContent>
                  <FieldLabel htmlFor="payment-verified">I verified this payment</FieldLabel>
                  <FieldDescription>Confirm only after checking that the payment was received.</FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>
            <Button type="submit" disabled={busy || !paymentVerified || paymentReference.trim().length < 4}>
              <ShieldCheck data-icon="inline-start" />
              {busy ? 'Updating plan…' : 'Grant or extend plan'}
            </Button>
          </form>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          References are not proof of payment. Manual grants are recorded with the reference and owner review time; only grant access after verifying the received payment in OPay. Active Stripe subscriptions cannot be replaced from this dashboard.
        </p>
      </CardContent>
    </Card>
  )
}
