import { z } from 'zod'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { isValidConversationId, updateProject } from '@/lib/chat-store'
import { readJsonRequest, RequestBodyTooLargeError } from '@/lib/request-body'
import { isSameOriginRequest } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  memory: z.string().max(8_000).optional(),
}).strict().refine((value) => value.name !== undefined || value.memory !== undefined)

export async function PATCH(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })
  const session = await getAuthenticatedSession().catch(() => null)
  if (!session?.user) return Response.json({ error: 'Sign in to update this project.' }, { status: 401 })

  const { id } = await context.params
  if (!isValidConversationId(id)) return Response.json({ error: 'Project not found.' }, { status: 404 })

  let rawBody: unknown
  try {
    rawBody = await readJsonRequest(request, 12_000)
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400
    return Response.json({ error: 'The project update is invalid.' }, { status })
  }

  const parsed = updateProjectSchema.safeParse(rawBody)
  if (!parsed.success) return Response.json({ error: 'Provide a project name or memory of up to 8,000 characters.' }, { status: 400 })

  try {
    const project = await updateProject(session.user.id, id, parsed.data)
    if (!project) return Response.json({ error: 'Project not found.' }, { status: 404 })
    return Response.json(project, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return Response.json({ error: 'Could not update this project. Project names must be unique.' }, { status: 409 })
  }
}
