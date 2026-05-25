import type { Metadata } from 'next'
import { Geist, Geist_Mono, Roboto_Condensed } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });
const robotoCondensed = Roboto_Condensed({ 
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-roboto-condensed"
});

export const metadata: Metadata = {
  title: 'Playcore - Casino Games',
  description: 'Play exciting casino games',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`font-sans antialiased ${robotoCondensed.variable}`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
