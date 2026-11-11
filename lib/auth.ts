import { betterAuth } from 'better-auth'
import { pool } from '@/lib/db'

const secret = process.env.BETTER_AUTH_SECRET

if (!secret) {
  throw new Error('BETTER_AUTH_SECRET is not configured.')
}

const deploymentHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
const v0PreviewOrigins = [
  'https://ai-build-troubleshooting-ctech-ai.v0.build',
  'https://ctech-ai-zip-ctech-ai.v0.build',
]

function originOf(value: string | undefined) {
  if (!value) return undefined
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).origin
  } catch {
    return undefined
  }
}

const v0Origins = [
  process.env.V0_RUNTIME_URL,
  process.env.V0_DEV_APP_URL,
  process.env.V0_BUILD_URL,
  process.env.V0_SANDBOX_URL,
  ...(process.env.NODE_ENV === 'development' ? v0PreviewOrigins : []),
].map(originOf).filter((origin): origin is string => Boolean(origin))
const baseURL =
  process.env.BETTER_AUTH_URL ??
  (deploymentHost
    ? `https://${deploymentHost}`
    : process.env.V0_RUNTIME_URL ??
      (process.env.NODE_ENV === 'development' ? v0PreviewOrigins[0] : undefined))
const productionOrigins = [
  process.env.BETTER_AUTH_URL,
  process.env.VERCEL_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
  'https://ctech-ai.com',
  'https://v0-ctech.vercel.app',
  'https://v0-ctech-ai.vercel.app',
  'https://ai-build-troubleshooting.vercel.app',
  'https://ai-build-troubleshooting-favour4321a-8282.vercel.app',
].map(originOf).filter((origin): origin is string => Boolean(origin))

export const auth = betterAuth({
  secret,
  database: pool,
  baseURL,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  trustedOrigins: [
    ...(process.env.NODE_ENV === 'development'
      ? ['http://localhost:3000', ...v0Origins]
      : []),
    ...(process.env.NODE_ENV === 'production' ? productionOrigins : []),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  ...(process.env.NODE_ENV === 'development'
    ? {
        advanced: {
          defaultCookieAttributes: {
            sameSite: 'none' as const,
            secure: true,
          },
        },
      }
    : {}),
})
