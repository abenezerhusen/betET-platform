"use client"

import { memo } from "react"
import { GameCard } from "./game-card"
import { Button } from "@/components/ui/button"

interface Game {
  id: string
  title: string
  image: string
  isNew?: boolean
  isHot?: boolean
  slug?: string
}

interface GameSectionProps {
  title: string
  games: Game[]
  onShowAll?: () => void
  /**
   * Optional fallback handler invoked when a card is clicked but the
   * game has no `slug` (i.e. the game page does not exist yet). When
   * omitted, such cards do nothing on click — preserving the existing
   * behaviour of every section that doesn't opt in.
   */
  onCardClickWithoutSlug?: (game: Game) => void
}

function GameSectionComponent({ title, games, onShowAll, onCardClickWithoutSlug }: GameSectionProps) {
  return (
    <section className="w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-5">
        <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-pink-500 truncate">{title}</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={onShowAll}
          className="bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm w-full sm:w-auto"
        >
          Show All
        </Button>
      </div>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2 sm:gap-3 md:gap-4 lg:gap-5 w-full">
        {games.map((game) => (
          <GameCard
            key={game.id}
            title={game.title}
            image={game.image}
            isNew={game.isNew}
            isHot={game.isHot}
            slug={game.slug}
            onClick={onCardClickWithoutSlug ? () => onCardClickWithoutSlug(game) : undefined}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * Memoized — the lobby renders 4 sections; without memo, typing in
 * the search box (state in the parent) would force every section and
 * every card inside it to reconcile.
 */
export const GameSection = memo(GameSectionComponent)
