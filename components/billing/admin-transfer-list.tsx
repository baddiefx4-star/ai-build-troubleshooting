'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNaira, getPlan } from '@/lib/billing/plans'
import type { AdminTransferRequest } from '@/lib/billing/service'

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(value)
}

export function AdminTransferList({ initialRequests }: { initialRequests: AdminTransferRequest[] }) {
  const router = useRouter()
  const [requests, setRequests] = useState(initialRequests)
  const [verifiedRequestIds, setVerifiedRequestIds] = useState<Set<string>>(() => new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function review(id: string, decision: 'approve' | 'reject') {
    if (decision === 'approve' && !verifiedRequestIds.has(id)) {
      setError('Verify the completed payment in OPay before approving this request.')
      return
    }

    setBusyId(id)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch('/api/admin/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision === 'approve' ? { id, decision, paymentVerified: true } : { id, decision }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'The request could not be reviewed.')

      setRequests((current) => current.filter((request) => request.id !== id))
      setVerifiedRequestIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
      setNotice(decision === 'approve' ? 'Verified transfer approved and plan access activated.' : 'Transfer rejected.')
      router.refresh()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'The request could not be reviewed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <Alert>
          <Check aria-hidden="true" />
          <AlertTitle>Review complete</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not review transfer</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {requests.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No pending transfers</CardTitle>
            <CardDescription>New OPay payment references will appear here for review.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">There are no pending OPay transfers.</CardContent>
        </Card>
      ) : (
        requests.map((request) => (
          <Card key={request.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle>{getPlan(request.planId).label} plan · {formatNaira(request.amountMinor / 100)}</CardTitle>
                  <CardDescription>{request.email ?? 'Account email unavailable'} · submitted {formatDate(request.createdAt)}</CardDescription>
                </div>
                <Badge variant="outline">Pending review</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p><span className="text-muted-foreground">Transaction reference: </span><span className="font-mono font-medium">{request.reference}</span></p>
              <p><span className="text-muted-foreground">User ID: </span><span className="font-mono text-xs">{request.userId}</span></p>
              <p className="text-xs text-muted-foreground">A reference is user-entered and can be fabricated. Check OPay transaction history directly and confirm the payment is completed, for the expected amount, and received by the correct account. Approval immediately activates the selected plan.</p>
              <label htmlFor={`verify-${request.id}`} className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <input
                  id={`verify-${request.id}`}
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  checked={verifiedRequestIds.has(request.id)}
                  onChange={(event) => {
                    setVerifiedRequestIds((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(request.id)
                      else next.delete(request.id)
                      return next
                    })
                  }}
                  disabled={busyId !== null}
                />
                <span className="text-sm leading-relaxed">I independently verified this completed payment in OPay—not just the submitted reference.</span>
              </label>
            </CardContent>
            <CardFooter className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => void review(request.id, 'reject')} disabled={busyId !== null}>
                <X data-icon="inline-start" />
                Reject
              </Button>
              <Button onClick={() => void review(request.id, 'approve')} disabled={busyId !== null || !verifiedRequestIds.has(request.id)}>
                <Check data-icon="inline-start" />
                {busyId === request.id ? 'Reviewing…' : 'Verify and activate'}
              </Button>
            </CardFooter>
          </Card>
        ))
      )}
    </div>
  )
}
