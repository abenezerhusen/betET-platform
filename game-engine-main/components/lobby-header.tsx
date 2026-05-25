"use client"

import { Search, ChevronDown, Crown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface LobbyHeaderProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  selectedProvider: string
  onProviderChange: (provider: string) => void
  providers: string[]
}

export function LobbyHeader({
  searchQuery,
  onSearchChange,
  selectedProvider,
  onProviderChange,
  providers,
}: LobbyHeaderProps) {
  return (
    <div className="sticky top-0 z-20 bg-[#0f1219] pb-4 sm:pb-6 md:pb-8">
      {/* Lobby Tab */}
      <div className="flex justify-center mb-4 sm:mb-6 md:mb-8">
        <div className="flex items-center gap-2 sm:gap-3 bg-slate-800/80 px-4 sm:px-6 md:px-8 py-2 sm:py-3 md:py-4 rounded-full border border-slate-700">
          <Crown className="w-4 sm:w-5 md:w-6 h-4 sm:h-5 md:h-6 text-yellow-500 flex-shrink-0" />
          <span className="text-white font-medium text-sm sm:text-base md:text-lg">Lobby</span>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col gap-3 sm:gap-4 md:gap-5">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 sm:w-5 h-4 sm:h-5 text-slate-400 flex-shrink-0" />
          <Input
            type="text"
            placeholder="Search games..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-10 sm:pl-12 pr-4 bg-transparent border-0 border-b border-slate-600 rounded-none text-white placeholder:text-slate-400 focus-visible:ring-0 focus-visible:border-slate-400 text-sm sm:text-base md:text-lg py-2 sm:py-3"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between bg-slate-800/50 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded-full text-sm sm:text-base md:text-lg px-4 sm:px-5 md:px-6 py-2 sm:py-3 md:py-4"
            >
              <span className="truncate">{selectedProvider}</span>
              <ChevronDown className="w-4 sm:w-5 md:w-6 h-4 sm:h-5 md:h-6 ml-2 flex-shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-full sm:w-56 md:w-64 bg-slate-800 border-slate-700">
            {providers.map((provider) => (
              <DropdownMenuItem
                key={provider}
                onClick={() => onProviderChange(provider)}
                className="text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer text-sm sm:text-base md:text-lg py-2 sm:py-3"
              >
                {provider}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
