import { and, eq, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { ctechApiKeys } from '@/lib/db/schema'
import { isSameOriginRequest } from '@/lib/request-origin'

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(request: Request, { params }: RouteContext) {
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

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: 'API key not found.' }, { status: 404 })

  try {
    const [revoked] = await db
      .update(ctechApiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(ctechApiKeys.id, id), eq(ctechApiKeys.userId, session.user.id), isNull(ctechApiKeys.revokedAt)))
      .returning({ id: ctechApiKeys.id })

    if (!revoked) return Response.json({ error: 'API key not found.' }, { status: 404 })
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[v0] API key revocation failed', error instanceof Error ? error.name : 'unknown error')
    return Response.json({ error: 'Could not revoke this API key.' }, { status: 503 })
  }
}
