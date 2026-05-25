"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import { memo, useCallback } from "react"
import { cn } from "@/lib/utils"

interface GameCardProps {
  title: string
  image: string
  isNew?: boolean
  isHot?: boolean
  slug?: string
  onClick?: () => void
}

function GameCardComponent({ title, image, isNew, isHot, slug, onClick }: GameCardProps) {
  const router = useRouter()

  const handleClick = useCallback(() => {
    if (slug) {
      router.push(`/games/${slug}`)
    } else if (onClick) {
      onClick()
    }
  }, [slug, onClick, router])

  return (
    <div
      onClick={handleClick}
      className={cn(
        "relative group cursor-pointer rounded-lg sm:rounded-xl overflow-hidden aspect-square w-full",
        "transition-all duration-300 hover:scale-105 hover:z-10 focus-visible:outline-none",
        "ring-2 ring-transparent hover:ring-yellow-500/70",
        isNew && "ring-yellow-500"
      )}
    >
      <Image
        src={image}
        alt={title}
        fill
        className="object-cover w-full h-full"
        sizes="(max-width: 375px) 45vw, (max-width: 640px) 48vw, (max-width: 768px) 32vw, (max-width: 1024px) 24vw, (max-width: 1280px) 19vw, (max-width: 1536px) 16vw, (max-width: 1920px) 13vw, 12vw"
        priority={false}
        loading="lazy"
        quality={75}
      />
      
      {/* Overlay on hover */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center p-2 sm:p-3">
        <button className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-2 sm:px-4 md:px-6 py-1 sm:py-2 rounded-full text-xs sm:text-sm md:text-base">
          Play
        </button>
      </div>

      {/* Badges */}
      {isNew && (
        <span className="absolute top-1 sm:top-2 left-1 sm:left-2 bg-green-500 text-white font-bold px-1.5 sm:px-2 py-0.5 rounded text-xs">
          NEW
        </span>
      )}
      {isHot && (
        <span className="absolute top-1 sm:top-2 right-1 sm:right-2 bg-red-500 text-white font-bold px-1.5 sm:px-2 py-0.5 rounded text-xs">
          HOT
        </span>
      )}
    </div>
  )
}

/**
 * Memoized — the lobby renders 30+ cards across 4 sections, and the
 * lobby's search/provider state changes would otherwise re-render
 * every card on every keystroke. With memo, only cards whose props
 * actually changed (rare) re-render.
 */
export const GameCard = memo(GameCardComponent)
