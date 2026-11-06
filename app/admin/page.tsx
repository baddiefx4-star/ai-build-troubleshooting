import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Clock3, CreditCard, Users } from 'lucide-react'
import { AdminTransferList } from '@/components/billing/admin-transfer-list'
import { OwnerPlanManager } from '@/components/billing/owner-plan-manager'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getOwnerDashboardStats,
  getPendingTransferRequests,
  getRecentPlanActivity,
} from '@/lib/billing/service'
import { formatNaira, getPlan } from '@/lib/billing/plans'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { isOwnerEmail } from '@/lib/owner'

export const metadata: Metadata = {
  title: 'Owner dashboard | CTECH AI',
  description: 'Manage CTECH AI member plans and verify payments.',
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(value)
}

export default async function OwnerDashboardPage() {
  const session = await getAuthenticatedSession()
  if (!session?.user) redirect('/sign-in')
  if (!isOwnerEmail(session.user.email)) redirect('/plans')

  const [stats, pendingTransfers, activity] = await Promise.all([
    getOwnerDashboardStats(),
    getPendingTransferRequests(),
    getRecentPlanActivity(),
  ])

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <header className="flex flex-col gap-4">
          <Link href="/" className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft aria-hidden="true" />
            Back to CTECH AI
          </Link>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold tracking-[0.22em] text-primary">CTECH AI · OWNER</p>
              <Badge variant="outline">Private dashboard</Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Owner dashboard</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Verify payments, manage member access, and keep a record of every plan activation.
            </p>
          </div>
        </header>

        <section aria-label="Account overview" className="grid gap-3 sm:grid-cols-3">
          <MetricCard icon={<Users aria-hidden="true" />} label="Members" value={stats.members} />
          <MetricCard icon={<CreditCard aria-hidden="true" />} label="Active paid plans" value={stats.activeSubscriptions} />
          <MetricCard icon={<Clock3 aria-hidden="true" />} label="Transfers to review" value={stats.pendingTransfers} />
        </section>

        <OwnerPlanManager />

        <section aria-labelledby="transfers-heading" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="transfers-heading" className="text-xl font-semibold">OPay transfers awaiting review</h2>
            <p className="text-sm text-muted-foreground">Verify each payment in OPay before approving access.</p>
          </div>
          <AdminTransferList initialRequests={pendingTransfers} />
        </section>

        <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="activity-heading" className="text-xl font-semibold">Recent plan activity</h2>
            <p className="text-sm text-muted-foreground">Approved payments and manual grants, with their payment references.</p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Latest activations</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">Plan activity will appear here after the first approved payment.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {activity.map((item) => (
                    <li key={item.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="truncate text-sm font-medium">{item.email ?? `Member ${item.userId.slice(0, 8)}`}</p>
                        <p className="break-all font-mono text-xs text-muted-foreground">{item.reference}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:justify-end">
                        <Badge variant="secondary">{getPlan(item.planId).label}</Badge>
                        <span>{formatNaira(item.amountMinor / 100)}</span>
                        <time dateTime={item.reviewedAt.toISOString()}>{formatDate(item.reviewedAt)}</time>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  )
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="grid-cols-[auto_1fr] items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <CardTitle className="text-2xl tabular-nums">{value.toLocaleString('en-NG')}</CardTitle>
        </div>
      </CardHeader>
    </Card>
  )
}
