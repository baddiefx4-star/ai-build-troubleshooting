import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

export const CTECH_API_KEY_PREFIX = 'ctech_live_'
export const CTECH_API_KEY_LIMIT = 10

export function createCtechApiKey() {
  const secret = `${CTECH_API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
  return {
    secret,
    prefix: `${secret.slice(0, 19)}…`,
    hash: hashCtechApiKey(secret),
  }
}

export function hashCtechApiKey(secret: string) {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function isCtechApiKey(secret: string) {
  return /^ctech_live_[A-Za-z0-9_-]{43}$/.test(secret)
}
