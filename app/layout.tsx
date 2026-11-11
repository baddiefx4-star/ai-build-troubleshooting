import { Analytics } from '@vercel/analytics/next'
import { cookies } from 'next/headers'
import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from '@/components/theme-provider'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'CTECH AI — Your creative AI workspace',
  description: 'A fast personal AI workspace for conversations, image creation, research, voice, and project work.',
  generator: 'v0.app',
  icons: {
    icon: '/icon.svg',
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: '#f7f3eb',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const savedTheme = (await cookies()).get('ctech-theme')?.value
  const initialTheme = savedTheme === 'dark' ? 'dark' : 'light'

  return (
    <html lang="en" data-theme={initialTheme} className={`${geist.variable} ${geistMono.variable} bg-background`}>
      <body className="antialiased">
        <ThemeProvider initialTheme={initialTheme}>
          {children}
          {process.env.NODE_ENV === 'production' && <Analytics />}
        </ThemeProvider>
      </body>
    </html>
  )
}
