import 'server-only'

import Stripe from 'stripe'

let stripeClient: Stripe | undefined

export function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) throw new Error('Stripe is not configured.')

  stripeClient ??= new Stripe(secretKey)
  return stripeClient
}

export function getAppOrigin() {
  const configuredOrigin =
    process.env.BETTER_AUTH_URL ??
    process.env.V0_RUNTIME_URL ??
    process.env.V0_DEV_APP_URL ??
    process.env.VERCEL_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL

  if (!configuredOrigin) return 'http://localhost:3000'

  return new URL(configuredOrigin.includes('://') ? configuredOrigin : `https://${configuredOrigin}`).origin
}

export function getStripeSubscriptionPeriodEnd(subscription: Stripe.Subscription) {
  const periodEnds = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  if (periodEnds.length === 0) return null
  return new Date(Math.max(...periodEnds) * 1_000)
}
