import { eq } from 'drizzle-orm'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { getPlan, isPlanId } from '@/lib/billing/plans'
import { db } from '@/lib/db'
import { ctechSubscriptions } from '@/lib/db/schema'
import { getAppOrigin, getStripeClient, getStripeSubscriptionPeriodEnd } from '@/lib/stripe'

export const runtime = 'nodejs'

function redirectTo(path: string) {
  return Response.redirect(new URL(path, getAppOrigin()), 303)
}

export async function GET(request: Request) {
  let session
  try {
    session = await getAuthenticatedSession()
  } catch {
    return redirectTo('/plans?checkout=error')
  }
  if (!session?.user) return redirectTo('/sign-in')

  const sessionId = new URL(request.url).searchParams.get('session_id')
  if (!sessionId || !sessionId.startsWith('cs_')) return redirectTo('/plans?checkout=error')

  try {
    const stripe = getStripeClient()
    const checkout = await stripe.checkout.sessions.retrieve(sessionId)
    const planId = checkout.metadata?.planId
    const userId = checkout.metadata?.userId

    if (
      checkout.status !== 'complete' ||
      (checkout.payment_status !== 'paid' && checkout.payment_status !== 'no_payment_required') ||
      checkout.client_reference_id !== session.user.id ||
      userId !== session.user.id ||
      !isPlanId(planId)
    ) {
      return redirectTo('/plans?checkout=error')
    }

    const plan = getPlan(planId)
    if (checkout.currency !== 'ngn' || checkout.amount_total !== plan.amountMinor) {
      return redirectTo('/plans?checkout=error')
    }

    const stripeSubscriptionId = typeof checkout.subscription === 'string' ? checkout.subscription : checkout.subscription?.id
    if (!stripeSubscriptionId) return redirectTo('/plans?checkout=error')

    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId)
    if (stripeSubscription.status !== 'active' && stripeSubscription.status !== 'trialing') {
      return redirectTo('/plans?checkout=error')
    }

    const currentPeriodEnd = getStripeSubscriptionPeriodEnd(stripeSubscription)
    if (!currentPeriodEnd) return redirectTo('/plans?checkout=error')

    const customerId = typeof stripeSubscription.customer === 'string' ? stripeSubscription.customer : stripeSubscription.customer.id
    const now = new Date()
    await db
      .insert(ctechSubscriptions)
      .values({
        userId: session.user.id,
        planId,
        source: 'stripe',
        status: 'active',
        stripeCustomerId: customerId,
        stripeSubscriptionId: stripeSubscription.id,
        currentPeriodEnd,
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        lastStripeSyncAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: ctechSubscriptions.userId,
        set: {
          planId,
          source: 'stripe',
          status: 'active',
          stripeCustomerId: customerId,
          stripeSubscriptionId: stripeSubscription.id,
          currentPeriodEnd,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          lastStripeSyncAt: now,
          updatedAt: now,
        },
      })

    return redirectTo('/plans?checkout=success')
  } catch (error) {
    console.error('[v0] Stripe checkout confirmation failed', error instanceof Error ? error.message : 'Unknown error')
    return redirectTo('/plans?checkout=error')
  }
}
