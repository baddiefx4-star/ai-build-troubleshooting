import { getAuthenticatedSession } from '@/lib/auth-session'
import { getChatSessionId } from '@/lib/chat-session'
import { claimGuestConversations, ensureDefaultProject, getProject, isValidConversationId, listConversations, searchConversations } from '@/lib/chat-store'
import { isSameOriginRequest } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: 'This request was blocked.' }, { status: 403 })
  }

  let session: Awaited<ReturnType<typeof getAuthenticatedSession>>
  try {
    session = await getAuthenticatedSession()
  } catch {
    return Response.json({ error: 'Could not verify your account session.' }, { status: 503 })
  }
  if (!session?.user) return Response.json({ error: 'Sign in to view saved conversations.' }, { status: 401 })

  const url = new URL(request.url)
  const projectId = url.searchParams.get('projectId') ?? ''
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 120)
  if (!isValidConversationId(projectId)) return Response.json({ error: 'Choose a valid project.' }, { status: 400 })

  try {
    const defaultProjectId = await ensureDefaultProject(session.user.id)
    await claimGuestConversations(await getChatSessionId(), session.user.id, defaultProjectId)
    if (!await getProject(session.user.id, projectId)) return Response.json({ error: 'Project not found.' }, { status: 404 })
    const conversations = query
      ? await searchConversations(session.user.id, projectId, query)
      : await listConversations(session.user.id, projectId)
    return Response.json(conversations, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return Response.json({ error: 'Could not load saved conversations.' }, { status: 500 })
  }
}
