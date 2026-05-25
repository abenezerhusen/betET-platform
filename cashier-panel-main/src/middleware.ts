import { NextRequest, NextResponse } from "next/server";

// This app is a single-page experience: all views (Tickets, Super Jackpots,
// Withdraw/Deposit, Dashboard, Settings) are rendered by `src/app/page.tsx`
// and switched via internal state. Rewrite any non-asset path back to `/`
// so direct URLs like `/dashboard` still load the app instead of 404-ing.
export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const path = url.pathname;

  // Never rewrite framework/static assets, API routes, or real files.
  if (
    path.startsWith("/_next/") ||
    path.startsWith("/api/") ||
    path === "/favicon.ico" ||
    path.includes(".")
  ) {
    return NextResponse.next();
  }

  if (url.pathname !== "/") {
    url.pathname = "/";
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/:path*",
  ],
};
