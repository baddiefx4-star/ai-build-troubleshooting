import { z } from 'zod'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { getPlan } from '@/lib/billing/plans'
import { getUserSubscription, isPlanActive } from '@/lib/billing/service'
import { isOwnerEmail } from '@/lib/owner'
import { isSameOriginRequest } from '@/lib/request-origin'
import { getAppOrigin, getStripeClient } from '@/lib/stripe'

export const runtime = 'nodejs'

const requestSchema = z.object({
  planId: z.enum(['weekly', 'monthly', 'yearly']),
  requestId: z.string().uuid(),
}).strict()

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })

  let session
  try {
    session = await getAuthenticatedSession()
  } catch {
    return Response.json({ error: 'Could not verify your account session.' }, { status: 503 })
  }
  if (!session?.user) return Response.json({ error: 'Sign in to subscribe.' }, { status: 401 })
  if (isOwnerEmail(session.user.email)) return Response.json({ error: 'Owner accounts do not need a paid plan.' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Choose a valid plan and try again.' }, { status: 400 })

  const currentSubscription = await getUserSubscription(session.user.id)
  if (isPlanActive(currentSubscription)) {
    return Response.json({ error: 'You already have an active plan. Manage it from the billing page.' }, { status: 409 })
  }

  const plan = getPlan(parsed.data.planId)
  try {
    const stripe = getStripeClient()
    const origin = getAppOrigin()
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        client_reference_id: session.user.id,
        metadata: { userId: session.user.id, planId: plan.id },
        subscription_data: { metadata: { userId: session.user.id, planId: plan.id } },
        line_items: [
          {
            price_data: {
              currency: 'ngn',
              unit_amount: plan.amountMinor,
              recurring: { interval: plan.interval },
              product_data: { name: `CTECH AI ${plan.label}` },
            },
            quantity: 1,
          },
        ],
        ...(currentSubscription?.stripeCustomerId
          ? { customer: currentSubscription.stripeCustomerId }
          : { customer_email: session.user.email }),
        success_url: `${origin}/api/billing/confirm?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/plans?checkout=cancelled`,
      },
      { idempotencyKey: `ctech-checkout-${session.user.id}-${parsed.data.requestId}` },
    )

    if (!checkout.url) return Response.json({ error: 'Stripe could not start checkout. Try again.' }, { status: 502 })
    return Response.json({ url: checkout.url }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[v0] Stripe checkout creation failed', error instanceof Error ? error.message : 'Unknown error')
    return Response.json({ error: 'Stripe checkout is temporarily unavailable. You can use the OPay transfer option instead.' }, { status: 502 })
  }
}
