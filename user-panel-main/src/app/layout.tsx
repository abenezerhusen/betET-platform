import type { Metadata } from "next";
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
  title: "Play Core - Sports Betting",
  description: "Play Core - online sports betting platform with live odds, football, basketball, tennis and more.",
  manifest: "/manifest.json",
  icons: {
    icon: "/play-core-logo.png",
    shortcut: "/play-core-logo.png",
    apple: "/play-core-logo.png",
  },
  themeColor: "#a8e063",
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
