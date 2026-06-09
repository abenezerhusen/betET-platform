/**
 * Embedded-navigation helpers.
 *
 * The game engine is always opened from the user panel inside an `<iframe>`.
 * Its in-game "back" controls must therefore NOT navigate the iframe to the
 * game engine's own lobby (`/`) — doing so would let a player browse and open
 * any game directly inside the engine, bypassing the user panel's catalogue /
 * permission system.
 *
 * Instead, when embedded we notify the parent window (the user panel) so it
 * can close the game and return the player to its own games list. When the
 * page is opened standalone (e.g. local game-engine development, not in an
 * iframe) we fall back to the engine lobby so the back control still works.
 */

const BACK_MESSAGE_TYPE = "GAME_BACK" as const;

/** True when this document is rendered inside another window (an iframe). */
export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.parent != null && window.parent !== window;
  } catch {
    // A cross-origin parent throws on access — that itself means we're embedded.
    return true;
  }
}

/** Ask the parent (user panel) to close the game and go back to its lobby. */
export function notifyParentBack(): void {
  if (typeof window === "undefined") return;
  const parentOrigin =
    process.env.NEXT_PUBLIC_PARENT_ORIGIN?.trim() || "*";
  try {
    window.parent.postMessage(
      {
        type: BACK_MESSAGE_TYPE,
        source: "game",
        payload: { reason: "user_back" },
        ts: Date.now(),
      },
      parentOrigin,
    );
  } catch {
    /* ignore — parent unreachable */
  }
}

/**
 * Unified back handler for in-game "back to lobby" controls.
 *
 *   • Embedded (normal user-panel launch) → tell the parent to return to its
 *     games list. The engine lobby is never shown inside the iframe.
 *   • Standalone (direct engine access)   → run `onStandalone` if provided
 *     (e.g. `router.push('/')`), otherwise hard-navigate to the engine lobby.
 */
export function goBackToParent(onStandalone?: () => void): void {
  if (isEmbedded()) {
    notifyParentBack();
    return;
  }
  if (onStandalone) {
    onStandalone();
    return;
  }
  if (typeof window !== "undefined") window.location.assign("/");
}
