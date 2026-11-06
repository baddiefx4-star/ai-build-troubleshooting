import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createCtechApiKey, CTECH_API_KEY_LIMIT } from '@/lib/api-keys'
import { db } from '@/lib/db'
import { authUser, ctechApiKeys } from '@/lib/db/schema'
import { isSameOriginRequest } from '@/lib/request-origin'
import { readJsonRequest, RequestBodyTooLargeError } from '@/lib/request-body'

const requestSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict()

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: 'This request was blocked.' }, { status: 403 })
  }

  let session: Awaited<ReturnType<typeof auth.api.getSession>>
  try {
    session = await auth.api.getSession({ headers: await headers() })
  } catch {
    return Response.json({ error: 'Could not verify your account session.' }, { status: 503 })
  }
  if (!session?.user) return Response.json({ error: 'Sign in to manage API keys.' }, { status: 401 })

  let rawBody: unknown
  try {
    rawBody = await readJsonRequest(request, 4_096)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: 'Request body is too large.' }, { status: 413 })
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(rawBody)
  if (!parsed.success) return Response.json({ error: 'Enter a key name between 1 and 60 characters.' }, { status: 400 })

  const issued = createCtechApiKey()
  const id = randomUUID()
  const createdAt = new Date()

  try {
    const created = await db.transaction(async (tx) => {
      await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.id, session.user.id)).for('update')

      const activeKeys = await tx
        .select({ id: ctechApiKeys.id })
        .from(ctechApiKeys)
        .where(and(eq(ctechApiKeys.userId, session.user.id), isNull(ctechApiKeys.revokedAt)))
        .limit(CTECH_API_KEY_LIMIT)

      if (activeKeys.length >= CTECH_API_KEY_LIMIT) return false

      await tx.insert(ctechApiKeys).values({
        id,
        userId: session.user.id,
        name: parsed.data.name,
        keyPrefix: issued.prefix,
        keyHash: issued.hash,
        createdAt,
      })
      return true
    })

    if (!created) return Response.json({ error: `You can have up to ${CTECH_API_KEY_LIMIT} active API keys.` }, { status: 409 })
  } catch (error) {
    console.error('[v0] API key creation failed', error instanceof Error ? error.name : 'unknown error')
    return Response.json({ error: 'Could not create an API key.' }, { status: 503 })
  }

  return Response.json(
    {
      key: issued.secret,
      apiKey: {
        id,
        name: parsed.data.name,
        prefix: issued.prefix,
        createdAt: createdAt.toISOString(),
        lastUsedAt: null,
      },
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}
