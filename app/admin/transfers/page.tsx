import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { AdminTransferList } from '@/components/billing/admin-transfer-list'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { getPendingTransferRequests } from '@/lib/billing/service'
import { isOwnerEmail } from '@/lib/owner'

export const metadata: Metadata = {
  title: 'OPay transfer review | CTECH AI',
  description: 'Review manual OPay plan transfers for CTECH AI.',
}

export default async function AdminTransfersPage() {
  const session = await getAuthenticatedSession()
  if (!session?.user) redirect('/sign-in')
  if (!isOwnerEmail(session.user.email)) redirect('/plans')

  const requests = await getPendingTransferRequests()

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex flex-col gap-4">
          <Link href="/admin" className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft aria-hidden="true" />
            Back to owner dashboard
          </Link>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold tracking-[0.22em] text-primary">CTECH AI · OWNER</p>
            <h1 className="text-3xl font-semibold tracking-tight">OPay transfer review</h1>
            <p className="text-sm text-muted-foreground">References are user-submitted and can be fabricated. Check the completed payment directly in OPay transaction history, including the amount and recipient, before activating access.</p>
          </div>
        </header>
        <AdminTransferList initialRequests={requests} />
      </div>
    </main>
  )
}
