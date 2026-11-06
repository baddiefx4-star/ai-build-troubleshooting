import { z } from 'zod'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { reviewTransferRequest } from '@/lib/billing/service'
import { isOwnerEmail } from '@/lib/owner'
import { isSameOriginRequest } from '@/lib/request-origin'

const requestSchema = z.discriminatedUnion('decision', [
  z.object({
    id: z.string().uuid(),
    decision: z.literal('approve'),
    paymentVerified: z.literal(true),
  }).strict(),
  z.object({
    id: z.string().uuid(),
    decision: z.literal('reject'),
  }).strict(),
])

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })

  let session
  try {
    session = await getAuthenticatedSession()
  } catch {
    return Response.json({ error: 'Could not verify your account session.' }, { status: 503 })
  }
  if (!session?.user) return Response.json({ error: 'Sign in to review transfers.' }, { status: 401 })
  if (!isOwnerEmail(session.user.email)) return Response.json({ error: 'You are not allowed to review transfers.' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'To approve a transfer, confirm you verified the completed payment in OPay.' }, { status: 400 })
  }

  const paymentVerified = parsed.data.decision === 'approve' && parsed.data.paymentVerified

  try {
    const result = await reviewTransferRequest(parsed.data.id, parsed.data.decision, session.user.id, paymentVerified)
    if (result === 'not-found') return Response.json({ error: 'This request is no longer pending.' }, { status: 404 })
    if (result === 'payment-unverified') {
      return Response.json({ error: 'Verify the completed payment in OPay before approving this request.' }, { status: 400 })
    }
    if (result === 'stripe-active') {
      return Response.json({ error: 'This user already has an active Stripe plan. Reject the transfer or review it after that plan ends.' }, { status: 409 })
    }
    if (result === 'invalid-amount' || result === 'invalid-plan') {
      return Response.json({ error: 'The transfer request does not match a valid plan amount.' }, { status: 409 })
    }

    return Response.json({ ok: true, status: result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[v0] OPay transfer review failed', error instanceof Error ? error.message : 'Unknown error')
    return Response.json({ error: 'The transfer could not be reviewed. Try again.' }, { status: 500 })
  }
}
