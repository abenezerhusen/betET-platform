import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ClientBody from "./ClientBody";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://1birr.bet"),
  title: "1birr.bet — Cashier",
  description:
    "1birr.bet cashier panel — sell tickets, pay out winners, process deposits and withdrawals.",
  applicationName: "1birr.bet Cashier",
  icons: {
    icon: [{ url: "/1birr-icon.svg", type: "image/svg+xml" }],
    shortcut: "/1birr-icon.svg",
    apple: "/1birr-icon.svg",
  },
  openGraph: {
    type: "website",
    siteName: "1birr.bet",
    title: "1birr.bet — Cashier",
    description:
      "1birr.bet cashier panel — sell tickets, pay out winners, process deposits and withdrawals.",
    url: "https://1birr.bet",
    images: [{ url: "/1birr-icon.svg", width: 512, height: 512, alt: "1birr.bet" }],
  },
  twitter: {
    card: "summary",
    title: "1birr.bet — Cashier",
    description:
      "1birr.bet cashier panel — sell tickets, pay out winners, process deposits and withdrawals.",
    images: ["/1birr-icon.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} bg-background`}>
      <body suppressHydrationWarning className="antialiased">
        <ClientBody>{children}</ClientBody>
      </body>
    </html>
  );
}
