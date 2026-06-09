"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  ensureGameToken,
  fetchPlayerMe,
  readBalance,
  spinSlots,
  type SlotsSpinResponse,
} from "@/lib/game-engine"
import { goBackToParent } from "@/lib/embed-nav"
import { useBalanceToast } from "@/components/balance-toast"
import { useStageScale } from "@/hooks/use-stage-scale"

// Asset URLs - All provided assets
const ASSETS = {
  background: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/background-ynPmSEqxrm10w7H7cw8e1VW0IE8j0l.jpg",
  logo: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Logo-3-hwteuUIakHB385J26cKZALiVz5Sf7j.png",
  smartsoftLogo: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/new-hood-logo-giDqLyAOqpM6i7BGO1tEVnYYYudZVM.png",
  menuIcon: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/mobile-menu-open-icon-G1iUUTWhRNy4UPJrd2PJmhe3gOuAL2.png",
  boxWin1: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BoxWin-1-SDOOj8qlP79yDnbPt8cqQ5svBBBxdb.png",
  images0: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Images-0-q7xGYrFBskfcbqloX9lfFnWI7cUZWv.png",
  mogeba: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/mogeba-6JpDrZQG6pPrUzHjt3g5vT9wOqiTYk.png",
  loader: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/universal-loader-rgFTlduZX4B1SyWTtG804tDW9gnPM1.gif",
  bigWinBadge: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/09-removebg-preview-evVtVmdFjtcbPMMrV5Bmc482ue5hNu.png",
  // Win line assets
  lineOne: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/line_one_-removebg-preview-q86naMcmHG43TeNGN4o0yecpypv7rO.png",
  lineTwo: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/line_2-removebg-preview-fwP4eZB7EndRMx5eghkO0yQjWLbeLI.png",
  lineFour: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/line_4-removebg-preview-X0GEHBqlhzzdt15PuGMJ0JF7nH7l6E.png",
  lineFive: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/line_5-removebg-preview-P3W8qpwNTI5Ta8SxdjZTbpopYh7P1h.png",
  // Multiplier sprites
  x1: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/X1-5ZzDbugAQaoGd09Yjvuqx62NgrRKQj.png",
  x2: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/X2-G1Gn4il5QE7eAvNmqYlFZZ18Y54lQ7.png",
  x3: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/X3-l2kdg9KAacUX4PrTePU02oRI7njfiv.png",
  x4: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/X4-5NhNAysX5ts6c0CPFQVitNRe2g3Sqj.png",
  x5: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/X5-S7LoLQPYz2axvls55A40qELHROgbV6.png",
  // Audio files
  bgMusic: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/mutli%20hot%20background%20music-O4CUWtswAtZ0LEMHMXyS3KX4YsTjhI.mp3",
  clickSound: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/click%20sound%20for%20mutlihot-qOdL6Am7EZjhM0DwSZGhGGBKDvyF8x.mp3",
  winSound: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/wining%20sound%20multi%20hot-UEbHIL5E97KS6pVyU0dM0Qaj58BdUT.mp3",
}

// Symbol images - clear and blurred versions
const SYMBOL_IMAGES = {
  cherry: {
    clear: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/1-2NpcadJMwsG9QFiYHKldDb99cYrfNX.png",
    blur: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/6-vgXYqxDJJoear9q4cxA1M2kcjOcBoI.png",
  },
  orange: {
    clear: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/2-EG3YYaINrQIlUcZi9r10Wyn3Q5oiRX.png",
    blur: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/7-IrBZDn9pWAk1I5Es6zYYF1KJ6EDEDN.png",
  },
  watermelon: {
    clear: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/3-wnnycLr8csoXTXqUFhob2SNRPyXtN4.png",
    blur: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/8-mzU7ssOjiTPHHDgy0ehMzyx6gzyESz.png",
  },
  seven: {
    clear: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/4-VlcFlrjM1A4pngi79EUPrjrnieW0c7.png",
    blur: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/9-dmbY96yljjMUD6Ka655k2UBuyVAEeM.png",
  },
  grapes: {
    clear: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/5-uanzXKV9YlyKFMgcDjXUyPyoFCyqB8.png",
    blur: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/10-Ggpffu3KuM3qvK00NkNjfoqsojnUpm.png",
  },
  bell: {
    clear: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/11-6PNfWocBp8nSeNlEUdGLb2mZqv79fr.png",
    blur: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/14-4VdOC1tCEr1wueDnfkInfuBT2mRXfF.png",
  },
  lemon: {
    clear: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/12-JdVgEzltjIIBi9gUmkVVqKsj8foRi7.png",
    blur: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/16-jebGNB5cpMcWkhnhzB2UTkK3ihI9PY.png",
  },
  dollar: {
    clear: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/13-CAjzFVYpzlFDBCq1Q2oSv3Pakoqroc.png",
    blur: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/17-lMKpcIA7HX24AmlmCH3jOf4fWBw1U9.png",
  },
  plum: {
    clear: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/15-tY6njWFQ1Ri7k118g0CmzKcSEYU2Sj.png",
    blur: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/18-KuzQBTKFhgujIQfdnpJtlzkHOWB77C.png",
  },
}

// Symbol definitions
const SYMBOLS = [
  { id: "seven", name: "77", value: 1000 },
  { id: "dollar", name: "$$", value: 500 },
  { id: "bell", name: "Bell", value: 200 },
  { id: "watermelon", name: "Watermelon", value: 100 },
  { id: "grapes", name: "Grapes", value: 80 },
  { id: "orange", name: "Orange", value: 60 },
  { id: "cherry", name: "Cherry", value: 40 },
  { id: "lemon", name: "Lemon", value: 30 },
  { id: "plum", name: "Plum", value: 20 },
]

// Multiplier definitions with new image assets
const MULTIPLIER_IMAGES = {
  x1: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/1-neDW8JYjl7VUqZMgkUUqshQ3hlSUcr.png",
  x2: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/3-pSdquJxU4H9t4OZBQ4rhMSrKB6fver.png",
  x3: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/4-UdmQrtOdomidgadVOvnRhkB8aUVKa0.png",
  x4: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/5-459iSgAlU2AHs6KaEmY9JIghMsg1mu.png",
  x5: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/2-8Ve3VoEAOGTS2ChIr0CBw9oFC03M70.png",
  frame: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Images-0-6ple6cQTlZBVUIhwEL3D1YMJc5tjs1.png",
}

// Gamble feature assets
const GAMBLE_ASSETS = {
  button2xActive: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/2x%201-f58QmYo30EZOoyt5sDw1VCFERMSzKp.png",
  button2xInactive: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/2x%202-aYgadhqaP0CNHBbZKIbfvwqzkx7IjB.png",
  greenCard: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/green%20card%202-08nvuGHN1e4QTxpD00eez7JMdpjMvf.png",
  redCard: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/red%20card-8UUtzQdbGunJii2O87xUf1u8YlEFKL.png",
  greenBox: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/green%20box%20-j3NzzIOOzRgX3w3D6GMqgZyIwsFGOn.png",
  redBox: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/red%20box%202-KT9TMyMr3ZvXvGq8s9tSiLWb2ZPYP7.png",
  redBoxGlow: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/red%20box%201-9WL5Y5PHfv130XfPfXSLHtyxCmEQAN.png",
  blackBox: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/black%20box%203-xtnwPlLT4fycCo8Ja3ekKlUAsRlCrw.png",
  blackBoxLarge: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/black%20box%202-8Nxhqa2bYPlugiLZcHKtLxfXMNtX8B.png",
  aceHearts: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Ace_Hearts-PcMroctlAdySO6ti9tWSUVrRJik9BL.png",
  aceDiamonds: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Ace_Diamonds-Jrp6O56wJv3yF4hTtWIFnX5URW2Pat.png",
  aceClubs: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Ace_Clubs-SBfOzTyWkvOSlfagEQ36MPRSap0Ixq.png",
  aceSpades: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Ace_Spades-Mmv7gnH9xKu5xoXi6Jz24qkwWCsf9D.png",
}

const MULTIPLIERS = [
  { value: 1, image: MULTIPLIER_IMAGES.x1, color: '#4a90d9' },
  { value: 2, image: MULTIPLIER_IMAGES.x2, color: '#d4af37' },
  { value: 3, image: MULTIPLIER_IMAGES.x3, color: '#d4af37' },
  { value: 4, image: MULTIPLIER_IMAGES.x4, color: '#ff6b35' },
  { value: 5, image: MULTIPLIER_IMAGES.x5, color: '#ff1493' },
]

// 5 paylines (3 columns)
const PAYLINES = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
]

// Symbol component using clear/blur images with vertical spinning animation
function SlotSymbol({ symbolId, isWinning, isSpinning }: { symbolId: string, isWinning: boolean, isSpinning: boolean }) {
  const images = SYMBOL_IMAGES[symbolId as keyof typeof SYMBOL_IMAGES]
  const imageUrl = isSpinning ? images.blur : images.clear
  
  return (
    <div 
      className="relative w-full h-full flex items-center justify-center overflow-hidden"
      style={{
        filter: isWinning ? 'brightness(1.3)' : 'brightness(1)',
      }}
    >
      {/* Spinning animation container */}
      <div
        className={isSpinning ? 'animate-spin-vertical' : ''}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={imageUrl}
          alt={symbolId}
          className="w-full h-full object-contain"
          style={{
            transition: isSpinning ? 'none' : 'transform 0.15s ease-out',
          }}
        />
      </div>
    </div>
  )
}

export default function MultiHot5Page() {
  const { notify: notifyBalance, toast: balanceToast } = useBalanceToast()
  useStageScale()
  // Section 17 spec — balance is the authoritative wallet value from
  // GET /api/users/me. We never invent it client-side.
  const [balance, setBalance] = useState(0)

  useEffect(() => {
    let cancelled = false
    // Resolve a token first (live: iframe token; local dev: auto-minted
    // seeded-player token) so the game always opens, then hydrate wallet.
    void (async () => {
      await ensureGameToken()
      if (cancelled) return
      fetchPlayerMe()
        .then((me) => {
          if (!cancelled) setBalance(readBalance(me))
        })
        .catch(() => {
          /* unauthenticated — handled centrally in lib/api */
        })
    })()
    return () => {
      cancelled = true
    }
  }, [])
  const [betAmount, setBetAmount] = useState(0.25)
  const [betPerLine, setBetPerLine] = useState(0.05)
  const [showBetScroll, setShowBetScroll] = useState(false)
  const [showMenuPopup, setShowMenuPopup] = useState(false)
  const [menuActiveTab, setMenuActiveTab] = useState<'rules' | 'settings' | 'history'>('rules')
  const [spinId] = useState(() => `#${Math.floor(Math.random() * 9000000000) + 1000000000}.0`)
  const [soundEffects, setSoundEffects] = useState(true)
  const [clickSoundEnabled, setClickSoundEnabled] = useState(true)
  const [backgroundMusic, setBackgroundMusic] = useState(true)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [historySubTab, setHistorySubTab] = useState<'betHistory' | 'biggestWins'>('betHistory')
  const [canStopSpin, setCanStopSpin] = useState(false)
  const pendingFinalReelsRef = useRef<number[][] | null>(null)
  const stopSpinRequestedRef = useRef(false)
  
  // Autoplay state
  const [showAutoplayModal, setShowAutoplayModal] = useState(false)
  const [autoplaySpins, setAutoplaySpins] = useState<number | 'infinite'>(10)
  const [autoplayWinLimit, setAutoplayWinLimit] = useState('')
  const [autoplayLoseLimit, setAutoplayLoseLimit] = useState('')
  const [stopOnBigWin, setStopOnBigWin] = useState(false)
  const [autoplayActive, setAutoplayActive] = useState(false)
  const [autoplayRemaining, setAutoplayRemaining] = useState(0)
  const autoplayRef = useRef<NodeJS.Timeout | null>(null)
  const [spinHistory, setSpinHistory] = useState<Array<{
    id: string
    game: string
    date: string
    time: string
    bet: number
    win: number
    reels: number[][]
    multiplier: number
  }>>([])
  
  // Toggle fullscreen function
  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullScreen(true)
    } else {
      document.exitFullscreen()
      setIsFullScreen(false)
    }
  }
  const [isSpinning, setIsSpinning] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [reels, setReels] = useState<number[][]>([
    [7, 5, 3],
    [8, 0, 2],
    [1, 6, 4],
  ])
  const [activeMultiplier, setActiveMultiplier] = useState(4)
  const [animatingMultiplier, setAnimatingMultiplier] = useState(-1)
  const [lastWin, setLastWin] = useState(0)
  const [winningCells, setWinningCells] = useState<Set<string>>(new Set())
  const [winningRows, setWinningRows] = useState<Set<number>>(new Set())
  const [winningPaylines, setWinningPaylines] = useState<Set<number>>(new Set())
  const [showBigWin, setShowBigWin] = useState(false)
  const [currentTime, setCurrentTime] = useState("12:28:24")
  const [isButtonPressed, setIsButtonPressed] = useState(false)
  const [showInfinityAnimation, setShowInfinityAnimation] = useState(false)
  const [spinningReels, setSpinningReels] = useState<boolean[]>([false, false, false])
  const [reelJustStopped, setReelJustStopped] = useState<boolean[]>([false, false, false])
  const [isMultiplierSpinning, setIsMultiplierSpinning] = useState(false)
  // Gamble feature state
  const [showGamblePopup, setShowGamblePopup] = useState(false)
  const [gambleWinAmount, setGambleWinAmount] = useState(0)
  const [gambleToWin, setGambleToWin] = useState(0)
  const [isGambling, setIsGambling] = useState(false)
  const [gambleCardColor, setGambleCardColor] = useState<'red' | 'green'>('green')
  const [gambleResult, setGambleResult] = useState<'win' | 'lose' | null>(null)
  // Audio state
  const [bgMusicEnabled, setBgMusicEnabled] = useState(true)
  const bgMusicRef = useRef<HTMLAudioElement>(null)
  const clickSoundRef = useRef<HTMLAudioElement>(null)
  const winSoundRef = useRef<HTMLAudioElement>(null)
  const [revealedCard, setRevealedCard] = useState<string | null>(null)
  const [isCardFlashing, setIsCardFlashing] = useState(true)
  const [previousCards, setPreviousCards] = useState<string[]>([])
  const spinIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const multiplierAnimRef = useRef<NodeJS.Timeout | null>(null)
  const reelIntervalsRef = useRef<(NodeJS.Timeout | null)[]>([null, null, null])
  const cardFlashRef = useRef<NodeJS.Timeout | null>(null)
  // Auto-hide timeout for winning line + firebox glow after a spin result is shown
  const winDisplayTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Server-authoritative outcome for the in-flight spin, so the manual-stop
  // path credits/animates the exact same values as the auto-resolve path.
  const pendingServerPayoutRef = useRef<number>(0)
  const pendingServerBalanceRef = useRef<number | null>(null)

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(now.toLocaleTimeString('en-US', { hour12: false }))
    }
    updateTime()
    const interval = setInterval(updateTime, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 2000)
    return () => clearTimeout(timer)
  }, [])

  // Cosmetic-only spinner blur. We never use this for outcomes — those
  // come from POST /api/games/slots/spin. The blur cycles through symbol
  // indices using `Date.now()` so we don't depend on Math.random() for any
  // game-relevant value (Section 17 spec).
  const cosmeticIndex = () =>
    Math.floor((typeof performance !== "undefined" ? performance.now() : Date.now())) %
    SYMBOLS.length
  const generateReel = () => [cosmeticIndex(), cosmeticIndex(), cosmeticIndex()]

  /**
   * Translate a backend symbol id into the local SYMBOLS array index.
   * The backend uses the same `id` strings (cherry, orange, seven, …).
   * Falls back to 0 (the highest-value symbol) when an unknown id arrives
   * so the UI never crashes.
   */
  const serverSymbolToIndex = (sym: string): number => {
    const idx = SYMBOLS.findIndex(
      (s) => s.id.toLowerCase() === sym.toLowerCase(),
    )
    return idx >= 0 ? idx : 0
  }

  /**
   * Convert the backend `reels` payload — a full 3×3 grid, reel-major
   * (`reels[reel][row]`) of symbol id strings — into the 3×3 matrix of
   * SYMBOLS indices the UI renders. The grid is built server-side so that the
   * winning symbol lands on a real payline; the client highlights whichever
   * line(s) actually match, and the amount comes from `total_payout`.
   */
  const serverReelsToMatrix = (reels: SlotsSpinResponse["reels"]): number[][] => {
    return [0, 1, 2].map((col) => {
      const reel = reels[col] ?? []
      return [0, 1, 2].map((row) =>
        serverSymbolToIndex(reel[row] ?? reel[0] ?? "plum"),
      )
    })
  }

  // Play click sound - gated by clickSoundEnabled toggle
  const playClickSound = useCallback(() => {
    if (!clickSoundEnabled) return
    if (clickSoundRef.current) {
      clickSoundRef.current.currentTime = 0
      clickSoundRef.current.play().catch(() => {
        // Ignore autoplay errors
      })
    }
  }, [clickSoundEnabled])

  // Play win sound - gated by soundEffects toggle
  const playWinSound = useCallback(() => {
    if (!soundEffects) return
    if (winSoundRef.current) {
      winSoundRef.current.currentTime = 0
      winSoundRef.current.play().catch(() => {
        // Ignore autoplay errors
      })
    }
  }, [soundEffects])

  const checkWins = useCallback((finalReels: number[][]) => {
    let totalWinAmount = 0
    const winCells = new Set<string>()
    const winRows = new Set<number>()
    const winPaylines = new Set<number>()

    PAYLINES.forEach((payline, paylineIndex) => {
      const lineSymbols = payline.map((row, col) => finalReels[col][row])
      let matchCount = 1
      const firstSymbol = lineSymbols[0]
      
      for (let i = 1; i < 3; i++) {
        if (lineSymbols[i] === firstSymbol) matchCount++
        else break
      }

      if (matchCount >= 3) {
        const symbol = SYMBOLS[firstSymbol]
        const multiplier = MULTIPLIERS[activeMultiplier].value
        const lineWin = symbol.value * matchCount * multiplier * betPerLine
        totalWinAmount += lineWin

        // Track the winning payline index
        winPaylines.add(paylineIndex)

        // Track the winning row (all paylines in this game are horizontal, so payline[0] is the row)
        winRows.add(payline[0])

        for (let i = 0; i < matchCount; i++) {
          winCells.add(`${i}-${payline[i]}`)
        }
      }
    })

    return { winAmount: totalWinAmount, winCells, winRows, winPaylines }
  }, [activeMultiplier, betPerLine])

  /**
   * Apply the winning visual effects for a resolved spin. `winAmount` is the
   * server-authoritative payout — the single source of truth for whether the
   * player won. The cell/payline highlight is derived from the reels, but if
   * (defensively) the matcher finds nothing on a paid spin we light the whole
   * grid so the winning effect ALWAYS shows when the player wins.
   */
  const showWinEffects = useCallback((winAmount: number, finalReels: number[][]) => {
    if (winDisplayTimeoutRef.current) {
      clearTimeout(winDisplayTimeoutRef.current)
      winDisplayTimeoutRef.current = null
    }

    if (winAmount > 0) {
      playWinSound()
      setLastWin(winAmount)

      let { winCells, winRows, winPaylines } = checkWins(finalReels)
      if (winCells.size === 0) {
        winCells = new Set<string>()
        for (let col = 0; col < 3; col++) {
          for (let row = 0; row < 3; row++) winCells.add(`${col}-${row}`)
        }
        winRows = new Set<number>([0, 1, 2])
        winPaylines = new Set<number>([0, 1, 2, 3, 4])
      }
      setWinningCells(winCells)
      setWinningRows(winRows)
      setWinningPaylines(winPaylines)

      // Auto-hide winning line + firebox glow after a brief display
      winDisplayTimeoutRef.current = setTimeout(() => {
        setWinningCells(new Set())
        setWinningRows(new Set())
        setWinningPaylines(new Set())
        winDisplayTimeoutRef.current = null
      }, 2500)

      // Big-win celebration overlay for sizeable wins
      if (winAmount >= betAmount * 20) {
        setShowBigWin(true)
        setTimeout(() => setShowBigWin(false), 3000)
      }
    } else {
      setWinningCells(new Set())
      setWinningRows(new Set())
      setWinningPaylines(new Set())
    }
  }, [betAmount, checkWins, playWinSound])

  const animateMultiplierSelection = useCallback((targetIndex?: number) => {
    return new Promise<number>((resolve) => {
      let count = 0
      const maxCycles = 10 + Math.floor(Math.random() * 3) // 10-12 cycles for ~800-960ms total
      // Land on the server-chosen multiplier when provided so the displayed
      // multiplier reel matches the payout; otherwise pick one locally.
      const finalIndex =
        typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex < 5
          ? targetIndex
          : Math.floor(Math.random() * 5)
      
      multiplierAnimRef.current = setInterval(() => {
        setAnimatingMultiplier(count % 5)
        count++
        
        if (count >= maxCycles) {
          if (multiplierAnimRef.current) clearInterval(multiplierAnimRef.current)
          setAnimatingMultiplier(finalIndex)
          setActiveMultiplier(finalIndex)
          setTimeout(() => {
            setAnimatingMultiplier(-1)
            resolve(finalIndex)
          }, 100) // Reduced from 300ms to 100ms
        }
      }, 80)
    })
  }, [])

  const spin = useCallback(async () => {
    if (isSpinning) return
    if (balance < betAmount) {
      notifyBalance("Insufficient balance — please deposit")
      return
    }

    // Button press animation
    setIsButtonPressed(true)
    setTimeout(() => setIsButtonPressed(false), 200)

    // Play click sound
    playClickSound()

    // Show infinity animation for 600ms at start of spin (visible looping motion)
    setShowInfinityAnimation(true)
    setTimeout(() => setShowInfinityAnimation(false), 600)

    // ============================================================
    // Section 17 — Spin outcome comes from the backend.
    // We POST /api/games/slots/spin with the chosen bet_per_line/lines and
    // use the server-returned `reels`, `total_payout` and `balance_after`
    // as the source of truth. The animation below is purely cosmetic.
    // ============================================================
    setIsSpinning(true)
    setLastWin(0)

    let spinResult: SlotsSpinResponse | null = null
    try {
      // 5 paylines × bet_per_line = total stake; the backend computes the
      // payout including the per-tenant RTP override.
      spinResult = await spinSlots({
        game_id: "multi-hot-5",
        bet_per_line: betPerLine,
        lines: PAYLINES.length,
      })
      setBalance(spinResult.balance_after)
    } catch (err) {
      console.error("Slots spin failed", err)
      const msg = err instanceof Error ? err.message : ""
      notifyBalance(/insufficient/i.test(msg) ? "Insufficient balance — please deposit" : "Spin failed")
      setIsSpinning(false)
      return
    }
    // Cancel any pending auto-hide from previous win so it can't clear state mid-spin
    if (winDisplayTimeoutRef.current) {
      clearTimeout(winDisplayTimeoutRef.current)
      winDisplayTimeoutRef.current = null
    }
    setWinningCells(new Set())
    setWinningRows(new Set())
    setWinningPaylines(new Set())
    setShowBigWin(false)

    // Start multiplier spinning FIRST (raindrop effect - top to bottom)
    setIsMultiplierSpinning(true)

    // Cascade start spinning for each reel with slight delays (raindrop effect from left to right)
    // Multiplier starts at 0ms, then reels follow: 80ms, 160ms, 240ms
    const reelStartDelays = [80, 160, 240] // milliseconds delay for each reel column
    reelStartDelays.forEach((delay, index) => {
      setTimeout(() => {
        setSpinningReels(prev => {
          const newState = [...prev]
          newState[index] = true
          return newState
        })
      }, delay)
    })

    // Multiplier animation runs concurrently, landing on the server multiplier
    const serverMultiplierIndex = (spinResult.multiplier ?? 1) - 1
    setTimeout(async () => {
      await animateMultiplierSelection(serverMultiplierIndex)
      setIsMultiplierSpinning(false)
    }, 50)

    // Individual reel spinning with cascading stop effect (like video - first column stops first)
    const reelStopDelays = [900, 1100, 1300] // Stop delays for each reel - cascade from left to right
    // Use the server-returned reels as the final outcome. The visual blur
    // before this point is cosmetic; the matrix below is what the player
    // and operator both agree on.
    const finalReels = serverReelsToMatrix(spinResult.reels)
    const serverPayout = spinResult.total_payout
    const serverBalanceAfter = spinResult.balance_after
    
    // Store final reels + server outcome for potential early stop, and enable
    // the stop button after a brief delay.
    pendingFinalReelsRef.current = finalReels
    pendingServerPayoutRef.current = serverPayout
    pendingServerBalanceRef.current = serverBalanceAfter
    stopSpinRequestedRef.current = false
    setTimeout(() => {
      setCanStopSpin(true)
    }, 400) // Allow stopping after initial animation
    
    // Start spinning each reel with its own interval for rapid symbol changes
    for (let reelIndex = 0; reelIndex < 3; reelIndex++) {
      // Delayed start for each reel
      setTimeout(() => {
        reelIntervalsRef.current[reelIndex] = setInterval(() => {
          setReels(prev => {
            const newReels = [...prev]
            newReels[reelIndex] = generateReel()
            return newReels
          })
        }, 80) // Slower symbol cycling (80ms) - visible while spinning
      }, reelStartDelays[reelIndex])

      // Stop each reel after its delay with bounce effect
      setTimeout(() => {
        if (reelIntervalsRef.current[reelIndex]) {
          clearInterval(reelIntervalsRef.current[reelIndex]!)
          reelIntervalsRef.current[reelIndex] = null
        }
        
        // Set final reel result
        setReels(prev => {
          const newReels = [...prev]
          newReels[reelIndex] = finalReels[reelIndex]
          return newReels
        })
        
        // Stop spinning state for this reel and trigger bounce animation
        setSpinningReels(prev => {
          const newState = [...prev]
          newState[reelIndex] = false
          return newState
        })
        
        // Trigger bounce animation
        setReelJustStopped(prev => {
          const newState = [...prev]
          newState[reelIndex] = true
          return newState
        })
        
        // Clear bounce state after animation completes
        setTimeout(() => {
          setReelJustStopped(prev => {
            const newState = [...prev]
            newState[reelIndex] = false
            return newState
          })
        }, 200)

        // Check if all reels have stopped (after last reel)
        if (reelIndex === 2) {
          setTimeout(() => {
            // Skip if stop was already triggered manually
            if (stopSpinRequestedRef.current) return
            
            // The server is the source of truth for whether we won and how
            // much. Sync the balance with the server value and fire the
            // winning effects from the same authoritative payout.
            const winAmount = serverPayout
            setBalance(serverBalanceAfter)
            showWinEffects(winAmount, finalReels)
            
            // Add to spin history
            const now = new Date()
            const historyEntry = {
              id: `#${Math.floor(Math.random() * 9000000000) + 1000000000}.0`,
              game: 'MULTI HOT 5',
              date: now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'),
              time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              bet: betAmount,
              win: winAmount,
              reels: finalReels,
              multiplier: activeMultiplier
            }
            setSpinHistory(prev => [historyEntry, ...prev].slice(0, 50)) // Keep last 50 spins
            
            setIsSpinning(false)
            setCanStopSpin(false)
            pendingFinalReelsRef.current = null
          }, 150)
        }
      }, reelStopDelays[reelIndex])
    }
  }, [isSpinning, balance, betAmount, animateMultiplierSelection, notifyBalance, showWinEffects])

  // Start autoplay function
  const startAutoplay = useCallback(() => {
    if (autoplaySpins === 'infinite') {
      setAutoplayRemaining(-1) // -1 indicates infinite
    } else {
      setAutoplayRemaining(autoplaySpins)
    }
    setAutoplayActive(true)
    setShowAutoplayModal(false)
  }, [autoplaySpins])

  // Stop autoplay function
  const stopAutoplay = useCallback(() => {
    setAutoplayActive(false)
    setAutoplayRemaining(0)
    if (autoplayRef.current) {
      clearTimeout(autoplayRef.current)
      autoplayRef.current = null
    }
  }, [])

  // Stop spin function - stops all reels immediately when user clicks
  const stopSpin = useCallback(() => {
    if (!isSpinning || !canStopSpin || stopSpinRequestedRef.current) return
    
    stopSpinRequestedRef.current = true
    setCanStopSpin(false)
    
    // Stop all reel intervals immediately
    reelIntervalsRef.current.forEach((interval, idx) => {
      if (interval) {
        clearInterval(interval)
        reelIntervalsRef.current[idx] = null
      }
    })
    
    // Get the final reels
    const finalReels = pendingFinalReelsRef.current || [generateReel(), generateReel(), generateReel()]
    
    // Set all reels to final positions immediately
    setReels(finalReels)
    setSpinningReels([false, false, false])
    
    // Trigger bounce animation for all reels
    setReelJustStopped([true, true, true])
    setTimeout(() => {
      setReelJustStopped([false, false, false])
    }, 200)
    
    // Check wins — use the server-authoritative payout/balance captured for
    // this spin (the balance was already set to the server value at spin
    // start, so we re-sync rather than add, avoiding any double-credit).
    setTimeout(() => {
      const winAmount = pendingServerPayoutRef.current
      if (pendingServerBalanceRef.current !== null) {
        setBalance(pendingServerBalanceRef.current)
      }
      showWinEffects(winAmount, finalReels)
      
      // Add to spin history
      const now = new Date()
      const historyEntry = {
        id: `#${Math.floor(Math.random() * 9000000000) + 1000000000}.0`,
        game: 'MULTI HOT 5',
        date: now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'),
        time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        bet: betAmount,
        win: winAmount,
        reels: finalReels,
        multiplier: activeMultiplier
      }
      setSpinHistory(prev => [historyEntry, ...prev].slice(0, 50))
      
      setIsSpinning(false)
      stopSpinRequestedRef.current = false
      pendingFinalReelsRef.current = null
    }, 150)
  }, [isSpinning, canStopSpin, betAmount, activeMultiplier, showWinEffects])

  useEffect(() => {
    return () => {
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current)
      if (multiplierAnimRef.current) clearInterval(multiplierAnimRef.current)
      reelIntervalsRef.current.forEach(interval => {
        if (interval) clearInterval(interval)
      })
    }
  }, [])

  // Background music effect - plays on mount and when enabled/disabled
  useEffect(() => {
    const audio = bgMusicRef.current
    if (!audio) return

    const playAudio = async () => {
      try {
        if (bgMusicEnabled) {
          audio.volume = 0.5
          // Attempt to play, catch errors from browser autoplay policy
          await audio.play()
        } else {
          audio.pause()
        }
      } catch (error) {
        // Autoplay may be blocked by browser policy - user can enable in settings
      }
    }

    playAudio()
  }, [bgMusicEnabled])

  // Autoplay effect - triggers next spin when current spin finishes
  useEffect(() => {
    if (autoplayActive && !isSpinning && autoplayRemaining !== 0) {
      // Check stop conditions
      const winLimit = parseFloat(autoplayWinLimit) || 0
      const loseLimit = parseFloat(autoplayLoseLimit) || 0
      
      if (winLimit > 0 && lastWin >= winLimit) {
        stopAutoplay()
        return
      }
      
      if (stopOnBigWin && lastWin >= betAmount * 20) {
        stopAutoplay()
        return
      }
      
      // Check if we have enough balance
      if (balance < betAmount) {
        notifyBalance("Insufficient balance — please deposit")
        stopAutoplay()
        return
      }
      
      // Trigger next spin after a short delay
      autoplayRef.current = setTimeout(() => {
        if (autoplayRemaining > 0) {
          setAutoplayRemaining(prev => prev - 1)
        }
        // The spin will be triggered by the spin button effect
        const spinBtn = document.querySelector('[data-spin-btn]') as HTMLButtonElement
        if (spinBtn) spinBtn.click()
      }, 1500)
    }
    
    return () => {
      if (autoplayRef.current) clearTimeout(autoplayRef.current)
    }
  }, [autoplayActive, isSpinning, autoplayRemaining, lastWin, autoplayWinLimit, autoplayLoseLimit, stopOnBigWin, balance, betAmount, stopAutoplay, notifyBalance])

  // Bet amounts array for scrolling (min 0.05, max 400 total bet = 80 per line)
  const betSteps = [0.01, 0.02, 0.03, 0.04, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.75, 1.00, 1.50, 2.00, 3.00, 4.00, 5.00, 7.50, 10.00, 15.00, 20.00, 30.00, 40.00, 50.00, 60.00, 80.00]
  
  const adjustBet = (delta: number) => {
    const currentIndex = betSteps.findIndex(b => b === betPerLine)
    let newIndex = currentIndex
    
    if (delta > 0 && currentIndex < betSteps.length - 1) {
      newIndex = currentIndex + 1
    } else if (delta < 0 && currentIndex > 0) {
      newIndex = currentIndex - 1
    }
    
    const newBet = betSteps[newIndex]
    setBetPerLine(newBet)
    setBetAmount(Number((newBet * 5).toFixed(2)))
    
    // Show scroll effect - stays visible after clicking
    setShowBetScroll(true)
  }
  
  // Get adjacent bet values for display
  const getAdjacentBets = () => {
    const currentIndex = betSteps.findIndex(b => b === betPerLine)
    const higher = currentIndex < betSteps.length - 1 ? betSteps[currentIndex + 1] : null
    const lower = currentIndex > 0 ? betSteps[currentIndex - 1] : null
    return { higher, lower }
  }

  // Gamble feature functions
  const openGamble = () => {
    // For testing - always allow opening, use lastWin or default to 0.40
    const winToGamble = lastWin > 0 ? lastWin : 0.40
    setGambleWinAmount(winToGamble)
    setGambleToWin(winToGamble * 2)
    if (lastWin > 0) {
      setBalance(prev => prev - lastWin) // Remove win from balance temporarily
    }
    setShowGamblePopup(true)
    setGambleResult(null)
    setRevealedCard(null)
    setIsCardFlashing(true)
    setPreviousCards([]) // Reset previous cards
    // Start card flashing animation
    startCardFlashing()
  }

  const closeGamble = () => {
    stopCardFlashing()
    if (gambleWinAmount > 0 && lastWin > 0) {
      setBalance(prev => prev + gambleWinAmount)
    }
    setShowGamblePopup(false)
    setGambleWinAmount(0)
    setGambleToWin(0)
    setPreviousCards([])
    setIsGambling(false)
  }

  const startCardFlashing = () => {
    if (cardFlashRef.current) clearInterval(cardFlashRef.current)
    cardFlashRef.current = setInterval(() => {
      setGambleCardColor(prev => prev === 'red' ? 'green' : 'red')
    }, 500)
  }

  const stopCardFlashing = () => {
    if (cardFlashRef.current) {
      clearInterval(cardFlashRef.current)
      cardFlashRef.current = null
    }
    setIsCardFlashing(false)
  }

  const gamble = (chosenColor: 'red' | 'black') => {
    if (isGambling) return
    setIsGambling(true)
    stopCardFlashing()
    
    // Determine the actual card (random)
    const redCards = [
      { img: GAMBLE_ASSETS.aceHearts, color: 'red' },
      { img: GAMBLE_ASSETS.aceDiamonds, color: 'red' },
    ]
    const blackCards = [
      { img: GAMBLE_ASSETS.aceClubs, color: 'black' },
      { img: GAMBLE_ASSETS.aceSpades, color: 'black' },
    ]
    
    const allCards = [...redCards, ...blackCards]
    const randomCard = allCards[Math.floor(Math.random() * allCards.length)]
    
    // Show card reveal animation
    setTimeout(() => {
      setRevealedCard(randomCard.img)
      // Add to previous cards
      setPreviousCards(prev => [...prev.slice(-3), randomCard.img])
      
      // Check if player won
      const playerWon = chosenColor === randomCard.color
      
      setTimeout(() => {
        if (playerWon) {
          // Double the winnings
          const newWin = gambleWinAmount * 2
          setGambleWinAmount(newWin)
          setGambleToWin(newWin * 2)
          setGambleResult('win')
          setIsGambling(false)
          // Start flashing again for another round
          setTimeout(() => {
            setRevealedCard(null)
            setGambleResult(null)
            setIsCardFlashing(true)
            startCardFlashing()
          }, 1500)
        } else {
          // Player lost
          setGambleResult('lose')
          setGambleWinAmount(0)
          setGambleToWin(0)
          setTimeout(() => {
            setShowGamblePopup(false)
            setLastWin(0)
            setPreviousCards([])
            setIsGambling(false)
          }, 1500)
        }
      }, 500)
    }, 500)
  }

  const takeWin = () => {
    stopCardFlashing()
    setBalance(prev => prev + gambleWinAmount)
    setLastWin(gambleWinAmount)
    setShowGamblePopup(false)
    setGambleWinAmount(0)
    setGambleToWin(0)
    setPreviousCards([])
    setIsGambling(false)
  }

  // Cleanup gamble interval on unmount
  useEffect(() => {
    return () => {
      if (cardFlashRef.current) clearInterval(cardFlashRef.current)
    }
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <img src={ASSETS.loader} alt="Loading" className="w-64 h-auto" />
      </div>
    )
  }

  return (
    <>
    {balanceToast}
    <div className="game-scale-wrapper">
    <div 
      className="game-scale-inner min-h-screen flex flex-col relative overflow-hidden select-none"
      style={{ 
        backgroundImage: `url(${ASSETS.background})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Fire glow animation keyframes */}
      <style>{`
        @keyframes fireGlow {
          0% {
            filter: drop-shadow(0 0 8px rgba(255, 150, 0, 0.9)) drop-shadow(0 0 15px rgba(255, 100, 0, 0.7));
            opacity: 0.95;
          }
          100% {
            filter: drop-shadow(0 0 12px rgba(255, 180, 0, 1)) drop-shadow(0 0 25px rgba(255, 120, 0, 0.9));
            opacity: 1;
          }
        }
      `}</style>

      {/* Audio Elements */}
      <audio 
        ref={bgMusicRef} 
        src={ASSETS.bgMusic}
        loop
        autoPlay
        preload="auto"
      />
      <audio 
        ref={clickSoundRef} 
        src={ASSETS.clickSound}
        preload="auto"
      />
      <audio 
        ref={winSoundRef} 
        src={ASSETS.winSound}
        preload="auto"
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 py-2 bg-black/80">
        <div className="flex items-center gap-3">
          {/* Back to Lobby Button */}
          <button
            type="button"
            onClick={() => goBackToParent()}
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#2a3a4a] hover:bg-[#3a4a5a] border border-[#4a5a6a] transition-colors"
            title="Back to Lobby"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button type="button" onClick={() => goBackToParent()} className="flex items-center gap-2">
            <img src={ASSETS.smartsoftLogo} alt="SmartSoft Gaming" className="h-5" />
          </button>
        </div>
        
        <div className="flex items-center gap-4">
          <span className="text-white/80 text-sm font-mono">{currentTime}</span>
          <button 
            onClick={() => setShowMenuPopup(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-[#4a4a4a] hover:bg-[#5a5a5a]"
          >
            <img src={ASSETS.menuIcon} alt="Menu" className="w-6 h-6" />
          </button>
        </div>
      </header>

      {/* Logo */}
      <div className="relative z-10 flex justify-center items-center mt-3 mb-2">
        <div 
          style={{ 
            width: '380px',
            height: '60px',
            backgroundImage: `url(${ASSETS.logo})`,
            backgroundPosition: '0 0',
            backgroundSize: '300% 600%',
            backgroundRepeat: 'no-repeat',
            filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))',
          }}
        />
      </div>

      {/* Main Game Area */}
      <div className="relative z-10 flex-1">
        {/* Left Hexagon Buttons - Absolute positioned */}
        <div className="absolute flex flex-col items-center gap-6" style={{ left: '110px', top: '60px' }}>
          <button 
            className={`relative w-[100px] h-[115px] cursor-pointer group transition-all duration-200 ${autoplayActive ? 'animate-pulse' : ''}`}
            onClick={() => autoplayActive ? stopAutoplay() : setShowAutoplayModal(true)}
          >
            <svg viewBox="0 0 100 115" className="w-full h-full transition-all duration-300 group-hover:drop-shadow-[0_0_20px_rgba(0,255,100,0.8)]">
              <polygon points="50,2 98,27 98,88 50,113 2,88 2,27" fill="#1a4d3a" stroke={autoplayActive ? "#22c55e" : "#4a7a5a"} strokeWidth="2"/>
              <polygon points="50,10 90,32 90,83 50,105 10,83 10,32" fill="#1a4d3a" stroke={autoplayActive ? "#22c55e" : "#3a6a4a"} strokeWidth="1"/>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-12 h-12 transition-all duration-300 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke={autoplayActive ? "#22c55e" : "#5a9a6a"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </div>
            {/* Show remaining spins count when autoplay active */}
            {autoplayActive && autoplayRemaining > 0 && (
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-[#22c55e] text-black text-xs font-bold px-2 py-0.5 rounded">
                {autoplayRemaining}
              </div>
            )}
            {autoplayActive && autoplayRemaining === -1 && (
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-[#22c55e] text-black text-xs font-bold px-2 py-0.5 rounded">
                INF
              </div>
            )}
          </button>

          <button 
            className={`relative w-[100px] h-[115px] transition-all duration-200 group ${
              lastWin > 0 && !isSpinning 
                ? 'cursor-pointer animate-pulse-glow' 
                : 'cursor-default'
            }`}
            onClick={() => {
              if (lastWin > 0 && !isSpinning) {
                openGamble()
              }
            }}
          >
            <svg viewBox="0 0 100 115" className={`w-full h-full transition-all duration-300 ${lastWin > 0 && !isSpinning ? 'group-hover:drop-shadow-[0_0_20px_rgba(0,255,100,0.8)]' : ''}`}>
              <polygon points="50,2 98,27 98,88 50,113 2,88 2,27" fill="#1a4d3a" stroke="#4a7a5a" strokeWidth="2"/>
              <polygon points="50,10 90,32 90,83 50,105 10,83 10,32" fill="#1a4d3a" stroke="#3a6a4a" strokeWidth="1"/>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-3xl font-bold transition-all duration-300 ${lastWin > 0 && !isSpinning ? 'group-hover:text-[#7fff7f]' : ''}`} style={{ color: '#5a9a6a' }}>2x</span>
            </div>
          </button>

          <button className="relative w-[100px] h-[115px]">
            <svg viewBox="0 0 100 115" className="w-full h-full">
              <polygon points="50,6 94,29 94,86 50,109 6,86 6,29" fill="none" stroke="#7a6a45" strokeWidth="2"/>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="#7a6a45" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
          </button>
        </div>

        {/* Multiplier Panel - Absolute positioned */}
        <div className="absolute" style={{ left: '295px', top: '48px' }}>
          <div className="absolute -top-6 left-1/2 -translate-x-1/2">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#c9a227' }}>MULTIPLIER</span>
          </div>

          <div className="rounded-lg" style={{ background: 'linear-gradient(180deg, #d4af37 0%, #8b7340 30%, #6b5530 50%, #8b7340 70%, #d4af37 100%)', height: '396px', width: '130px', padding: '3px' }}>
            <div className="rounded-md h-full flex flex-col justify-center overflow-visible" style={{ backgroundColor: '#0d1a12' }}>
              <div className="flex flex-col items-center justify-between h-full overflow-visible" style={{ padding: '10px 0' }}>
                {(() => {
                  const prevIdx = (activeMultiplier - 1 + 5) % 5
                  const nextIdx = (activeMultiplier + 1) % 5
                  const visibleMultipliers = [
                    { idx: prevIdx, pos: 'top' },
                    { idx: activeMultiplier, pos: 'middle' },
                    { idx: nextIdx, pos: 'bottom' },
                  ]
                  
                  return visibleMultipliers.map(({ idx, pos }) => {
                    const mult = MULTIPLIERS[idx]
                    const isCenter = pos === 'middle' // Frame ONLY shows in center position
                    const isAnimating = animatingMultiplier === idx
                    
                    return (
                      <div key={pos} className="relative flex items-center justify-center" style={{ width: '145px', height: isCenter ? '140px' : '105px', marginLeft: '-3px', overflow: 'hidden' }}>
                        {/* Pink frame ONLY for CENTER position - ALWAYS STATIC, never moves */}
                        {isCenter && (
                          <div className="absolute inset-0" style={{ zIndex: 10 }}>
                            {/* Pink/Red frame - STATIC in center, will never move */}
                            <img 
                              src={MULTIPLIER_IMAGES.frame}
                              alt="Active frame"
                              style={{ 
                                position: 'absolute',
                                width: '145px',
                                height: '140px',
                                objectFit: 'fill',
                                filter: 'drop-shadow(0 0 12px rgba(196, 24, 84, 0.8))',
                                left: '0',
                                top: '0',
                              }}
                            />
                            {/* Green gradient image INSIDE the frame - STATIC */}
                            <img 
                              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/cop-n1CRiiUAiup45rBhYoyAw8ZcudNSij.png"
                              alt="Green background"
                              style={{ 
                                position: 'absolute',
                                width: '131px',
                                height: '139px',
                                objectFit: 'fill',
                                left: '5px',
                                top: '-4px',
                                borderRadius: '6px',
                              }}
                            />
                          </div>
                        )}
                        
                        {/* Multiplier 'x' number - ONLY THIS ELEMENT HAS ANIMATION (same style as reels) */}
                        <div 
                          className={isMultiplierSpinning ? 'animate-spin-vertical' : ''}
                          style={{ 
                            position: 'relative',
                            zIndex: 20,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <img 
                            src={mult.image}
                            alt={`${mult.value}x`}
                            className="object-contain"
                            style={{ 
                              width: isCenter ? '85px' : '65px', 
                              height: isCenter ? '85px' : '65px',
                              opacity: isCenter || isAnimating ? 1 : 0.5,
                              filter: isMultiplierSpinning ? 'blur(3px)' : 'none',
                            }}
                          />
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Reels Frame - Absolute positioned */}
        <div className="absolute" style={{ left: '450px', top: '48px' }}>
          <div className="absolute -top-6 right-4 flex items-center gap-1">
            <span className="text-lg font-bold" style={{ color: '#ff1493', textShadow: '0 0 8px #ff1493' }}>5</span>
            <span className="text-xs font-bold uppercase" style={{ color: '#ffd700' }}>LINES FIXED</span>
          </div>

          <div className="rounded-lg p-[3px]" style={{ background: 'linear-gradient(180deg, #d4af37 0%, #8b7340 30%, #6b5530 50%, #8b7340 70%, #d4af37 100%)' }}>
            <div className="rounded-md p-3 relative" style={{ backgroundColor: '#0d1a12', overflow: 'visible' }}>
              <div className="flex relative">
                {/* Green separator lines between columns - ALWAYS visible */}
                <div className="absolute z-20 pointer-events-none" style={{ left: '200px', top: 0, bottom: 0, width: '3px', background: 'linear-gradient(180deg, #22c55e 0%, #166534 50%, #22c55e 100%)', boxShadow: '0 0 8px rgba(34, 197, 94, 0.6)' }}/>
                <div className="absolute z-20 pointer-events-none" style={{ left: '406px', top: 0, bottom: 0, width: '3px', background: 'linear-gradient(180deg, #22c55e 0%, #166534 50%, #22c55e 100%)', boxShadow: '0 0 8px rgba(34, 197, 94, 0.6)' }}/>
                
{/* Winning payline displays - Overlay lines on winning paths.
                    Horizontal paylines (0, 1, 2) use pre-rendered image assets.
                    Diagonal paylines (3, 4) are drawn with inline SVG through the
                    actual cell centers so the line direction ALWAYS matches the
                    winning cells regardless of source image orientation. */}
                {!isSpinning && Array.from(winningPaylines).map((paylineIdx) => {
                  const payline = PAYLINES[paylineIdx]

                  // Horizontal paylines — keep existing image-based rendering
                  if (paylineIdx === 0 || paylineIdx === 1 || paylineIdx === 2) {
                    const lineAssetMap: Record<number, string> = {
                      0: ASSETS.lineOne,   // [1,1,1] - middle horizontal
                      1: ASSETS.lineTwo,   // [0,0,0] - top horizontal
                      2: ASSETS.lineTwo,   // [2,2,2] - bottom horizontal
                    }
                    const lineAsset = lineAssetMap[paylineIdx]

                    let lineStyle: React.CSSProperties = {
                      position: 'absolute',
                      pointerEvents: 'none',
                      zIndex: 35,
                    }
                    if (paylineIdx === 0) {
                      lineStyle = { ...lineStyle, top: '138px', left: '12px', width: '582px', height: '102px' }
                    } else if (paylineIdx === 1) {
                      lineStyle = { ...lineStyle, top: '24px', left: '12px', width: '582px', height: '102px' }
                    } else if (paylineIdx === 2) {
                      lineStyle = { ...lineStyle, top: '264px', left: '12px', width: '582px', height: '102px' }
                    }

                    return (
                      <div
                        key={`line-${paylineIdx}`}
                        className="absolute pointer-events-none overflow-hidden"
                        style={lineStyle}
                      >
                        <img
                          src={lineAsset}
                          alt={`Payline ${paylineIdx + 1}`}
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                      </div>
                    )
                  }

                  // Diagonal paylines — draw an SVG line through each cell center.
                  // Reel geometry: 3 reels × 200px wide with 3px gaps, cells are 126px tall,
                  // all inside a 12px-padded container. Cell center coordinates relative to
                  // the reels-frame origin:
                  //   col0 center x = 12 + 100 = 112
                  //   col1 center x = 12 + 200 + 3 + 100 = 315
                  //   col2 center x = 12 + 200 + 3 + 200 + 3 + 100 = 518
                  //   row0 center y = 12 + 63  = 75
                  //   row1 center y = 12 + 189 = 201
                  //   row2 center y = 12 + 315 = 327
                  const cx = [112, 315, 518]
                  const cy = [75, 201, 327]
                  // payline defines row for each column → build the point list
                  const points = payline.map((row, col) => `${cx[col]},${cy[row]}`).join(' ')

                  return (
                    <svg
                      key={`line-${paylineIdx}`}
                      className="absolute pointer-events-none"
                      style={{ top: 0, left: 0, width: '630px', height: '402px', zIndex: 35, overflow: 'visible' }}
                      aria-hidden="true"
                    >
                      <defs>
                        <filter id={`win-line-glow-${paylineIdx}`} x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="3" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>
                      {/* Outer soft glow */}
                      <polyline
                        points={points}
                        fill="none"
                        stroke="#fde047"
                        strokeWidth="14"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.35"
                      />
                      {/* Main bright line */}
                      <polyline
                        points={points}
                        fill="none"
                        stroke="#facc15"
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        filter={`url(#win-line-glow-${paylineIdx})`}
                      />
                    </svg>
                  )
                })}
                
                {reels.map((reel, reelIdx) => {
                  const isReelSpinning = spinningReels[reelIdx]
                  const justStopped = reelJustStopped[reelIdx]
                  return (
                    <div 
                      key={reelIdx} 
                      className={`relative ${justStopped ? 'animate-reel-stop' : ''}`} 
                      style={{ 
                        width: '200px',
                        height: '378px',
                        marginLeft: reelIdx > 0 ? '3px' : '0',
                        overflow: 'hidden',
                        backgroundColor: isReelSpinning ? '#0d1a12' : 'transparent',
                      }}
                    >
                      {/* Single continuous strip for spinning - no cell boundaries */}
                      <div 
                        className={isReelSpinning ? 'animate-spin-vertical' : ''}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          width: '100%',
                        }}
                      >
                        {reel.map((symbolIdx, rowIdx) => {
                          const isWinning = winningCells.has(`${reelIdx}-${rowIdx}`)
                          const symbol = SYMBOLS[symbolIdx]
                          
                          return (
                            <div 
                              key={rowIdx} 
                              className="relative" 
                              style={{ 
                                width: '200px', 
                                height: '126px',
                              }}
                            >
                              {/* Cell background - only when NOT spinning */}
                              {!isReelSpinning && (
                                <div 
                                  className="absolute inset-0"
                                  style={{
                                    backgroundColor: '#0a1f14',
                                  }}
                                />
                              )}
                              {/* Fire frame for winning cells - extends to touch adjacent cells */}
                              {isWinning && !isSpinning && (
                                <div 
                                  className="absolute pointer-events-none"
                                  style={{ 
                                    top: '-8px',
                                    left: '-15px',
                                    width: '230px',
                                    height: '142px',
                                    backgroundImage: `url(https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BoxWin-08-ZoWo8GXILQemCVZpZHqbSZPMf9qtPN.png)`, 
                                    backgroundPosition: 'center', 
                                    backgroundSize: '100% 100%',
                                    backgroundRepeat: 'no-repeat',
                                    zIndex: 40,
                                  }}
                                />
                              )}
                              <SlotSymbol symbolId={symbol.id} isWinning={isWinning} isSpinning={isReelSpinning} />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Info Bar - Absolute positioned */}
        <div 
          className="absolute flex items-center justify-center overflow-hidden"
          style={{ 
            left: '350px',
            right: '450px',
            top: '462px',
            height: '55px',
          }}
        >
          {/* Footer shape background image */}
          <img 
            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/f2-JI3KHV0wsTby5nweiu6WA5J8dnQKlo.png"
            alt="Footer background"
            className="absolute inset-0 w-full h-full object-fill"
            style={{ zIndex: 0 }}
          />
          
          <div className="relative z-10 flex items-center w-full h-full">
            {/* Balance Section */}
            <div className="flex-1 flex items-center justify-center gap-2 h-full border-r border-[#4a6a5a]/60">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 0 6px #22c55e)' }}>
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="#22c55e" strokeWidth="1.5" fill="none" />
                <rect x="5" y="8" width="6" height="4" rx="1" fill="#22c55e" />
              </svg>
              <div className="flex flex-col items-center">
                <p className="text-white font-bold text-sm leading-tight">{balance.toFixed(2)}</p>
                <p className="text-[9px] text-gray-500 tracking-wider">DMO</p>
              </div>
            </div>
            
            {/* Win Section (Trophy) */}
            <div className="flex-1 flex items-center justify-center gap-2 h-full border-r border-[#4a6a5a]/60">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                <path d="M8 21h8" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round"/>
                <path d="M12 17v4" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round"/>
                <path d="M7 3h10v6a5 5 0 0 1-10 0V3Z" fill="#22d3ee"/>
                <path d="M7 5H5a2 2 0 0 1 0-4h2" stroke="#22d3ee" strokeWidth="1.5"/>
                <path d="M17 5h2a2 2 0 0 0 0-4h-2" stroke="#22d3ee" strokeWidth="1.5"/>
              </svg>
              <div className="flex flex-col items-center">
                <p className="text-white font-bold text-sm leading-tight">{lastWin.toFixed(2)}</p>
                <p className="text-[9px] text-gray-500 tracking-wider">DMO</p>
              </div>
            </div>
            
            {/* Bet Section (Medal/Ribbon) */}
            <div className="flex-1 flex items-center justify-center gap-2 h-full">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="5" fill="#fbbf24"/>
                <path d="M9 12l-2 9 5-3 5 3-2-9" fill="#fbbf24"/>
              </svg>
              <div className="flex flex-col items-center">
                <p className="text-white font-bold text-sm leading-tight">{betAmount.toFixed(2)}</p>
                <p className="text-[9px] text-gray-500 tracking-wider">DMO</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Bet Controls - Using image assets for exact match */}
        <div className="absolute flex flex-col items-center" style={{ right: '150px', top: '80px' }}>
          {/* Plus Button - Top rectangle (4.png) */}
          <button 
            onClick={() => adjustBet(0.01)} 
            className="relative z-20"
            style={{ 
              width: '70px', 
              height: '55px',
              marginBottom: '-28px',
            }}
          >
            <img 
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/4-9lchwQ9RBVW7BmjDJEnxRBfB1YvGaU.png" 
              alt="Plus button"
              className="w-full h-full object-contain"
            />
          </button>

          {/* Upper connector with display (9.png - arch connector) */}
          <div className="relative z-10" style={{ width: '100px', height: '95px', marginBottom: '-30px' }}>
            <img 
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/9-hJ17A69DkjnIN6ALUe3LFjIFSglJwa.png" 
              alt="Upper connector"
              className="w-full h-full object-contain"
            />
            {/* Higher bet amount display */}
            <div className="absolute z-30 flex flex-col items-center justify-center" style={{ top: '35px', left: '50%', transform: 'translateX(-50%)' }}>
              {getAdjacentBets().higher !== null ? (
                <>
                  <p className="text-[#4ade80] font-bold text-lg leading-none" style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>{getAdjacentBets().higher!.toFixed(2)}</p>
                  <p className="text-[10px] text-white font-semibold mt-0.5" style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>DMO</p>
                </>
              ) : (
                <>
                  <p className="text-[#4ade80] font-bold text-lg leading-none opacity-50" style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>MAX</p>
                  <p className="text-[10px] text-white font-semibold mt-0.5 opacity-50" style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>DMO</p>
                </>
              )}
            </div>
          </div>

          {/* Main Spin Button - Large pentagon (1.png) with press animation */}
          <button
            data-spin-btn
            onClick={spin}
            disabled={isSpinning || balance < betAmount}
            className={`relative z-30 transition-all duration-100 ${isButtonPressed ? 'animate-button-press' : ''}`}
            style={{
              width: '150px',
              height: '130px',
              opacity: isSpinning || balance < betAmount ? 0.5 : 1,
            }}
          >
            {/* Pentagon button background - always visible */}
            <img 
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/1-72wwF2KvLDvjOdBd7Q2cfxVtU7WEie.png" 
              alt="Spin button"
              className="w-full h-full object-contain absolute inset-0"
            />
            {/* Default state: Bet amount display (when not spinning and no infinity animation) */}
            {!isSpinning && !showInfinityAnimation && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 animate-fade-in">
                <p className="text-[#fbbf24] font-bold text-2xl leading-none" style={{ textShadow: '0 0 10px rgba(251, 191, 36, 0.5)' }}>
                  {betPerLine.toFixed(2)}
                </p>
                <p className="text-[12px] text-gray-200 font-semibold tracking-wide mt-1">DMO</p>
                {/* Chevron arrow */}
                <img 
                  src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/8-VoqRxtAPrIGUhFffMh868cs9gA815k.png" 
                  alt="Chevron"
                  style={{ width: '50px', height: '30px', marginTop: '4px' }}
                  className="object-contain"
                />
              </div>
            )}
            {/* Infinity animation state: S logo formation - pieces enter and connect at center */}
            {showInfinityAnimation && (
              <div className="absolute inset-0 flex items-center justify-center z-20">
                <div className="animate-s-container" style={{ width: '50px', height: '50px', perspective: '200px' }}>
                  <div className="relative w-full h-full">
                    {/* meniu2 (top curve) - enters from LEFT */}
                    <img 
                      src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/meniu2-lbsBXc3EOL7GZiUNjnBCfnmyiGsPfC.png"
                      alt="S top"
                      className="object-contain animate-s-top"
                      style={{ 
                        width: '32px', 
                        height: '32px', 
                        position: 'absolute', 
                        top: '2px',
                        left: '9px'
                      }}
                    />
                    {/* meniu1 (bottom curve) - enters from RIGHT */}
                    <img 
                      src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/meniu1-lyrOY1VJbc0DFYeERgAO5hWWVsP0sR.png"
                      alt="S bottom"
                      className="object-contain animate-s-bottom"
                      style={{ 
                        width: '32px', 
                        height: '32px', 
                        position: 'absolute', 
                        bottom: '2px',
                        right: '9px'
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
            {/* Spinning state: Red square stop button (visible and centered) - CLICKABLE */}
            {isSpinning && !showInfinityAnimation && (
              <div 
                className="absolute inset-0 flex items-center justify-center z-20 animate-fade-in cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  stopSpin()
                }}
              >
                <img 
                  src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/menu-JhQRUucQ4UDNEjjnq1NfHxL8aB3tQC.png"
                  alt="Stop button"
                  style={{ width: '50px', height: '50px' }}
                  className={`object-contain transition-transform ${canStopSpin ? 'hover:scale-110' : 'opacity-70'}`}
                />
              </div>
            )}
          </button>

          {/* Lower connector (10.png - U-shaped connector) with lower bet display */}
          <div className="relative z-10" style={{ width: '100px', height: showBetScroll ? '95px' : '70px', marginTop: '-30px', marginBottom: showBetScroll ? '-30px' : '-25px' }}>
            <img 
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/10-R8tfgTHqB33hMSN3zSxKuaKrDKzdbM.png" 
              alt="Lower connector"
              className="w-full h-full object-contain"
            />
            {/* Lower bet amount display - only visible when scrolling */}
            {showBetScroll && getAdjacentBets().lower !== null && (
              <div className="absolute z-30 flex flex-col items-center justify-center" style={{ top: '25px', left: '50%', transform: 'translateX(-50%)' }}>
                <p className="text-[#4ade80] font-bold text-lg leading-none" style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>{getAdjacentBets().lower!.toFixed(2)}</p>
                <p className="text-[10px] text-white font-semibold mt-0.5" style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>DMO</p>
              </div>
            )}
          </div>

          {/* Bottom button with gold accent (6.png) */}
          <button 
            onClick={() => adjustBet(-0.01)}
            className="relative z-20"
            style={{ 
              width: '70px', 
              height: '65px',
            }}
          >
            <img 
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/6-BSEebevh2De05umf8VTYR83bFwWfO0.png" 
              alt="Minus button"
              className="w-full h-full object-contain"
            />
          </button>
        </div>
      </div>

      {/* Gamble Popup - Transparent overlay covering multiplier and reels area */}
      {showGamblePopup && (
        <div 
          data-mh-popup="gamble"
          className="absolute z-50 flex flex-col"
          style={{ 
            left: '295px',
            top: '185px',
            width: '775px',
            height: '410px',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            borderRadius: '6px',
            border: '3px solid #c9a227',
            padding: '20px 25px',
          }}
        >
          {/* Close Button */}
          <button 
            onClick={closeGamble}
            className="absolute hover:opacity-80 transition-opacity"
            style={{ top: '12px', right: '18px', fontSize: '26px', fontWeight: 'bold', lineHeight: 1, color: '#c9a227' }}
          >
            X
          </button>

          {/* Top Row - GAMBLE AMOUNT, Previous Cards, GAMBLE TO WIN */}
          <div className="w-full flex items-start justify-between" style={{ paddingRight: '40px' }}>
            {/* GAMBLE AMOUNT */}
            <div className="flex flex-col items-center" style={{ minWidth: '150px' }}>
              <span className="text-sm font-bold uppercase mb-1 tracking-wider" style={{ color: '#c9a227' }}>GAMBLE AMOUNT</span>
              <span className="text-base font-bold" style={{ color: '#e74c3c' }}>{gambleWinAmount.toFixed(2)} DMO</span>
            </div>

            {/* Previous Cards */}
            <div className="flex flex-col items-center">
              <span className="text-sm font-bold uppercase mb-2 tracking-wider" style={{ color: '#888' }}>Previous Cards</span>
              <div className="flex gap-2">
                {[0, 1, 2, 3, 4].map(idx => (
                  previousCards[idx] ? (
                    <img key={idx} src={previousCards[idx]} alt="Previous card" className="object-contain rounded" style={{ width: '42px', height: '58px' }} />
                  ) : (
                    <div key={idx} style={{ width: '42px', height: '58px' }} />
                  )
                ))}
              </div>
            </div>

            {/* GAMBLE TO WIN */}
            <div className="flex flex-col items-center" style={{ minWidth: '150px' }}>
              <span className="text-sm font-bold uppercase mb-1 tracking-wider" style={{ color: '#c9a227' }}>GAMBLE TO WIN</span>
              <span className="text-base font-bold" style={{ color: '#2ecc71' }}>{gambleToWin.toFixed(2)} DMO</span>
            </div>
          </div>

          {/* Middle Row - RED button, Card, BLACK button */}
          <div className="flex-1 flex items-center justify-center gap-10">
            {/* Red Button - pill shape with glow */}
            <button 
              onClick={() => gamble('red')}
              disabled={isGambling || !!revealedCard}
              className={`relative transition-all duration-200 ${isGambling || revealedCard ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 cursor-pointer'}`}
              style={{ 
                width: '150px', 
                height: '48px',
                background: 'linear-gradient(180deg, #ff4444 0%, #cc0000 50%, #aa0000 100%)',
                borderRadius: '8px',
                border: '2px solid #ffd700',
                boxShadow: '0 0 15px rgba(255, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.3)',
              }}
            >
              <span className="font-bold text-white text-xl tracking-wider" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>RED</span>
            </button>

            {/* Card Display */}
            <div className="relative" style={{ width: '110px', height: '155px' }}>
              {revealedCard ? (
                <img 
                  src={revealedCard} 
                  alt="Revealed card" 
                  className="w-full h-full object-contain animate-flip-in"
                  style={{ 
                    borderRadius: '8px',
                  }}
                />
              ) : (
                <img 
                  src={gambleCardColor === 'red' ? GAMBLE_ASSETS.redCard : GAMBLE_ASSETS.greenCard} 
                  alt="Card back" 
                  className="w-full h-full object-contain transition-all duration-300"
                  style={{ 
                    borderRadius: '8px',
                  }}
                />
              )}
            </div>

            {/* Black Button - pill shape */}
            <button 
              onClick={() => gamble('black')}
              disabled={isGambling || !!revealedCard}
              className={`relative transition-all duration-200 ${isGambling || revealedCard ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 cursor-pointer'}`}
              style={{ 
                width: '150px', 
                height: '48px',
                background: 'linear-gradient(180deg, #444444 0%, #222222 50%, #111111 100%)',
                borderRadius: '8px',
                border: '2px solid #ffd700',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
              }}
            >
              <span className="font-bold text-white text-xl tracking-wider" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>BLACK</span>
            </button>
          </div>

          {/* Bottom Section - Take Win Button and instruction */}
          <div className="flex flex-col items-center">
            <button 
              onClick={takeWin}
              disabled={isGambling}
              className={`relative transition-all duration-200 ${isGambling ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 cursor-pointer'}`}
              style={{ 
                width: '170px', 
                height: '45px',
                background: 'linear-gradient(180deg, #2ecc71 0%, #27ae60 50%, #1e8449 100%)',
                borderRadius: '25px',
                border: '2px solid #ffd700',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
              }}
            >
              <span className="font-bold text-xl tracking-wider" style={{ color: '#0d3320', textShadow: '0 1px 0 rgba(255,255,255,0.3)' }}>TAKE WIN</span>
            </button>

            {/* Bottom instruction text */}
            <p className="text-sm mt-4" style={{ color: '#888' }}>Choose Red or Black gamble, or take the win!</p>
          </div>
        </div>
      )}

      {/* Menu Popup */}
      {showMenuPopup && (
        <div data-mh-popup="menu" className="absolute inset-0 z-[60] flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowMenuPopup(false)} />
          
          {/* Popup Container */}
          <div 
            data-mh-popup-box
            className="relative z-10 flex flex-col"
            style={{ 
              width: '860px',
              height: '580px',
              backgroundColor: 'rgba(30, 35, 45, 0.98)',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            {/* Top Header Bar */}
            <div className="flex items-center justify-between px-4 py-3" style={{ backgroundColor: '#2a3040' }}>
              {/* Exit Button */}
              <button 
                onClick={() => setShowMenuPopup(false)}
                className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span className="text-sm font-medium">Exit</span>
              </button>

              {/* Spin ID */}
              <div className="text-white/60 text-sm">
                Spin ID <span className="text-white/90">{spinId}</span>
              </div>

              {/* Close Button */}
              <button 
                onClick={() => setShowMenuPopup(false)}
                className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
              >
                <span className="text-sm font-medium">Close</span>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Content Area with Hidden Scroll */}
            <div className="flex-1 overflow-y-auto px-6 py-4" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <style>{`.menu-scroll::-webkit-scrollbar { display: none; }`}</style>
              
              {/* Rules Tab Content */}
              {menuActiveTab === 'rules' && (
                <>
              {/* All Symbol wins text */}
              <p className="text-center text-[#e74c3c] text-lg font-medium mb-4">All Symbol wins are in DMO</p>

              {/* Bet Amount Selector */}
              <div className="flex items-center justify-center gap-2 mb-8">
                <button 
                  className="w-10 h-10 rounded-full flex items-center justify-center text-2xl font-bold"
                  style={{ backgroundColor: '#1a2530', border: '2px solid #2dd4bf', color: '#2dd4bf' }}
                  onClick={() => {
                    const currentIndex = betSteps.findIndex(b => b === betPerLine)
                    if (currentIndex > 0) {
                      const newBet = betSteps[currentIndex - 1]
                      setBetPerLine(newBet)
                      setBetAmount(Number((newBet * 5).toFixed(2)))
                    }
                  }}
                >
                  -
                </button>
                <div 
                  className="flex flex-col items-center justify-center px-10 py-2 rounded-full"
                  style={{ 
                    background: 'linear-gradient(180deg, #2a3a4a 0%, #1a2a3a 100%)',
                    border: '2px solid #3a4a5a',
                    minWidth: '150px',
                  }}
                >
                  <span className="text-white font-bold text-xl">{betPerLine.toFixed(2)}</span>
                  <span className="text-white/50 text-xs">DMO</span>
                </div>
                <button 
                  className="w-10 h-10 rounded-full flex items-center justify-center text-2xl font-bold"
                  style={{ backgroundColor: '#1a2530', border: '2px solid #2dd4bf', color: '#2dd4bf' }}
                  onClick={() => {
                    const currentIndex = betSteps.findIndex(b => b === betPerLine)
                    if (currentIndex < betSteps.length - 1) {
                      const newBet = betSteps[currentIndex + 1]
                      setBetPerLine(newBet)
                      setBetAmount(Number((newBet * 5).toFixed(2)))
                    }
                  }}
                >
                  +
                </button>
              </div>

              {/* Symbol Payouts Grid */}
              <div className="flex flex-col items-center gap-2 mb-6">
                {/* Top Symbol - 77 */}
                <div className="flex flex-col items-center">
                  <img 
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/14.PNG-EZUQ7x7lxRezh6zqzOZqmhH9DDzFW1.png" 
                    alt="77" 
                    className="h-28 object-contain"
                  />
                  <span className="text-white/70 text-lg">{(betPerLine * 15).toFixed(2)}</span>
                </div>

                {/* Second Row - 4 symbols */}
                <div className="flex items-end justify-center gap-6">
                  <div className="flex flex-col items-center">
                    <img 
                      src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/12.PNG-vx6HId7D7s2H7svl4SllCl8A31nBNC.png" 
                      alt="Dollar" 
                      className="h-24 object-contain"
                    />
                    <span className="text-white/70 text-lg">{(betPerLine * 10).toFixed(2)}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <img 
                      src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/133.PNG-SL6Mo0FiFGcq4ml3TYs7bwok68Q1WW.png" 
                      alt="Bells" 
                      className="h-24 object-contain"
                    />
                    <span className="text-white/70 text-lg">{(betPerLine * 5).toFixed(2)}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <img 
                      src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/16.PNG-Cst60xoPxhNIVVLiZHUx1YYPJ8LMpP.png" 
                      alt="Watermelon Grapes" 
                      className="h-24 object-contain"
                    />
                    <span className="text-white/70 text-lg">{(betPerLine * 4).toFixed(2)}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <img 
                      src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/17.PNG-GjSU9rEXojy4TyOmgSZG5mDQ0e3fNT.png" 
                      alt="Mixed Fruits" 
                      className="h-24 object-contain"
                    />
                    <span className="text-white/70 text-lg">{(betPerLine * 2).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Multiplier Reel Section */}
              <div className="mb-8">
                <h3 className="text-[#e74c3c] text-xl font-bold mb-4">MULTIPLIER REEL</h3>
                <p className="text-white/80 text-sm leading-relaxed mb-6">
                  In addition to these standard rules, Game also includes the X Multiplier, which can randomly appear on the left side reel. With five possible multipliers (1x, 2x,3x,4x and 5x), any win can be multiplied for even greater rewards.
                </p>
                <div className="flex items-center justify-center">
                  <img 
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-KGGXqgmJMpfLU17j0Nmn8OJyBd3MYb.png" 
                    alt="Multiplier Reel"
                    className="h-64 object-contain"
                  />
                </div>
              </div>

              {/* X2 - Gamble Feature Section */}
              <div className="mb-8">
                <h3 className="text-[#e74c3c] text-xl font-bold mb-4">X2 - GAMBLE FEATURE</h3>
                <p className="text-white/80 text-sm leading-relaxed mb-6">
                  {`In the game, players have the opportunity to double their winnings with the X2 Gamble Feature. After a winning spin, players can access the Gamble round by clicking the "X2" button. Once the gamble screen appears, a card in the middle of the screen will flash red and black while face down, indicating that the gamble feature is active. To double their winnings, players must correctly guess the color of the card that will be revealed next. If they succeed, their winnings will be doubled. However if the guess incorrectly, their original win will be lost. At any point, players can use the "Take Win" button to collect their winnings and add them to their main balance.`}
                </p>
                <div className="flex items-center justify-center">
                  <img 
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/bt-removebg-preview-DzsLnWTvhHjfPJgyUrraqv3HkmBrBz.png" 
                    alt="Gamble Feature Cards"
                    className="h-48 object-contain"
                  />
                </div>
              </div>

              {/* Button Controls Section - Part 1 */}
              <div className="mb-8">
                <div className="flex items-center justify-center">
                  <img 
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/89-removebg-preview-6BOrXVwQZGY7qCaFN3JTRTMiZqTcdr.png" 
                    alt="Game Controls - X2, Auto Spin, Spin, Collect"
                    className="w-full max-w-md object-contain"
                  />
                </div>
              </div>

              {/* Button Controls Section - Part 2 */}
              <div className="mb-8">
                <div className="flex items-center justify-center">
                  <img 
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/45-removebg-preview-9RDwkrKbfKPcDy96rMuKzsYg0BmHjR.png" 
                    alt="Game Controls - Choose Bet, Balance, Bet, Menu"
                    className="w-full max-w-md object-contain"
                  />
                </div>
              </div>

              {/* OTHER RULES Section */}
              <div className="mb-8">
                <h3 className="text-[#e74c3c] text-xl font-bold mb-2">OTHER RULES</h3>
                <h4 className="text-white font-semibold mb-3">Payline Chart</h4>
                <p className="text-white/80 text-sm leading-relaxed mb-6">
                  All symbols pay from the left to right on adjacent reels starting from the leftmost reel. Highest payline wins are only paid. Line wins are multiplied by the bet value on the winning line.
                </p>
                <div className="flex items-center justify-center mb-8">
                  <img 
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/bsr-removebg-preview-lpcZBR5obtayq75EpHt4fDCaKJ5wyc.png" 
                    alt="Payline Chart"
                    className="w-full max-w-lg object-contain"
                  />
                </div>

                <h4 className="text-white font-semibold mb-3">Game RTP Rules</h4>
                <div className="text-white/80 text-sm space-y-1 mb-4">
                  <p>MIN BET: 0.05</p>
                  <p>MAX BET: 400.00</p>
                  <p>MAX WIN: 145 X</p>
                </div>
                <div className="text-white/80 text-sm space-y-1 mb-6">
                  <p>{`The Game's RTP is: 96.39%`}</p>
                  <p>Game Version v1.0.1</p>
                </div>

                <h4 className="text-white font-semibold mb-3">Disconnection and Malfunction policy</h4>
                <div className="text-white/80 text-sm leading-relaxed space-y-4">
                  <p>
                    {`In the event of a disconnection during gameplay, all accepted bets will still be played out, and any resulting wins will be credited to the player's balance at the end of the round.`}
                  </p>
                  <p>
                    Please note that after a disconnection, Autoplay mode will be switched off to ensure a fair gaming experience.
                  </p>
                  <p>
                    {`It's important to note that any malfunction will void all plays and payouts, and any unfinished round will be terminated.`}
                  </p>
                  <p>
                    When you hit a winning combination, you have three options to credit the win amount to your balance: you can start a new spin by clicking the spin button, Use the take win button to transfer the win to your balance, or use the X2 Double up feature button and click take win. If you are playing in AutoPlay mode, all wins are automatically transferred to your balance.
                  </p>
                  <p>
                    Malfunction or misuse voids all plays and pays.
                  </p>
                </div>
              </div>
              </>
              )}

              {/* Settings Tab Content */}
              {menuActiveTab === 'settings' && (
                <div className="flex flex-col items-center justify-center h-full py-8">
                  <div className="w-full max-w-md space-y-6">
                    {/* Sound Effects Toggle */}
                    <div className="flex items-center justify-between py-4 border-b border-white/10">
                      <div className="flex items-center gap-4">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/70">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        </svg>
                        <span className="text-white text-base">Sound Effects</span>
                      </div>
                      <button 
                        onClick={() => setSoundEffects(!soundEffects)}
                        className="relative w-14 h-7 rounded-full transition-colors duration-200"
                        style={{ backgroundColor: soundEffects ? '#22c55e' : '#4a5568' }}
                      >
                        <div 
                          className="absolute top-1 w-5 h-5 bg-white rounded-full transition-transform duration-200"
                          style={{ left: soundEffects ? '32px' : '4px' }}
                        />
                      </button>
                    </div>

                    {/* Click Sounds Toggle */}
                    <div className="flex items-center justify-between py-4 border-b border-white/10">
                      <div className="flex items-center gap-4">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
                          <path d="M9 9h.01" />
                          <path d="M15 9h.01" />
                          <path d="M8 13a4 4 0 0 0 8 0" />
                          <circle cx="12" cy="12" r="10" />
                        </svg>
                        <span className="text-white text-base">Click Sounds</span>
                      </div>
                      <button
                        onClick={() => setClickSoundEnabled(!clickSoundEnabled)}
                        className="relative w-14 h-7 rounded-full transition-colors duration-200"
                        style={{ backgroundColor: clickSoundEnabled ? '#22c55e' : '#4a5568' }}
                      >
                        <div
                          className="absolute top-1 w-5 h-5 bg-white rounded-full transition-transform duration-200"
                          style={{ left: clickSoundEnabled ? '32px' : '4px' }}
                        />
                      </button>
                    </div>

                    {/* Background Music Toggle */}
                    <div className="flex items-center justify-between py-4 border-b border-white/10">
                      <div className="flex items-center gap-4">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/70">
                          <path d="M9 18V5l12-2v13" />
                          <circle cx="6" cy="18" r="3" />
                          <circle cx="18" cy="16" r="3" />
                        </svg>
                        <span className="text-white text-base">Background Music</span>
                      </div>
                      <button 
                        onClick={() => setBgMusicEnabled(!bgMusicEnabled)}
                        className="relative w-14 h-7 rounded-full transition-colors duration-200"
                        style={{ backgroundColor: bgMusicEnabled ? '#22c55e' : '#4a5568' }}
                      >
                        <div 
                          className="absolute top-1 w-5 h-5 bg-white rounded-full transition-transform duration-200"
                          style={{ left: bgMusicEnabled ? '32px' : '4px' }}
                        />
                      </button>
                    </div>

                    {/* Full Screen Toggle */}
                    <div className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-4">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/70">
                          <polyline points="15 3 21 3 21 9" />
                          <polyline points="9 21 3 21 3 15" />
                          <line x1="21" y1="3" x2="14" y2="10" />
                          <line x1="3" y1="21" x2="10" y2="14" />
                        </svg>
                        <span className="text-white text-base">Full Screen</span>
                      </div>
                      <button 
                        onClick={toggleFullScreen}
                        className="relative w-14 h-7 rounded-full transition-colors duration-200"
                        style={{ backgroundColor: isFullScreen ? '#22c55e' : '#4a5568' }}
                      >
                        <div 
                          className="absolute top-1 w-5 h-5 bg-white rounded-full transition-transform duration-200"
                          style={{ left: isFullScreen ? '32px' : '4px' }}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* History Tab Content */}
              {menuActiveTab === 'history' && (
                <div className="flex flex-col h-full">
                  {/* Sub-tabs */}
                  <div className="flex border-b border-white/10 mb-4">
                    <button
                      onClick={() => setHistorySubTab('betHistory')}
                      className={`flex-1 py-3 text-center text-sm font-semibold transition-colors ${
                        historySubTab === 'betHistory' 
                          ? 'text-white border-b-2 border-[#2dd4bf]' 
                          : 'text-white/50 hover:text-white/70'
                      }`}
                    >
                      BET HISTORY
                    </button>
                    <button
                      onClick={() => setHistorySubTab('biggestWins')}
                      className={`flex-1 py-3 text-center text-sm font-semibold transition-colors ${
                        historySubTab === 'biggestWins' 
                          ? 'text-white border-b-2 border-[#2dd4bf]' 
                          : 'text-white/50 hover:text-white/70'
                      }`}
                    >
                      BIGGEST WINS
                    </button>
                  </div>

                  {/* Table Header */}
                  <div className="grid grid-cols-4 gap-4 px-4 pb-2 text-white/50 text-sm">
                    <span>Game</span>
                    <span className="text-center">Bet</span>
                    <span className="text-center">Win</span>
                    <span className="text-center">Replay</span>
                  </div>

                  {/* History List */}
                  <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {historySubTab === 'betHistory' && (
                      spinHistory.length > 0 ? (
                        spinHistory.map((entry, index) => (
                          <div key={index} className="grid grid-cols-4 gap-4 px-4 py-3 border-b border-white/5 items-center">
                            <div>
                              <p className="text-white font-medium text-sm">{entry.game}</p>
                              <p className="text-white/50 text-xs">{entry.date}</p>
                              <p className="text-white/50 text-xs">{entry.time}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-white font-medium">{entry.bet.toFixed(2)}</p>
                              <p className="text-white/50 text-xs">DMO</p>
                            </div>
                            <div className="text-center">
                              <p className={`font-medium ${entry.win > 0 ? 'text-[#22c55e]' : 'text-[#22c55e]'}`}>{entry.win.toFixed(2)}</p>
                              <p className={`text-xs ${entry.win > 0 ? 'text-[#22c55e]' : 'text-[#22c55e]'}`}>DMO</p>
                            </div>
                            <div className="flex justify-center">
                              <button className="w-10 h-10 rounded-full border-2 border-[#2dd4bf] flex items-center justify-center hover:bg-[#2dd4bf]/20 transition-colors">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[#2dd4bf]">
                                  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="flex items-center justify-center h-48">
                          <p className="text-white/50">No spin history yet</p>
                        </div>
                      )
                    )}
                    {historySubTab === 'biggestWins' && (
                      spinHistory.filter(e => e.win > 0).sort((a, b) => b.win - a.win).length > 0 ? (
                        spinHistory.filter(e => e.win > 0).sort((a, b) => b.win - a.win).map((entry, index) => (
                          <div key={index} className="grid grid-cols-4 gap-4 px-4 py-3 border-b border-white/5 items-center">
                            <div>
                              <p className="text-white font-medium text-sm">{entry.game}</p>
                              <p className="text-white/50 text-xs">{entry.date}</p>
                              <p className="text-white/50 text-xs">{entry.time}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-white font-medium">{entry.bet.toFixed(2)}</p>
                              <p className="text-white/50 text-xs">DMO</p>
                            </div>
                            <div className="text-center">
                              <p className="text-[#22c55e] font-medium">{entry.win.toFixed(2)}</p>
                              <p className="text-[#22c55e] text-xs">DMO</p>
                            </div>
                            <div className="flex justify-center">
                              <button className="w-10 h-10 rounded-full border-2 border-[#2dd4bf] flex items-center justify-center hover:bg-[#2dd4bf]/20 transition-colors">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[#2dd4bf]">
                                  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="flex items-center justify-center h-48">
                          <p className="text-white/50">No wins yet</p>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Tabs */}
            <div className="flex" style={{ backgroundColor: '#3a4050' }}>
              <button 
                onClick={() => setMenuActiveTab('rules')}
                className={`flex-1 flex items-center justify-center gap-2 py-4 transition-colors ${menuActiveTab === 'rules' ? 'border-b-2 border-[#e74c3c]' : ''}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={menuActiveTab === 'rules' ? 'text-white' : 'text-white/60'}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span className={`text-sm font-medium ${menuActiveTab === 'rules' ? 'text-white' : 'text-white/60'}`}>Rules</span>
              </button>
              <button 
                onClick={() => setMenuActiveTab('settings')}
                className={`flex-1 flex items-center justify-center gap-2 py-4 transition-colors ${menuActiveTab === 'settings' ? 'border-b-2 border-[#e74c3c]' : ''}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={menuActiveTab === 'settings' ? 'text-white' : 'text-white/60'}>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
                <span className={`text-sm font-medium ${menuActiveTab === 'settings' ? 'text-white' : 'text-white/60'}`}>Settings</span>
              </button>
              <button 
                onClick={() => setMenuActiveTab('history')}
                className={`flex-1 flex items-center justify-center gap-2 py-4 transition-colors ${menuActiveTab === 'history' ? 'border-b-2 border-[#e74c3c]' : ''}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={menuActiveTab === 'history' ? 'text-white' : 'text-white/60'}>
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </div>

      {/* ==================== MOBILE LAYOUT (< 768px) ====================
          Independent mobile component — visually mirrors the desktop using
          the same blob-storage assets and the same color palette. Only the
          POSITIONING differs: everything stacks vertically, and the 3 hex
          action buttons + the bet control are placed at the BOTTOM, under
          the footer/stats bar. All state, handlers, and behaviour reuse
          the same values as the desktop tree above (no functional changes).
          The desktop .game-scale-wrapper is hidden via CSS on < 768px. */}
      <div className="mh5-mobile">
        {/* === Header — back arrow + SmartSoft logo + time + menu === */}
        <header className="mhm-header">
          <div className="mhm-header-left">
            <button type="button" onClick={() => goBackToParent()} className="mhm-back-btn" aria-label="Back to lobby">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <img src={ASSETS.smartsoftLogo} alt="SmartSoft Gaming" className="mhm-header-logo" />
          </div>
          <div className="mhm-header-left">
            <span className="mhm-header-time">{currentTime}</span>
            <button
              type="button"
              className="mhm-menu-btn"
              onClick={() => setShowMenuPopup(true)}
              aria-label="Open menu"
            >
              <img src={ASSETS.menuIcon} alt="" />
            </button>
          </div>
        </header>

        {/* === MULTI HOT 5 sprite logo (same asset as desktop) === */}
        <div className="mhm-title">
          <div className="mhm-title-logo" />
        </div>

        {/* === MULTIPLIER / 5 LINES FIXED labels === */}
        <div className="mhm-labels">
          <span className="mhm-label-mult">MULTIPLIER</span>
          <span className="mhm-label-lines">
            <span className="num">5</span>
            <span className="txt">LINES FIXED</span>
          </span>
        </div>

        {/* === Board: multiplier panel + 3x3 reels (mirrors desktop) === */}
        <div className="mhm-board">
          {/* Multiplier panel — gold-gradient outer + dark inner with frame
              on the active middle cell. Identical layering to desktop. */}
          <div className="mhm-mult-outer">
            <div className="mhm-mult-inner">
              {(() => {
                const prevIdx = (activeMultiplier - 1 + 5) % 5
                const nextIdx = (activeMultiplier + 1) % 5
                const items = [
                  { idx: prevIdx, key: 'prev', active: false },
                  { idx: activeMultiplier, key: 'active', active: true },
                  { idx: nextIdx, key: 'next', active: false },
                ]
                return items.map(({ idx, key, active }) => {
                  const m = MULTIPLIERS[idx]
                  return (
                    <div key={key} className={`mhm-mult-cell ${active ? 'active' : ''}`}>
                      {active && (
                        <>
                          <img
                            src={MULTIPLIER_IMAGES.frame}
                            alt=""
                            className="mhm-mult-frame"
                            aria-hidden="true"
                          />
                          <img
                            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/cop-n1CRiiUAiup45rBhYoyAw8ZcudNSij.png"
                            alt=""
                            className="mhm-mult-bg"
                            aria-hidden="true"
                          />
                        </>
                      )}
                      <img
                        src={m.image}
                        alt={`${m.value}x`}
                        className={`mhm-mult-img ${isMultiplierSpinning && active ? 'animate-spin-vertical' : ''}`}
                        style={{
                          opacity: active ? 1 : 0.5,
                          filter: isMultiplierSpinning && active ? 'blur(3px)' : 'none',
                        }}
                      />
                    </div>
                  )
                })
              })()}
            </div>
          </div>

          {/* Reels — gold-gradient outer + dark inner. 3 cols × 3 rows.
              Same SlotSymbol component, same fire-glow on winning cells. */}
          <div className="mhm-reels-outer">
            <div className="mhm-reels-inner">
              {reels.map((reel, reelIdx) => {
                const isReelSpinning = spinningReels[reelIdx]
                const justStopped = reelJustStopped[reelIdx]
                return (
                  <div
                    key={reelIdx}
                    className={`mhm-reel-col ${justStopped ? 'animate-reel-stop' : ''}`}
                  >
                    <div className={`mhm-reel-col-inner ${isReelSpinning ? 'animate-spin-vertical' : ''}`}>
                      {reel.slice(0, 3).map((symIdx, rowIdx) => {
                        const isWinning = winningCells.has(`${reelIdx}-${rowIdx}`)
                        const symbol = SYMBOLS[symIdx]
                        return (
                          <div key={rowIdx} className="mhm-cell">
                            {isWinning && !isSpinning && <div className="mhm-cell-fire" aria-hidden="true" />}
                            <SlotSymbol
                              symbolId={symbol.id}
                              isWinning={isWinning}
                              isSpinning={isReelSpinning}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* === Footer / stats bar — uses desktop f2.png background === */}
        <div className="mhm-stats">
          <img
            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/f2-JI3KHV0wsTby5nweiu6WA5J8dnQKlo.png"
            alt=""
            className="mhm-stats-bg"
            aria-hidden="true"
          />
          <div className="mhm-stats-row">
            <div className="mhm-stat">
              <svg className="mhm-stat-icon" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 0 6px #22c55e)' }}>
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="#22c55e" strokeWidth="1.5" fill="none" />
                <rect x="5" y="8" width="6" height="4" rx="1" fill="#22c55e" />
              </svg>
              <div className="mhm-stat-text">
                <span className="mhm-stat-amt">{balance.toFixed(2)}</span>
                <span className="mhm-stat-unit">DMO</span>
              </div>
            </div>
            <div className="mhm-stat">
              <svg className="mhm-stat-icon" viewBox="0 0 24 24" fill="none">
                <path d="M8 21h8" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 17v4" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />
                <path d="M7 3h10v6a5 5 0 0 1-10 0V3Z" fill="#22d3ee" />
                <path d="M7 5H5a2 2 0 0 1 0-4h2" stroke="#22d3ee" strokeWidth="1.5" />
                <path d="M17 5h2a2 2 0 0 0 0-4h-2" stroke="#22d3ee" strokeWidth="1.5" />
              </svg>
              <div className="mhm-stat-text">
                <span className="mhm-stat-amt">{lastWin.toFixed(2)}</span>
                <span className="mhm-stat-unit">DMO</span>
              </div>
            </div>
            <div className="mhm-stat">
              <svg className="mhm-stat-icon" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="5" fill="#fbbf24" />
                <path d="M9 12l-2 9 5-3 5 3-2-9" fill="#fbbf24" />
              </svg>
              <div className="mhm-stat-text">
                <span className="mhm-stat-amt">{betAmount.toFixed(2)}</span>
                <span className="mhm-stat-unit">DMO</span>
              </div>
            </div>
          </div>
        </div>

        {/* === Hex action row — same SVG hexagons as desktop, horizontal === */}
        <div className="mhm-hex-row">
          {/* Autoplay */}
          <button
            type="button"
            className={`mhm-hex ${autoplayActive ? 'animate-pulse' : ''}`}
            onClick={() => (autoplayActive ? stopAutoplay() : setShowAutoplayModal(true))}
            aria-label="Autoplay"
          >
            <svg className="mhm-hex-bg" viewBox="0 0 100 115">
              <polygon points="50,2 98,27 98,88 50,113 2,88 2,27" fill="#1a4d3a" stroke={autoplayActive ? '#22c55e' : '#4a7a5a'} strokeWidth="2" />
              <polygon points="50,10 90,32 90,83 50,105 10,83 10,32" fill="#1a4d3a" stroke={autoplayActive ? '#22c55e' : '#3a6a4a'} strokeWidth="1" />
            </svg>
            <div className="mhm-hex-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke={autoplayActive ? '#22c55e' : '#5a9a6a'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </div>
            {autoplayActive && autoplayRemaining > 0 && (
              <div className="mhm-hex-badge">{autoplayRemaining}</div>
            )}
            {autoplayActive && autoplayRemaining === -1 && (
              <div className="mhm-hex-badge">INF</div>
            )}
          </button>

          {/* 2x Gamble */}
          <button
            type="button"
            className={`mhm-hex ${lastWin > 0 && !isSpinning ? 'animate-pulse-glow' : ''}`}
            onClick={() => { if (lastWin > 0 && !isSpinning) openGamble() }}
            disabled={!(lastWin > 0 && !isSpinning)}
            aria-label="Gamble"
          >
            <svg className="mhm-hex-bg" viewBox="0 0 100 115">
              <polygon points="50,2 98,27 98,88 50,113 2,88 2,27" fill="#1a4d3a" stroke="#4a7a5a" strokeWidth="2" />
              <polygon points="50,10 90,32 90,83 50,105 10,83 10,32" fill="#1a4d3a" stroke="#3a6a4a" strokeWidth="1" />
            </svg>
            <div className="mhm-hex-icon">
              <span className="mhm-hex-label" style={{ color: '#5a9a6a' }}>2x</span>
            </div>
          </button>

          {/* Download / collect (decorative — same as desktop's third hex) */}
          <button type="button" className="mhm-hex" aria-label="Download">
            <svg className="mhm-hex-bg" viewBox="0 0 100 115">
              <polygon points="50,6 94,29 94,86 50,109 6,86 6,29" fill="none" stroke="#7a6a45" strokeWidth="2" />
            </svg>
            <div className="mhm-hex-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#7a6a45" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
          </button>
        </div>

        {/* === Bet bar — five mobile assets chained edge-to-edge as one
            continuous unit. No stretching: every image keeps its natural
            aspect ratio (sized by HEIGHT, width = auto). Order:
              /mobile-bet/minus.png  – left button
              /mobile-bet/lower.png  – left half of the trough
              /mobile-bet/shield.png – central shield (raised above)
              /mobile-bet/higher.png – right half of the trough
              /mobile-bet/plus.png   – right button
            All FUNCTIONALITY is identical to the desktop bet column:
              - +/- buttons call adjustBet(±0.01) (which sets showBetScroll)
              - shield calls spin() / stopSpin() with all 3 desktop states
              - shield displays betPerLine.toFixed(2) (same as desktop)
              - getAdjacentBets() supplies the lower / higher previews
                (MAX placeholder when at the top of betSteps; lower preview
                visible only after the first +/- click, same as desktop) */}
        <div className="mhm-bet-row">
          {/* Minus button */}
          <button
            type="button"
            className="mhm-bet-minus"
            onClick={() => adjustBet(-0.01)}
            disabled={isSpinning}
            aria-label="Decrease bet"
          >
            <img src="/mobile-bet/minus.png" alt="-" />
          </button>

          {/* Lower trough half — only visible while showBetScroll (matches desktop) */}
          <div className="mhm-bet-half lower">
            <img src="/mobile-bet/lower.png" alt="" aria-hidden="true" />
            {showBetScroll && (
              <div className="mhm-bet-text">
                {getAdjacentBets().lower !== null ? (
                  <>
                    <span className="amt">{getAdjacentBets().lower!.toFixed(2)}</span>
                    <span className="unit">DMO</span>
                  </>
                ) : (
                  <>
                    <span className="amt faded">MIN</span>
                    <span className="unit faded">DMO</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Centre shield button — uses shield.png with all desktop states */}
          <button
            data-spin-btn
            type="button"
            className={`mhm-bet-shield ${isButtonPressed ? 'animate-button-press' : ''}`}
            onClick={spin}
            disabled={isSpinning || balance < betAmount}
            aria-label="Spin"
          >
            <img src="/mobile-bet/shield.png" alt="" className="mhm-shield-bg" aria-hidden="true" />

            {/* Default state: per-line bet + DMO + chevron (matches desktop) */}
            {!isSpinning && !showInfinityAnimation && (
              <div className="mhm-shield-text animate-fade-in">
                <span className="mhm-shield-amt">{betPerLine.toFixed(2)}</span>
                <span className="mhm-shield-unit">DMO</span>
                <svg className="mhm-shield-chev" viewBox="0 0 22 9" fill="none" aria-hidden="true">
                  <path d="M2 2 L11 7 L20 2" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}

            {/* Infinity-animation state: meniu1 + meniu2 forming an "S" */}
            {showInfinityAnimation && (
              <div className="mhm-shield-inf">
                <div className="mhm-shield-inf-box animate-s-container">
                  <img
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/meniu2-lbsBXc3EOL7GZiUNjnBCfnmyiGsPfC.png"
                    alt=""
                    className="mhm-shield-inf-top animate-s-top"
                    aria-hidden="true"
                  />
                  <img
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/meniu1-lyrOY1VJbc0DFYeERgAO5hWWVsP0sR.png"
                    alt=""
                    className="mhm-shield-inf-bottom animate-s-bottom"
                    aria-hidden="true"
                  />
                </div>
              </div>
            )}

            {/* Spinning state: red stop button (clickable to stop, same as desktop) */}
            {isSpinning && !showInfinityAnimation && (
              <div
                className="mhm-shield-stop animate-fade-in"
                onClick={(e) => { e.stopPropagation(); stopSpin() }}
              >
                <img
                  src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/menu-JhQRUucQ4UDNEjjnq1NfHxL8aB3tQC.png"
                  alt="Stop"
                  className={canStopSpin ? '' : 'opacity-70'}
                />
              </div>
            )}
          </button>

          {/* Higher trough half — always visible (matches desktop), MAX at top */}
          <div className="mhm-bet-half higher">
            <img src="/mobile-bet/higher.png" alt="" aria-hidden="true" />
            <div className="mhm-bet-text">
              {getAdjacentBets().higher !== null ? (
                <>
                  <span className="amt">{getAdjacentBets().higher!.toFixed(2)}</span>
                  <span className="unit">DMO</span>
                </>
              ) : (
                <>
                  <span className="amt faded">MAX</span>
                  <span className="unit faded">DMO</span>
                </>
              )}
            </div>
          </div>

          {/* Plus button */}
          <button
            type="button"
            className="mhm-bet-plus"
            onClick={() => adjustBet(0.01)}
            disabled={isSpinning}
            aria-label="Increase bet"
          >
            <img src="/mobile-bet/plus.png" alt="+" />
          </button>
        </div>
      </div>

      {/* Big Win Overlay - outside scaled wrapper for correct fixed positioning.
          The new badge image (178×105 cropped) has the gold coin at the top-left
          and a purple banner across the bottom. The win amount is positioned
          over the centre of the purple banner (~66% from the top of the box). */}
      {showBigWin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="text-center animate-bounce relative" style={{ width: '360px', height: '216px' }}>
            <img 
              src="/big-win-badge.png"
              alt="Big Win Badge"
              className="w-full h-full object-contain"
              style={{ filter: 'drop-shadow(0 0 30px rgba(255, 215, 0, 0.8))' }}
            />
            <div
              className="absolute"
              style={{ top: '66%', left: '52%', transform: 'translate(-50%, -50%)' }}
            >
              <p
                className="text-2xl font-bold text-white whitespace-nowrap"
                style={{ textShadow: '0 0 10px rgba(0,0,0,0.8)' }}
              >
                WIN {lastWin.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Autoplay Modal - outside scaled wrapper for correct fixed positioning */}
      {showAutoplayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl mx-4 rounded-lg border-2 border-[#e74c3c] bg-black/95 p-8">
            {/* Close button */}
            <button 
              onClick={() => setShowAutoplayModal(false)}
              className="absolute top-4 right-4 text-[#e74c3c] hover:text-[#ff6b6b] transition-colors"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {/* Title */}
            <h2 className="text-white text-3xl font-bold text-center mb-8">AUTOPLAY</h2>

            {/* Spin count selection */}
            <div className="flex items-center justify-center gap-4 mb-10">
              {[10, 25, 50, 75].map((count) => (
                <button
                  key={count}
                  onClick={() => setAutoplaySpins(count)}
                  className={`w-20 h-20 rounded-lg text-3xl font-bold transition-all ${
                    autoplaySpins === count 
                      ? 'bg-white text-black' 
                      : 'bg-[#2a2a2a] text-white/70 hover:bg-[#3a3a3a]'
                  }`}
                >
                  {count}
                </button>
              ))}
              <button
                onClick={() => setAutoplaySpins('infinite')}
                className={`w-20 h-20 rounded-lg flex items-center justify-center transition-all ${
                  autoplaySpins === 'infinite' 
                    ? 'bg-[#e74c3c]' 
                    : 'bg-[#e74c3c]/70 hover:bg-[#e74c3c]'
                }`}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" fill="white">
                  <path d="M18.6 6.62c-1.44 0-2.8.56-3.77 1.53L12 10.66 10.48 12h.01L7.8 14.39c-.64.64-1.49.99-2.4.99-1.87 0-3.39-1.51-3.39-3.38S3.53 8.62 5.4 8.62c.91 0 1.76.35 2.44 1.03l1.13 1 1.51-1.34L9.22 8.2C8.2 7.18 6.84 6.62 5.4 6.62 2.42 6.62 0 9.04 0 12s2.42 5.38 5.4 5.38c1.44 0 2.8-.56 3.77-1.53l2.83-2.5.01.01L13.52 12h-.01l2.69-2.39c.64-.64 1.49-.99 2.4-.99 1.87 0 3.39 1.51 3.39 3.38s-1.52 3.38-3.39 3.38c-.9 0-1.76-.35-2.44-1.03l-1.14-1.01-1.51 1.34 1.27 1.12c1.02 1.01 2.37 1.57 3.82 1.57 2.98 0 5.4-2.41 5.4-5.38s-2.42-5.37-5.4-5.37z"/>
                </svg>
              </button>
            </div>

            {/* Settings grid */}
            <div className="grid grid-cols-2 gap-8 mb-10">
              {/* SPIN TILL section */}
              <div>
                <h3 className="text-white text-lg font-bold mb-4">SPIN TILL</h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <span className="text-white/70 text-sm flex-1">If win reaches or exceeds</span>
                    <div className="flex items-center bg-[#1a1a1a] border border-white/20 rounded px-3 py-2">
                      <input 
                        type="number"
                        value={autoplayWinLimit}
                        onChange={(e) => setAutoplayWinLimit(e.target.value)}
                        placeholder=""
                        className="bg-transparent text-white w-20 outline-none text-right"
                      />
                      <span className="text-white/50 ml-2">|DMO</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-white/70 text-sm flex-1">If lose not exceeds</span>
                    <div className="flex items-center bg-[#1a1a1a] border border-white/20 rounded px-3 py-2">
                      <input 
                        type="number"
                        value={autoplayLoseLimit}
                        onChange={(e) => setAutoplayLoseLimit(e.target.value)}
                        placeholder=""
                        className="bg-transparent text-white w-20 outline-none text-right"
                      />
                      <span className="text-white/50 ml-2">|DMO</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* STOP SPIN section */}
              <div>
                <h3 className="text-white text-lg font-bold mb-4">STOP SPIN</h3>
                <div className="flex items-center justify-between">
                  <span className="text-white/70 text-sm">If i win BIG WIN</span>
                  <button 
                    onClick={() => setStopOnBigWin(!stopOnBigWin)}
                    className="relative w-14 h-7 rounded-full transition-colors duration-200"
                    style={{ backgroundColor: stopOnBigWin ? '#22c55e' : '#4a5568' }}
                  >
                    <div 
                      className="absolute top-1 w-5 h-5 rounded-full transition-transform duration-200"
                      style={{ 
                        left: stopOnBigWin ? '32px' : '4px',
                        backgroundColor: stopOnBigWin ? 'white' : '#e74c3c'
                      }}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Start button */}
            <button
              onClick={startAutoplay}
              className="w-full py-4 bg-[#e74c3c] hover:bg-[#ff5a4a] text-white text-2xl font-bold rounded-lg transition-colors"
            >
              START
            </button>
          </div>
        </div>
      )}
    </>
  )
}
