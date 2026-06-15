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
  metadataBase: new URL('https://1birr.bet'),
  title: '1birr.bet — Casino Games',
  description:
    'Play Aviator, Fast Keno, JetX, Multi Hot 5 and more on 1birr.bet — Ethiopia\'s modern betting platform.',
  applicationName: '1birr.bet',
  icons: {
    icon: [{ url: '/1birr-icon.svg', type: 'image/svg+xml' }],
    shortcut: '/1birr-icon.svg',
    apple: '/1birr-icon.svg',
  },
  openGraph: {
    type: 'website',
    siteName: '1birr.bet',
    title: '1birr.bet — Casino Games',
    description:
      'Play Aviator, Fast Keno, JetX, Multi Hot 5 and more on 1birr.bet — Ethiopia\'s modern betting platform.',
    url: 'https://1birr.bet',
    images: [{ url: '/1birr-icon.svg', width: 512, height: 512, alt: '1birr.bet' }],
  },
  twitter: {
    card: 'summary',
    title: '1birr.bet — Casino Games',
    description:
      'Play Aviator, Fast Keno, JetX, Multi Hot 5 and more on 1birr.bet.',
    images: ['/1birr-icon.svg'],
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
