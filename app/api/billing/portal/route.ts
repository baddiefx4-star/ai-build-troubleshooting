import { z } from 'zod'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { getUserSubscription } from '@/lib/billing/service'
import { isSameOriginRequest } from '@/lib/request-origin'
import { getAppOrigin, getStripeClient } from '@/lib/stripe'

export const runtime = 'nodejs'

const requestSchema = z.object({}).strict()

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })

  let session
  try {
    session = await getAuthenticatedSession()
  } catch {
    return Response.json({ error: 'Could not verify your account session.' }, { status: 503 })
  }
  if (!session?.user) return Response.json({ error: 'Sign in to manage billing.' }, { status: 401 })

  try {
    const body = await request.json()
    if (!requestSchema.safeParse(body).success) return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const subscription = await getUserSubscription(session.user.id)
  if (subscription?.source !== 'stripe' || !subscription.stripeCustomerId) {
    return Response.json({ error: 'There is no Stripe billing account to manage.' }, { status: 404 })
  }

  try {
    const portal = await getStripeClient().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${getAppOrigin()}/plans`,
    })
    return Response.json({ url: portal.url }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[v0] Stripe portal session failed', error instanceof Error ? error.message : 'Unknown error')
    return Response.json({ error: 'The Stripe billing portal is temporarily unavailable.' }, { status: 502 })
  }
}
