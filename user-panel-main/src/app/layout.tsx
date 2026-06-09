import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import MobileBottomNav from "@/components/MobileBottomNav";
import MobileSportsSidebar from "@/components/MobileSportsSidebar";
import { BetProvider } from "@/context/BetContext";
import { FavoritesProvider } from "@/context/FavoritesContext";
import { AuthProvider } from "@/context/AuthContext";
import { PerformanceOptimizer } from "@/components/PerformanceOptimizer";

export const metadata: Metadata = {
  metadataBase: new URL("https://1birr.bet"),
  title: "1birr.bet — Sports Betting Ethiopia",
  description:
    "Bet on football, basketball, Aviator & more. Fast payouts, live betting, and big wins. Ethiopia's modern betting platform. Register now.",
  applicationName: "1birr.bet",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/1birr-icon.svg", type: "image/svg+xml" },
      { url: "/1birr-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/1birr-icon.svg",
    apple: "/1birr-icon-512.png",
  },
  openGraph: {
    type: "website",
    siteName: "1birr.bet",
    title: "1birr.bet — Sports Betting Ethiopia",
    description:
      "Bet on football, basketball, Aviator & more. Fast payouts, live betting, and big wins. Ethiopia's modern betting platform. Register now.",
    url: "https://1birr.bet",
    images: [{ url: "/1birr-icon-512.png", width: 512, height: 512, alt: "1birr.bet" }],
  },
  twitter: {
    card: "summary",
    title: "1birr.bet — Sports Betting Ethiopia",
    description:
      "Bet on football, basketball, Aviator & more. Fast payouts, live betting, and big wins.",
    images: ["/1birr-icon-512.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#22c55e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="dns-prefetch" href="//ext.same-assets.com" />
        <link rel="preconnect" href="https://ext.same-assets.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased min-h-screen flex flex-col">
        <AuthProvider>
          <BetProvider>
            <FavoritesProvider>
              <PerformanceOptimizer />
              <Header />
              <main className="flex-1">{children}</main>
              <Footer />
              {/* Phone-only bottom navigation (md:hidden). Rendered outside
                  the flex column so it overlays the viewport without pushing
                  layout. Content clearance is handled in globals.css. */}
              <MobileBottomNav />
              {/* Mobile sports / leagues filter sidebar. Triggered by the
                  bottom-nav Menu tab via `mezzobet:open-sports-sidebar`.
                  Rendered globally so users can drill into a league from
                  any page, just like the desktop left sidebar allows. */}
              <MobileSportsSidebar />
            </FavoritesProvider>
          </BetProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
