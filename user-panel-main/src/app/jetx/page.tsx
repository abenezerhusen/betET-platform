import { redirect } from "next/navigation";

/**
 * The JetX route is a shortcut only. It funnels into the standard `/games`
 * launch flow rather than embedding the game engine directly, so the lobby's
 * catalogue / permission checks always apply before the game opens.
 */
export default function JetXPage() {
  redirect("/games?play=jetx");
}
