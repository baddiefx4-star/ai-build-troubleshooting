import { getAuthenticatedSession } from '@/lib/auth-session'
import { getConversation, isValidConversationId, removeConversation } from '@/lib/chat-store'
import { isSameOriginRequest } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: 'This request was blocked.' }, { status: 403 })
  }

  const { id } = await context.params
  if (!isValidConversationId(id)) return Response.json({ error: 'Conversation not found.' }, { status: 404 })

  let session: Awaited<ReturnType<typeof getAuthenticatedSession>>
  try {
    session = await getAuthenticatedSession()
  } catch {
    return Response.json({ error: 'Could not verify your account session.' }, { status: 503 })
  }
  if (!session?.user) return Response.json({ error: 'Sign in to view this conversation.' }, { status: 401 })

  try {
    const conversation = await getConversation(session.user.id, id)
    if (!conversation) return Response.json({ error: 'Conversation not found.' }, { status: 404 })
    return Response.json(conversation, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return Response.json({ error: 'Could not load this conversation.' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: 'This request was blocked.' }, { status: 403 })
  }

  const { id } = await context.params
  if (!isValidConversationId(id)) return Response.json({ error: 'Conversation not found.' }, { status: 404 })

  let session: Awaited<ReturnType<typeof getAuthenticatedSession>>
  try {
    session = await getAuthenticatedSession()
  } catch {
    return Response.json({ error: 'Could not verify your account session.' }, { status: 503 })
  }
  if (!session?.user) return Response.json({ error: 'Sign in to delete conversations.' }, { status: 401 })

  try {
    await removeConversation(session.user.id, id)
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return Response.json({ error: 'Could not delete this conversation.' }, { status: 500 })
  }
}
