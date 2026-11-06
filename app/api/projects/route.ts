import { z } from 'zod'
import { getAuthenticatedSession } from '@/lib/auth-session'
import { getChatSessionId } from '@/lib/chat-session'
import { claimGuestConversations, createProject, ensureDefaultProject, listProjects } from '@/lib/chat-store'
import { readJsonRequest, RequestBodyTooLargeError } from '@/lib/request-body'
import { isSameOriginRequest } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(60),
}).strict()

async function getUserId(request: Request) {
  if (!isSameOriginRequest(request)) return { error: Response.json({ error: 'This request was blocked.' }, { status: 403 }) }
  const session = await getAuthenticatedSession().catch(() => null)
  if (!session?.user) return { error: Response.json({ error: 'Sign in to manage projects.' }, { status: 401 }) }
  return { userId: session.user.id }
}

export async function GET(request: Request) {
  const authResult = await getUserId(request)
  if ('error' in authResult) return authResult.error

  try {
    const defaultProjectId = await ensureDefaultProject(authResult.userId)
    await claimGuestConversations(await getChatSessionId(), authResult.userId, defaultProjectId)
    const projects = await listProjects(authResult.userId)
    return Response.json(projects, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return Response.json({ error: 'Could not load projects.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const authResult = await getUserId(request)
  if ('error' in authResult) return authResult.error

  let rawBody: unknown
  try {
    rawBody = await readJsonRequest(request, 2_000)
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400
    return Response.json({ error: 'Enter a project name of up to 60 characters.' }, { status })
  }

  const parsed = createProjectSchema.safeParse(rawBody)
  if (!parsed.success) return Response.json({ error: 'Enter a project name of up to 60 characters.' }, { status: 400 })

  try {
    const project = await createProject(authResult.userId, parsed.data.name)
    return Response.json(project, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) {
      return Response.json({ error: 'A project with that name already exists.' }, { status: 409 })
    }
    return Response.json({ error: 'Could not create this project.' }, { status: 500 })
  }
}
