"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { LobbyHeader } from "@/components/lobby-header"
import { GameSection } from "@/components/game-section"
import { LobbyFooter } from "@/components/lobby-footer"
import { fetchLobby, type LobbyGame, type LobbyResponse } from "@/lib/game-engine"

/**
 * Map a backend `LobbyGame` into the `<GameSection />` card shape. Falls
 * back to the local thumbnail bundle when the DB row has no
 * `thumbnail_url`, so the section never renders a broken image.
 */
function toCard(game: LobbyGame): {
  id: string
  title: string
  image: string
  isNew?: boolean
  isHot?: boolean
  slug?: string
} {
  return {
    id: game.id,
    title: game.name,
    image:
      game.thumbnail_url && game.thumbnail_url.length > 0
        ? game.thumbnail_url
        : `/games/${game.id}-thumb.png`,
    slug: game.slug ?? undefined,
  }
}

// Sample game data - you can expand this
const sampleGames = [
  { id: "1", title: "Aztec Gems", image: "/games/aztec-gems.jpg", isNew: true },
  { id: "2", title: "Gold Gold Gold", image: "/games/gold-star.jpg" },
  { id: "3", title: "Gold Gold Gold 5000", image: "/games/gold-star.jpg" },
  { id: "4", title: "Big Bass Bonanza", image: "/games/big-bass.jpg", isHot: true },
  { id: "5", title: "Coin Flip", image: "/games/coin-flip.jpg" },
  { id: "6", title: "Bingo Star", image: "/games/bingo-star.jpg" },
  { id: "7", title: "Cash Strike", image: "/games/cash-strike.jpg" },
  { id: "8", title: "Avia Masters", image: "/games/avia-masters.jpg" },
  { id: "9", title: "Chicken Air", image: "/games/chicken-air.jpg" },
  { id: "10", title: "Rabbit Road", image: "/games/rabbit-road.jpg", isHot: true },
  { id: "11", title: "Diamond Bomb", image: "/games/diamond-bomb.jpg" },
  { id: "12", title: "Lucky Seven", image: "/games/gold-star.jpg", isNew: true },
]

const popularGames = [
  { id: "p1", title: "Mega Fortune", image: "/games/gold-star.jpg", isHot: true },
  { id: "p2", title: "Starburst", image: "/games/diamond-bomb.jpg" },
  { id: "p3", title: "Book of Dead", image: "/games/aztec-gems.jpg", isHot: true },
  { id: "p4", title: "Gonzo Quest", image: "/games/aztec-gems.jpg" },
  { id: "p5", title: "Sweet Bonanza", image: "/games/sweet-bonanza.jpg" },
  { id: "p6", title: "Wolf Gold", image: "/games/wolf-gold.jpg" },
]

const slotsGames = [
  { id: "s1", title: "Fruit Party", image: "/games/sweet-bonanza.jpg" },
  { id: "s2", title: "Wild West Gold", image: "/games/wolf-gold.jpg", isNew: true },
  { id: "s3", title: "Gates of Olympus", image: "/games/gold-star.jpg", isHot: true },
  { id: "s4", title: "Madame Destiny", image: "/games/diamond-bomb.jpg" },
  { id: "s5", title: "John Hunter", image: "/games/aztec-gems.jpg" },
  { id: "s6", title: "Gems Bonanza", image: "/games/coin-flip.jpg" },
]

const topSelectedGames = [
  { id: "t11", title: "Aviator", image: "/games/aviator-thumb.png", isHot: true, slug: "aviator" },
  { id: "t1", title: "Fast Keno", image: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-p9KcOJf58IMwFvhGm7LEYb3ZRKaEOw.png", slug: "fast-keno" },
  { id: "t2", title: "Multi Hot 5", image: "/games/multi-hot-5-thumb.png", isHot: true, slug: "multi-hot-5" },
  { id: "t3", title: "JetX", image: "/games/jet-x-thumb.png" },
  { id: "t4", title: "Safari Simba", image: "/games/safari-simba-thumb.png" },
  { id: "t12", title: "Crazy Rocket", image: "/games/crazy-rocket-thumb.png" },
  { id: "t13", title: "Helicopter X", image: "/games/helicopter-x-thumb.png" },
  { id: "t14", title: "Plinko", image: "/games/plinko-thumb.png" },
  { id: "t5", title: "Hollywood 777", image: "/games/gold-star.jpg" },
  { id: "t6", title: "Habesha Fortune", image: "/games/habesha-fortune-5-thumb.png", isNew: true },
  { id: "t7", title: "Buffalo Extreme", image: "/games/big-bass.jpg", isHot: true },
  { id: "t8", title: "Burning Ice", image: "/games/diamond-bomb.jpg" },
  { id: "t9", title: "Keno", image: "/games/bingo-star.jpg", slug: "fast-keno" },
  { id: "t10", title: "Chicken Road 2", image: "/games/chicken-air.jpg" },
]

const providers = ["All Providers", "Pragmatic Play", "NetEnt", "Microgaming", "Play'n GO", "Evolution"]

export default function LobbyPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedProvider, setSelectedProvider] = useState("All Providers")
  const [lobby, setLobby] = useState<LobbyResponse | null>(null)

  // Pull the lobby from the backend. The four canonical sections (top /
  // new / popular / all) are populated from `internal_games` rows that the
  // admin marked as Active. We keep the hard-coded fallback below in case
  // the backend is unreachable so the UI never renders an empty page.
  useEffect(() => {
    let cancelled = false
    fetchLobby()
      .then((data) => {
        if (!cancelled) setLobby(data)
      })
      .catch(() => {
        if (!cancelled) setLobby(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Stable handlers so the memoized <GameSection /> components don't
  // re-render every time `searchQuery` or `selectedProvider` change.
  const handleShowAllTopSelected = useCallback(() => console.log("Show all top selected"), [])
  const handleShowAllNewArrivals = useCallback(() => console.log("Show all new arrivals"), [])
  const handleShowAllPopular = useCallback(() => console.log("Show all popular"), [])
  const handleShowAllSlots = useCallback(() => console.log("Show all slots"), [])

  // Spec §17 Lobby — "Click game without slug: shows Coming Soon".
  // Wired on every section so any future card without a `slug` field gets
  // the same friendly fallback instead of silently doing nothing.
  const handleComingSoon = useCallback((game: { title: string }) => {
    if (typeof window !== "undefined") {
      window.alert(`${game.title} — Coming soon...`)
    }
  }, [])

  const liveTopSelected = useMemo(
    () => (lobby ? lobby.top_games.map(toCard) : null),
    [lobby],
  )
  const liveNewArrivals = useMemo(
    () => (lobby ? lobby.new_games.map(toCard) : null),
    [lobby],
  )
  const livePopular = useMemo(
    () => (lobby ? lobby.popular_games.map(toCard) : null),
    [lobby],
  )
  const liveAll = useMemo(
    () => (lobby ? lobby.all_games.map(toCard) : null),
    [lobby],
  )

  return (
    <div className="min-h-screen bg-[#0f1219]">
      <div className="h-screen overflow-y-auto overflow-x-hidden lobby-scroll">
        <div className="w-screen px-[2%] sm:px-[3%] md:px-[4%] lg:px-[5%] xl:px-[6%] 2xl:px-[7%] py-4 sm:py-6 md:py-8">
          <div className="mx-auto" style={{ maxWidth: 'min(100%, 1920px)' }}>
            <LobbyHeader
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedProvider={selectedProvider}
              onProviderChange={setSelectedProvider}
              providers={providers}
            />

            <div className="mt-6 sm:mt-8 space-y-6 sm:space-y-8">
              <GameSection
                title="Top Selected Games"
                games={liveTopSelected && liveTopSelected.length > 0 ? liveTopSelected : topSelectedGames}
                onShowAll={handleShowAllTopSelected}
                onCardClickWithoutSlug={handleComingSoon}
              />

              <GameSection
                title="New Arrivals"
                games={liveNewArrivals && liveNewArrivals.length > 0 ? liveNewArrivals : sampleGames}
                onShowAll={handleShowAllNewArrivals}
                onCardClickWithoutSlug={handleComingSoon}
              />

              <GameSection
                title="Popular Games"
                games={livePopular && livePopular.length > 0 ? livePopular : popularGames}
                onShowAll={handleShowAllPopular}
                onCardClickWithoutSlug={handleComingSoon}
              />

              <GameSection
                title="Slots"
                games={liveAll && liveAll.length > 0 ? liveAll : slotsGames}
                onShowAll={handleShowAllSlots}
                onCardClickWithoutSlug={handleComingSoon}
              />
            </div>

            <LobbyFooter />
          </div>
        </div>
      </div>
    </div>
  )
}
