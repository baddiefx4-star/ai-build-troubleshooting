import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'ctech_chat_session'
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function getChatSessionId() {
  const cookieStore = await cookies()
  const existing = cookieStore.get(COOKIE_NAME)?.value
  if (existing && SESSION_ID_PATTERN.test(existing)) return existing

  const sessionId = randomUUID()
  cookieStore.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: process.env.NODE_ENV === 'development' ? 'none' : 'lax',
    partitioned: process.env.NODE_ENV === 'development',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  })
  return sessionId
}
