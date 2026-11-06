import { getAuthenticatedSession } from '@/lib/auth-session'
import { listElevenLabsVoices } from '@/lib/elevenlabs-voices'
import { isSameOriginRequest } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: 'This request was blocked.' }, { status: 403 })
  const session = await getAuthenticatedSession().catch(() => null)
  if (!session?.user) return Response.json({ error: 'Sign in to load voice options.' }, { status: 401 })

  try {
    const voices = await listElevenLabsVoices()
    return Response.json({ voices }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return Response.json({ error: 'Could not load available voices.' }, { status: 502 })
  }
}
