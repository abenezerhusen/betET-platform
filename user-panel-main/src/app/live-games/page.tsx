"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { liveCasinoApi } from "@/lib/api";

export default function LiveGamesPage() {
  const [games, setGames] = useState<liveCasinoApi.LiveCasinoGame[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await liveCasinoApi.listLiveCasinoGames();
        if (cancelled) return;
        setGames(res.games ?? []);
        setMessage(res.message ?? "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <div className="flex-1" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="p-4">
          <h1 className="text-2xl font-bold mb-4">Live Casino</h1>
          {loading && <p className="text-sm text-gray-400 mb-3">Loading live games...</p>}
          {!loading && message && (
            <div className="mb-4 rounded p-3 text-sm" style={{ background: "var(--mezzo-bg-secondary)" }}>
              Live casino is not yet configured. Contact admin to enable a provider.
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {games.map((game) => (
              <div
                key={String(game.id)}
                className="group relative rounded-lg overflow-hidden cursor-pointer transition-transform hover:scale-105"
                style={{ background: "var(--mezzo-bg-secondary)" }}
              >
                <div className="aspect-video relative">
                  <img src={game.thumbnail_url || "https://ext.same-assets.com/1203561035/2427311734.jpeg"} alt={game.name} className="w-full h-full object-cover" />
                  <div className="absolute top-2 right-2 px-2 py-1 rounded text-xs font-semibold text-white flex items-center gap-1" style={{ background: "rgba(255,0,0,0.8)" }}>
                    <div className="w-2 h-2 rounded-full bg-white animate-pulse"></div>
                    LIVE
                  </div>
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button className="px-6 py-2 rounded-full text-black font-semibold" style={{ background: "var(--mezzo-accent-green)" }}>
                      Play Now
                    </button>
                  </div>
                </div>
                <div className="p-3">
                  <h3 className="font-semibold text-sm mb-1">{game.name}</h3>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Dealer: {game.dealer}</span>
                    <div className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      <span>{game.players_online}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {!loading && !games.length && (
              <div className="col-span-full text-sm text-gray-400">No live games available.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
