import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { getPlan } from '@/lib/billing/plans'
import { getUserSubscription, isPlanActive } from '@/lib/billing/service'
import { db } from '@/lib/db'
import { ctechTransferRequests } from '@/lib/db/schema'
import { isOwnerEmail } from '@/lib/owner'
import { isSameOriginRequest } from '@/lib/request-origin'

const requestSchema = z.object({
  planId: z.enum(['weekly', 'monthly', 'yearly']),
  reference: z.string().trim().min(4).max(120),
}).strict()

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })

  let session
  try {
    session = await getAuthenticatedSession()
  } catch {
    return Response.json({ error: 'Could not verify your account session.' }, { status: 503 })
  }
  if (!session?.user) return Response.json({ error: 'Sign in to submit a transfer.' }, { status: 401 })
  if (isOwnerEmail(session.user.email)) return Response.json({ error: 'Owner accounts do not need a paid plan.' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Choose a plan and enter the OPay transaction reference.' }, { status: 400 })

  const subscription = await getUserSubscription(session.user.id)
  if (subscription?.source === 'stripe' && isPlanActive(subscription)) {
    return Response.json({ error: 'Your Stripe plan is already active. Manage it from the billing page.' }, { status: 409 })
  }

  const [existingPending] = await db
    .select({ id: ctechTransferRequests.id })
    .from(ctechTransferRequests)
    .where(and(eq(ctechTransferRequests.userId, session.user.id), eq(ctechTransferRequests.status, 'pending')))
    .limit(1)
  if (existingPending) return Response.json({ error: 'You already have an OPay transfer awaiting review.' }, { status: 409 })

  const plan = getPlan(parsed.data.planId)
  try {
    const [transfer] = await db
      .insert(ctechTransferRequests)
      .values({
        id: randomUUID(),
        userId: session.user.id,
        planId: plan.id,
        amountMinor: plan.amountMinor,
        reference: parsed.data.reference,
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        createdAt: new Date(),
      })
      .returning({ id: ctechTransferRequests.id })

    return Response.json({ ok: true, id: transfer.id }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: string }).code : undefined
    if (code === '23505') return Response.json({ error: 'That transaction reference has already been submitted.' }, { status: 409 })
    console.error('[v0] OPay transfer request failed', error instanceof Error ? error.message : 'Unknown error')
    return Response.json({ error: 'We could not submit your transfer for review. Try again.' }, { status: 500 })
  }
}
