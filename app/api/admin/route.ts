import { z } from 'zod'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { grantManualPlan, searchOwnerMembers } from '@/lib/billing/service'
import { isOwnerEmail } from '@/lib/owner'
import { isSameOriginRequest } from '@/lib/request-origin'

const grantSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  planId: z.enum(['weekly', 'monthly', 'yearly']),
  paymentReference: z.string().trim().min(4).max(120),
  paymentVerified: z.literal(true),
}).strict()

type OwnerSession = NonNullable<Awaited<ReturnType<typeof getAuthenticatedSession>>>
type OwnerSessionResult =
  | { session: OwnerSession; response?: never }
  | { response: Response; session?: never }

async function getOwnerSession(): Promise<OwnerSessionResult> {
  let session: Awaited<ReturnType<typeof getAuthenticatedSession>>
  try {
    session = await getAuthenticatedSession()
  } catch {
    return { response: Response.json({ error: 'Could not verify your account session.' }, { status: 503 }) }
  }

  if (!session?.user) {
    return { response: Response.json({ error: 'Sign in to access the owner dashboard.' }, { status: 401 }) }
  }
  if (!isOwnerEmail(session.user.email)) {
    return { response: Response.json({ error: 'You are not allowed to access the owner dashboard.' }, { status: 403 }) }
  }

  return { session }
}

export async function GET(request: Request) {
  const owner = await getOwnerSession()
  if ('response' in owner) return owner.response

  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (query.length > 100) return Response.json({ error: 'Search text must be 100 characters or fewer.' }, { status: 400 })
  if (query.length < 2) return Response.json({ users: [] }, { headers: { 'Cache-Control': 'no-store' } })

  try {
    const users = await searchOwnerMembers(query)
    return Response.json({ users }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[v0] Owner member search failed', error instanceof Error ? error.message : 'Unknown error')
    return Response.json({ error: 'Members could not be loaded. Try again.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })

  const owner = await getOwnerSession()
  if ('response' in owner) return owner.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = grantSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Choose a member and plan, enter a payment reference, and confirm the payment was verified.' }, { status: 400 })
  }

  try {
    const result = await grantManualPlan({
      userId: parsed.data.userId,
      planId: parsed.data.planId,
      paymentReference: parsed.data.paymentReference,
      changedBy: owner.session.user.id,
    })

    if (result === 'not-found') return Response.json({ error: 'That member could not be found.' }, { status: 404 })
    if (result === 'owner-account') return Response.json({ error: 'Owner accounts already have unlimited access.' }, { status: 409 })
    if (result === 'stripe-active') {
      return Response.json({ error: 'This member has an active Stripe plan. Wait for it to end before granting a manual plan.' }, { status: 409 })
    }
    if (result === 'duplicate-reference') {
      return Response.json({ error: 'That payment reference is already recorded. Review the existing transfer instead of granting it twice.' }, { status: 409 })
    }
    if (result === 'invalid-plan' || result === 'invalid-reference') {
      return Response.json({ error: 'The selected plan or payment reference is invalid.' }, { status: 400 })
    }

    return Response.json({ ok: true, currentPeriodEnd: result.currentPeriodEnd.toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: string }).code : undefined
    if (code === '23505') {
      return Response.json({ error: 'That payment reference is already recorded. Review the existing transfer instead of granting it twice.' }, { status: 409 })
    }
    console.error('[v0] Owner plan grant failed', error instanceof Error ? error.message : 'Unknown error')
    return Response.json({ error: 'The plan could not be updated. Try again.' }, { status: 500 })
  }
}
