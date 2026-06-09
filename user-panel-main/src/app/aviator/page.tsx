import { redirect } from "next/navigation";

/**
 * The Aviator route is a shortcut only. It must not embed the game engine
 * directly (that would bypass the lobby's catalogue / permission checks), so
 * it funnels into the standard `/games` launch flow, which validates the game
 * against the loaded lobby before opening it through the Game Engine.
 */
export default function AviatorPage() {
  redirect("/games?play=aviator");
}
