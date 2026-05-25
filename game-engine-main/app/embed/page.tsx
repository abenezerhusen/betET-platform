"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function EmbedInner() {
  const search = useSearchParams();
  const token = search.get("token");
  const tenant = search.get("tenant");
  const currency = search.get("currency");

  useEffect(() => {
    const parentOrigin =
      process.env.NEXT_PUBLIC_PARENT_ORIGIN?.trim() || "http://localhost:3000";
    window.parent.postMessage(
      {
        type: "GAME_READY",
        source: "game",
        payload: {
          tenant,
          currency,
          token_len: token?.length ?? 0,
        },
        ts: Date.now(),
      },
      parentOrigin
    );
  }, [token, tenant, currency]);

  const sendEnd = () => {
    const parentOrigin =
      process.env.NEXT_PUBLIC_PARENT_ORIGIN?.trim() || "http://localhost:3000";
    window.parent.postMessage(
      {
        type: "SESSION_END",
        source: "game",
        payload: { reason: "user_closed" },
        ts: Date.now(),
      },
      parentOrigin
    );
  };

  return (
    <div className="min-h-screen bg-[#0f1219] text-white flex flex-col items-center justify-center p-6">
      <h1 className="text-xl font-bold mb-2">BetET embed shell</h1>
      <p className="text-sm text-gray-400 mb-2 text-center max-w-md">
        Tenant <code className="text-gray-200">{tenant ?? "—"}</code>, currency{" "}
        <code className="text-gray-200">{currency ?? "—"}</code>
      </p>
      <p className="text-xs text-gray-500 mb-8 text-center max-w-md">
        Launch token: {token ? `${token.length} characters` : "missing"} — replace this page with your provider bundle when ready.
      </p>
      <button
        type="button"
        className="px-6 py-2 rounded-lg bg-emerald-500 text-black font-semibold hover:bg-emerald-400"
        onClick={sendEnd}
      >
        Close game (demo)
      </button>
    </div>
  );
}

export default function EmbedPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0f1219] text-gray-400 flex items-center justify-center">
          Loading…
        </div>
      }
    >
      <EmbedInner />
    </Suspense>
  );
}
