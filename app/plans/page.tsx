import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { BillingPage } from '@/components/billing/billing-page'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { getBillingSummary } from '@/lib/billing/service'
import { isOwnerEmail } from '@/lib/owner'

export const metadata: Metadata = {
  title: 'Plans & billing | CTECH AI',
  description: 'Manage your CTECH AI plan, model usage, and payment method.',
}

type PageProps = {
  searchParams: Promise<{ checkout?: string }>
}

export default async function PlansPage({ searchParams }: PageProps) {
  const session = await getAuthenticatedSession()
  if (!session?.user) redirect('/sign-in')

  const [query, summary] = await Promise.all([
    searchParams,
    getBillingSummary(session.user.id, session.user.email),
  ])
  const checkoutNotice = query.checkout === 'success' || query.checkout === 'cancelled' || query.checkout === 'error'
    ? query.checkout
    : null

  return (
    <BillingPage
      email={session.user.email}
      isOwner={isOwnerEmail(session.user.email)}
      summary={summary}
      checkoutNotice={checkoutNotice}
    />
  )
}
