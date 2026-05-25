"use client";

// The `/sport` route intentionally renders the exact same UI as the home
// page (left sports sidebar, Upcoming Matches / Top Leagues tabs, time
// filter, and the detailed "more options" view). All deep-link params
// (?sport=&country=&league=) are handled by the shared HomePage component,
// so every sidebar link and side-bets click keeps working the same way.
import HomePage from "@/app/page";

export default function SportPage() {
  return <HomePage />;
}
