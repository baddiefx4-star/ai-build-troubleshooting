import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { VoiceSettings } from '@/components/settings/voice-settings'
import { auth } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Settings | CTECH AI',
  description: 'Manage CTECH AI voice and speech settings.',
}

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  return <VoiceSettings />
}
