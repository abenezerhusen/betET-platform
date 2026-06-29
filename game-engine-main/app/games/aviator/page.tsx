"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Menu, Smile, Send, X } from "lucide-react"
import {
  connectGameSocket,
  disconnectGameSocket,
  ensureGameToken,
  fetchPlayerMe,
  placeAviatorBet,
  cashoutAviator,
  getAviatorRound,
  readBalance,
  onWalletUpdated,
  listenEmbeddedWalletInit,
  type AviatorRoundCrashedEvent,
  type AviatorRoundFlyingEvent,
  type AviatorRoundStartEvent,
} from "@/lib/game-engine"
import { goBackToParent } from "@/lib/embed-nav"
import { useBalanceToast } from "@/components/balance-toast"

// SVG URLs for plane animation frames
const PLANE_FRAMES = [
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/0-nCtXmWHKFzo8KMj7JSL1VvZ6s6d5kP.svg",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/1-eWwb7BGQkuAowirj7pngt4szTKPsJR.svg",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/2-kdTETr37hqDwHYNeEIZXQqqZIw6kur.svg",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/3-86gQ66LOeANAwxykSuqttCdnqDkWvh.svg",
]

const BG_SUN_URL = "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/bg-sun-gGAzFnjbQb1eh1GdmBKHr4oEHM1ar5.svg"
const UFC_URL = "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ufc-rMudIjyV8yUgQkzHRsJBkk0dQ3uWyM.svg"
const OFFICIAL_BADGE_URL = "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/official-GWAkq3a2K600AQL9guzpGrr87DWHSX.svg"

// Avatar images
const AVATAR_IMAGES = [
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-2-BeRmrG0S-fAy25HErmlp2TiT6dUMVI6vDsAHFJS.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-3-DChdYdR9-H2AEHWPS1ErEQHr33zM6N93gySc9Yk.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-35-BmaabGkx-oIEJILtKsbDMM3eJPVCKHpGpOAReHa.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-37-D9PHOygX-UkxSpmBGiN0fszzSqEOsrT9sJObDE0.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-39-B1fsJAVt-q1Odq120c2j0P8MSKq7xVjE7yXsYX2.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-40-D_pt54D3-rx89hJ64qgzbxnXVWRZYo59utFwgJq.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-42-BwbcWxvT-lSNAh2YItRk9gjDnlCeBl3omQwPgNy.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-51-Bju968lu-I6PPY4BXrfSn7lUH8mG0otjzCMuaTw.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-52-BPpyRHXp-FEDVOqqrvLj6dBHzfPAbc939fGy5EI.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-53-BmWrOCcM-dpy7jf7Du4L6lOHaFPgllYyWgN1ktR.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-56-DBSqXc-B-oy4IJQOz1ndjxBMHP5l5tvECpOpJbe.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-58-BudfxSL--IZYf1j7BmOXo8rkv9ONZXpaCKDda1V.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-65-DywDQTsC-6hqpid2bCvcAMTmIYMxEcPUWbVKAKR.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-68-BQsabfv2-NF1N2vz1rXA6zJZIHW1mNQPyeDetDd.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-69-B2oINhqD-oJvXcPjzdNWwOg02UX3kewWGEo0PFm.png",
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/av-70-CGn2aaWE-RFzgtIVwdWbdNWsveVcme6CsplMU4q.png",
]

export default function AviatorPage() {
  const router = useRouter()
  const { notify: notifyBalance, toast: balanceToast } = useBalanceToast()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)
  // Looping background music. The same <audio> instance is reused
  // across the page lifetime so toggling Music in settings just
  // pause/resumes it without reloading the file.
  const musicAudioRef = useRef<HTMLAudioElement | null>(null)
  // One-shot crash sound effect — fired when the plane crashes and
  // gated by the Sound toggle in the settings menu.
  const crashSfxRef = useRef<HTMLAudioElement | null>(null)
  
  // Game state — gamePhase / multiplier / roundId are driven by the
  // backend over Socket.io (Section 17 spec). The local pre-server fallback
  // values below are only what the UI shows for the first frame before the
  // round_start event arrives.
  const [betAmount1, setBetAmount1] = useState(4.00)
  const [betAmount2, setBetAmount2] = useState(4.00)
  const [balance, setBalance] = useState(0)
  const [multiplier, setMultiplier] = useState(1.00)
  const [gamePhase, setGamePhase] = useState<"waiting" | "flying" | "crashed">("waiting")
  // The server uses UUID round ids. We keep it as a string in this component
  // so the API requests can pass it straight through without lossy parsing.
  const [roundId, setRoundId] = useState<string>("")
  const [waitingTimer, setWaitingTimer] = useState(5)
  // Tracks the active backend bet ids per panel so Cashout can hit
  // /api/games/aviator/cashout with the right { bet_id, round_id }.
  const bet1IdRef = useRef<string | null>(null)
  const bet2IdRef = useRef<string | null>(null)
  const placingQueuedBet1Ref = useRef(false)
  const placingQueuedBet2Ref = useRef(false)
  // Auto-reset on round_start when the previous bet finished.
  const bet1RoundIdRef = useRef<string | null>(null)
  const bet2RoundIdRef = useRef<string | null>(null)
  const [curveProgress, setCurveProgress] = useState(0)
  const [bobOffset, setBobOffset] = useState(0) // For plane bobbing at right edge
  const [menuOpen, setMenuOpen] = useState(false) // Hamburger menu state
  // Sound / music settings — default ON. The Sound toggle gates short
  // SFX (e.g. the crash effect — to be added later) and the Music
  // toggle gates the looping background track.
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [musicEnabled, setMusicEnabled] = useState(true)
  const [animationEnabled, setAnimationEnabled] = useState(true)
  const [showAvatarPopup, setShowAvatarPopup] = useState(false)
  const [selectedAvatar, setSelectedAvatar] = useState(0)
  const [showFreeBetsPopup, setShowFreeBetsPopup] = useState(false)
  const [playWithCash, setPlayWithCash] = useState(true)
  const [showFreeBetsArchive, setShowFreeBetsArchive] = useState(false)
  const [showBetHistoryPopup, setShowBetHistoryPopup] = useState(false)
  const [betHistoryData, setBetHistoryData] = useState<Array<{date: string, betETB: number, multiplier: number, cashoutETB: number}>>([])
  const [showGameLimitsPopup, setShowGameLimitsPopup] = useState(false)
  const [freeBetsBalance, setFreeBetsBalance] = useState(0)
  const [freeBetOffers, setFreeBetOffers] = useState<Array<{id: string, amount: number, expiresAt: number, claimed: boolean}>>([])
  const [activeFreeBets, setActiveFreeBets] = useState<Array<{amount: number, claimedAt: string}>>([])
  
  // Bet states
  const [bet1Active, setBet1Active] = useState(false)
  const [bet2Active, setBet2Active] = useState(false)
  const [bet1CashedOut, setBet1CashedOut] = useState(false)
  const [bet2CashedOut, setBet2CashedOut] = useState(false)
  const [bet1CashoutMultiplier, setBet1CashoutMultiplier] = useState(0)
  const [bet2CashoutMultiplier, setBet2CashoutMultiplier] = useState(0)
  const [bet1Queued, setBet1Queued] = useState(false)
  const [bet2Queued, setBet2Queued] = useState(false)
  
  // Auto cashout
  const [autoCashout1, setAutoCashout1] = useState(false)
  const [autoCashout2, setAutoCashout2] = useState(false)
  const [autoCashoutValue1, setAutoCashoutValue1] = useState(2.00)
  const [autoCashoutValue2, setAutoCashoutValue2] = useState(2.00)
  
  // Bet/Auto tab mode
  const [betMode1, setBetMode1] = useState<"bet" | "auto">("bet")
  const [betMode2, setBetMode2] = useState<"bet" | "auto">("bet")
  const [autoPlay1, setAutoPlay1] = useState(false)
  const [autoPlay2, setAutoPlay2] = useState(false)
  
  // Auto Play popup state
  const [showAutoPlayPopup, setShowAutoPlayPopup] = useState<1 | 2 | null>(null)
  const [autoPlayRounds1, setAutoPlayRounds1] = useState(10)
  const [autoPlayRounds2, setAutoPlayRounds2] = useState(10)
  const [stopOnDecrease1, setStopOnDecrease1] = useState(false)
  const [stopOnDecrease2, setStopOnDecrease2] = useState(false)
  const [stopOnDecreaseValue1, setStopOnDecreaseValue1] = useState(0)
  const [stopOnDecreaseValue2, setStopOnDecreaseValue2] = useState(0)
  const [stopOnIncrease1, setStopOnIncrease1] = useState(false)
  const [stopOnIncrease2, setStopOnIncrease2] = useState(false)
  const [stopOnIncreaseValue1, setStopOnIncreaseValue1] = useState(0)
  const [stopOnIncreaseValue2, setStopOnIncreaseValue2] = useState(0)
  const [stopOnSingleWin1, setStopOnSingleWin1] = useState(false)
  const [stopOnSingleWin2, setStopOnSingleWin2] = useState(false)
  const [stopOnSingleWinValue1, setStopOnSingleWinValue1] = useState(0)
  const [stopOnSingleWinValue2, setStopOnSingleWinValue2] = useState(0)
  
  // Chat state
  const [chatPanelOpen, setChatPanelOpen] = useState(false)
  const [chatMessage, setChatMessage] = useState("")
  const [showChatEmoji, setShowChatEmoji] = useState(false)
  const [showChatGif, setShowChatGif] = useState(false)
  const [showGifPopup, setShowGifPopup] = useState(false)
  const [showRainPopup, setShowRainPopup] = useState(false)
  const [gifSearch, setGifSearch] = useState("")
  const [rainAmount, setRainAmount] = useState(2.00)
  const [rainPlayers, setRainPlayers] = useState(3)
  const [activeTab, setActiveTab] = useState<"all" | "previous" | "top">("all")
  const [topSubTab, setTopSubTab] = useState<"x" | "win" | "rounds">("x")
  const [topTimeFilter, setTopTimeFilter] = useState<"day" | "month" | "year">("day")
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [showSinglePanel, setShowSinglePanel] = useState(false)

  // Top players data
  const [topPlayers] = useState([
    { user: "u***x", date: "12.03.26", betETB: 2000.00, winETB: 11673.92, result: 5.84, roundMax: 16.25 },
    { user: "k***w", date: "12.03.26", betETB: 484.00, winETB: 2346.44, result: 4.85, roundMax: 27.49 },
    { user: "v***a", date: "12.03.26", betETB: 414.00, winETB: 1947.57, result: 4.70, roundMax: 5.81 },
    { user: "a***s", date: "12.03.26", betETB: 4000.00, winETB: 15117.82, result: 3.78, roundMax: 4.08 },
    { user: "o***j", date: "12.03.26", betETB: 4.00, winETB: 13.42, result: 3.36, roundMax: 6.65 },
    { user: "u***x", date: "12.03.26", betETB: 2000.00, winETB: 6696.78, result: 3.35, roundMax: 4.58 },
  ])

  // Rounds data for Rounds sub-tab
  const [roundsData] = useState([
    { dateTime: "12.03.26 10:35", multiplier: 4504.08 },
    { dateTime: "12.03.26 11:19", multiplier: 2990.84 },
    { dateTime: "12.03.26 03:26", multiplier: 2943.69 },
    { dateTime: "12.03.26 10:02", multiplier: 781.16 },
    { dateTime: "12.03.26 07:25", multiplier: 279.88 },
    { dateTime: "12.03.26 03:38", multiplier: 217.83 },
    { dateTime: "12.03.26 05:05", multiplier: 137.32 },
    { dateTime: "12.03.26 08:53", multiplier: 134.32 },
    { dateTime: "12.03.26 06:40", multiplier: 111.56 },
    { dateTime: "12.03.26 03:20", multiplier: 103.50 },
    { dateTime: "12.03.26 04:04", multiplier: 94.69 },
    { dateTime: "12.03.26 06:45", multiplier: 94.24 },
    { dateTime: "12.03.26 05:29", multiplier: 75.56 },
    { dateTime: "12.03.26 03:04", multiplier: 75.08 },
    { dateTime: "12.03.26 05:47", multiplier: 71.41 },
  ])

  // Recent multipliers history
  const [recentMultipliers, setRecentMultipliers] = useState([
    { value: 1.23 },
    { value: 5.67 },
    { value: 2.34 },
    { value: 12.45 },
    { value: 1.05 },
    { value: 3.21 },
    { value: 8.90 },
    { value: 1.87 },
    { value: 45.23 },
    { value: 2.11 },
    { value: 1.56 },
    { value: 3.89 },
  ])

  // All bets data
  const [allBets] = useState([
    { user: "d***v", bet: 50.00, multiplier: null, won: null },
    { user: "a***m", bet: 100.00, multiplier: 2.35, won: 235.00 },
    { user: "s***k", bet: 25.00, multiplier: null, won: null },
    { user: "j***n", bet: 200.00, multiplier: 1.85, won: 370.00 },
    { user: "m***r", bet: 75.00, multiplier: null, won: null },
  ])

  // Chat messages
  const [chatMessages, setChatMessages] = useState<Array<{
    user: string, 
    type?: string, 
    message: string, 
    avatar: string, 
    color: string, 
    likes?: number,
    isFreeBetOffer?: boolean,
    freeBetAmount?: number,
    freeBetId?: string,
    freeBetExpires?: number
  }>>([
    { user: "System", type: "system", message: "2.50 ETB", avatar: "G", color: "#22c55e", isFreeBetOffer: true, freeBetAmount: 2.50, freeBetId: "fb-sample-1", freeBetExpires: Date.now() + 300000 },
    { user: "Rain", type: "system", message: "operator", avatar: "R", color: "#51b579" },
    { user: "d***v", message: "", avatar: "D", color: "#f59e0b" },
    { user: "@e***l", message: "Rain bro", avatar: "E", color: "#f59e0b" },
    { user: "w***j", message: "Wahte naw", avatar: "W", color: "#6b7280" },
    { user: "x***t", message: "Hlo", avatar: "X", color: "#6b7280", likes: 1 },
  ])

  // Get multiplier color based on value
  const getMultiplierColor = (value: number) => {
    if (value >= 10) return "#a855f7" // Purple for high
    if (value >= 2) return "#3b82f6" // Blue for medium
    return "#60a5fa" // Light blue for low
  }

  // Handle claiming free bet
  const handleClaimFreeBet = useCallback((freeBetId: string, amount: number) => {
    // Add to free bets balance
    setFreeBetsBalance(prev => prev + amount)
    
    // Add to active free bets list
    const now = new Date()
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    setActiveFreeBets(prev => [...prev, { amount, claimedAt: timeStr }])
    
    // Remove the offer from chat by marking as claimed
    setChatMessages(prev => prev.map(msg => 
      msg.freeBetId === freeBetId ? { ...msg, isFreeBetOffer: false, message: `Claimed ${amount} ETB free bet!` } : msg
    ))
  }, [])

  // Pre-load + decode the plane sprite + background art once on mount so the
  // very first flight animates smoothly without fetching frames mid-flight.
  useEffect(() => {
    ;[...PLANE_FRAMES, BG_SUN_URL].forEach((url) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
    })
  }, [])

  // ============================================================
  // Background music
  //   • One looping <audio> instance is created on mount.
  //   • The Music toggle in the settings menu pauses / resumes
  //     it (default: ON, see useState above).
  //   • Browsers block autoplay until the user interacts with
  //     the page; we therefore retry play() on the first
  //     pointerdown / keydown event so the music kicks in
  //     seamlessly the moment the user touches the page.
  // ============================================================
  useEffect(() => {
    const music = new Audio('/aviator-music.m4a')
    music.loop = true
    music.volume = 0.4
    music.preload = 'auto'
    musicAudioRef.current = music

    const crash = new Audio('/aviator-crash.mp3')
    crash.loop = false
    crash.volume = 0.7
    crash.preload = 'auto'
    crashSfxRef.current = crash

    return () => {
      music.pause()
      music.src = ''
      musicAudioRef.current = null
      crash.pause()
      crash.src = ''
      crashSfxRef.current = null
    }
  }, [])

  // Play / pause the music whenever the toggle changes
  useEffect(() => {
    const audio = musicAudioRef.current
    if (!audio) return
    if (musicEnabled) {
      const tryPlay = () => {
        const p = audio.play()
        if (p && typeof p.then === 'function') {
          p.catch(() => {
            // Autoplay blocked — wait for the first user interaction
            const resume = () => {
              audio.play().catch(() => {})
              window.removeEventListener('pointerdown', resume)
              window.removeEventListener('keydown', resume)
            }
            window.addEventListener('pointerdown', resume, { once: true })
            window.addEventListener('keydown', resume, { once: true })
          })
        }
      }
      tryPlay()
    } else {
      audio.pause()
    }
  }, [musicEnabled])

  // Crash SFX — fires once whenever the plane crashes, gated by the
  // Sound toggle. By the time a crash happens the user has already
  // interacted with the page, so autoplay isn't an issue here.
  useEffect(() => {
    if (gamePhase !== 'crashed') return
    if (!soundEnabled) return
    const sfx = crashSfxRef.current
    if (!sfx) return
    sfx.currentTime = 0
    sfx.play().catch(() => {})
  }, [gamePhase, soundEnabled])

  // Periodically generate free bet offers in chat
  useEffect(() => {
    const generateFreeBetOffer = () => {
      const freeBetAmounts = [2.50, 5.00, 10.00, 2.50, 2.50]
      const amount = freeBetAmounts[Math.floor(Math.random() * freeBetAmounts.length)]
      const id = `fb-${Date.now()}`
      const expiresAt = Date.now() + 30000 // 30 seconds to claim
      
      setChatMessages(prev => [{
        user: "System",
        type: "system",
        message: `${amount.toFixed(2)} ETB`,
        avatar: "🎁",
        color: "#22c55e",
        isFreeBetOffer: true,
        freeBetAmount: amount,
        freeBetId: id,
        freeBetExpires: expiresAt
      }, ...prev.slice(0, 20)]) // Keep only last 20 messages
    }

    // Generate first offer after 15 seconds, then every 45-90 seconds
    const initialTimeout = setTimeout(() => {
      generateFreeBetOffer()
      
      const interval = setInterval(() => {
        generateFreeBetOffer()
      }, 45000 + Math.random() * 45000) // Random between 45-90 seconds
      
      return () => clearInterval(interval)
    }, 15000)

    return () => clearTimeout(initialTimeout)
  }, [])

  // Clean up expired free bet offers
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now()
      setChatMessages(prev => prev.map(msg => {
        if (msg.isFreeBetOffer && msg.freeBetExpires && msg.freeBetExpires < now) {
          return { ...msg, isFreeBetOffer: false, message: "Free bet expired" }
        }
        return msg
      }))
    }, 1000)

    return () => clearInterval(cleanupInterval)
  }, [])

  // Propeller frames now cycle via CSS keyframes (plane-prop-*), so there's
  // no per-frame React state update during flight.

  // ============================================================
  // Backend integration — Section 17 spec.
  //
  //   • Reads token from URL `?token=` (handled inside lib/game-engine).
  //   • Hydrates the wallet via GET /api/users/me.
  //   • Connects to Socket.io and listens for the canonical aviator events
  //     emitted by the server-side game loop:
  //       aviator:round_start   → phase=waiting, new round id
  //       aviator:round_flying  → phase=flying, multiplier ticks
  //       aviator:round_crashed → phase=crashed, final crash point
  //   • Replaces the legacy Math.random() based local loop entirely so the
  //     player and operator see the exact same outcomes.
  // ============================================================
  useEffect(() => {
    let cancelled = false
    let socket: ReturnType<typeof connectGameSocket> = null

    const onStart = (ev: AviatorRoundStartEvent) => {
      setRoundId(ev.round_id)
      setGamePhase("waiting")
      setMultiplier(1.0)
      setCurveProgress(0)
      setBobOffset(0)
      setWaitingTimer(ev.waiting_seconds ?? 5)
      // Reset cashout flags so the bet panels can accept new bets.
      setBet1CashedOut(false)
      setBet2CashedOut(false)
    }

    const onFlying = (ev: AviatorRoundFlyingEvent) => {
      // Same round → just tick the multiplier; on the very first flying
      // event we also flip phase. The waiting timer is allowed to fall to
      // zero independently below.
      setGamePhase("flying")
      setMultiplier(ev.multiplier)
      setCurveProgress((p) => Math.min(p + 0.5, 100))
      setBobOffset(Date.now())
    }

    const onCrashed = (ev: AviatorRoundCrashedEvent) => {
      setGamePhase("crashed")
      setMultiplier(ev.crash_point)
      setRecentMultipliers((prev) => [
        { value: ev.crash_point },
        ...prev.slice(0, 19),
      ])
      // Any active (non-cashed-out) bets are lost on crash. The server has
      // already settled them — we just reflect that here.
      setBet1Active(false)
      setBet2Active(false)
      bet1IdRef.current = null
      bet2IdRef.current = null
      bet1RoundIdRef.current = null
      bet2RoundIdRef.current = null
      // Keep wallet view authoritative after round settlement.
      fetchPlayerMe()
        .then((me) => {
          if (cancelled) return
          setBalance(readBalance(me))
        })
        .catch(() => {
          /* ignore transient fetch failures */
        })
    }

    const onPlayerCashout = () => {
      // Auto-cashout is settled in the worker; pull fresh wallet state.
      fetchPlayerMe()
        .then((me) => {
          if (cancelled) return
          setBalance(readBalance(me))
        })
        .catch(() => {
          /* ignore transient fetch failures */
        })
    }

    // Resolve a token first (live: iframe token; local dev: auto-minted
    // seeded-player token) so the game always opens, then hydrate wallet +
    // round and subscribe to the live feed.
    void (async () => {
      await ensureGameToken()
      if (cancelled) return

      fetchPlayerMe()
        .then((me) => {
          if (cancelled) return
          setBalance(readBalance(me))
        })
        .catch(() => {
          /* unauthenticated — caller will see 401 redirect from api helper */
        })

      // Seed initial round snapshot so the first paint doesn't hang at
      // "waiting" if the page joins mid-round.
      getAviatorRound()
        .then((snap) => {
          if (cancelled) return
          if (snap.round_id) setRoundId(snap.round_id)
          if (snap.phase === "waiting" || snap.phase === "flying" || snap.phase === "crashed") {
            setGamePhase(snap.phase)
          }
          if (typeof snap.current_multiplier === "number") {
            setMultiplier(snap.current_multiplier)
          }
        })
        .catch(() => {
          /* not authenticated yet or worker hasn't bootstrapped — ignore */
        })

      socket = connectGameSocket("aviator")
      if (!socket) return
      socket.on("aviator:round_start", onStart)
      socket.on("aviator:round_flying", onFlying)
      socket.on("aviator:round_crashed", onCrashed)
      socket.on("aviator:player_cashout", onPlayerCashout)
    })()

    return () => {
      cancelled = true
      if (socket) {
        socket.off("aviator:round_start", onStart)
        socket.off("aviator:round_flying", onFlying)
        socket.off("aviator:round_crashed", onCrashed)
        socket.off("aviator:player_cashout", onPlayerCashout)
      }
    }
    // Mount-only — listeners use refs/setters which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return listenEmbeddedWalletInit(({ balance }) => {
      if (Number.isFinite(balance)) setBalance(balance);
    });
  }, []);

  // Keep in-game balance in sync with the user-panel header wallet.
  useEffect(() => {
    return onWalletUpdated(() => {
      fetchPlayerMe()
        .then((me) => setBalance(readBalance(me)))
        .catch(() => { /* ignore */ })
    })
  }, [])

  // Visual waiting-timer countdown — purely cosmetic; the authoritative
  // "is the round still in waiting?" answer is the socket event.
  useEffect(() => {
    if (gamePhase !== "waiting") return
    const timer = setInterval(() => {
      setWaitingTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [gamePhase])

  // Local auto-cashout trigger. We never invent multipliers here — we only
  // call cashoutAviator when the server-emitted multiplier crosses the
  // player's auto-cashout threshold. The server also enforces this
  // independently in the aviator-loop worker, so this is best-effort.
  useEffect(() => {
    if (gamePhase !== "flying") return
    if (autoCashout1 && bet1Active && !bet1CashedOut && multiplier >= autoCashoutValue1) {
      void handleCashout(1)
    }
    if (autoCashout2 && bet2Active && !bet2CashedOut && multiplier >= autoCashoutValue2) {
      void handleCashout(2)
    }
    // handleCashout is defined further down; mounting its deps would
    // recreate this effect on every multiplier tick. The functional setters
    // keep things consistent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiplier, gamePhase, autoCashout1, autoCashout2, bet1Active, bet2Active, bet1CashedOut, bet2CashedOut, autoCashoutValue1, autoCashoutValue2])

  // Place a bet on the *current* round. Calls the backend immediately —
  // there's no client-side wallet deduction; the server returns the new
  // balance and we mirror it. Queuing while flying just stashes the
  // intent: when the next round_start event arrives we re-call this
  // function for the new round id.
  const handleBet = useCallback(
    async (panel: 1 | 2) => {
      const amount = panel === 1 ? betAmount1 : betAmount2
      if (amount > balance) {
        notifyBalance("Insufficient balance — please deposit")
        return
      }
      if (!roundId) return

      // Flying → queue for next round.
      if (gamePhase === "flying") {
        if (panel === 1) setBet1Queued(true)
        else setBet2Queued(true)
        return
      }
      if (gamePhase !== "waiting") return

      const autoCashout =
        panel === 1
          ? autoCashout1 && autoCashoutValue1 > 1
            ? autoCashoutValue1
            : undefined
          : autoCashout2 && autoCashoutValue2 > 1
            ? autoCashoutValue2
            : undefined

      try {
        const res = await placeAviatorBet({
          round_id: roundId,
          amount,
          auto_cashout: autoCashout,
        })
        setBalance(res.balance_after)
        if (panel === 1) {
          bet1IdRef.current = res.bet_id
          bet1RoundIdRef.current = res.round_id
          setBet1Active(true)
          setBet1CashedOut(false)
          setBet1Queued(false)
        } else {
          bet2IdRef.current = res.bet_id
          bet2RoundIdRef.current = res.round_id
          setBet2Active(true)
          setBet2CashedOut(false)
          setBet2Queued(false)
        }
      } catch (err) {
        console.error("Aviator bet failed", err)
        const msg = err instanceof Error ? err.message : ""
        notifyBalance(/insufficient/i.test(msg) ? "Insufficient balance — please deposit" : "Bet failed")
      }
    },
    [
      balance,
      betAmount1,
      betAmount2,
      gamePhase,
      roundId,
      autoCashout1,
      autoCashout2,
      autoCashoutValue1,
      autoCashoutValue2,
      notifyBalance,
    ],
  )

  // Cash out an active bet. Hits POST /api/games/aviator/cashout. On
  // success the server tells us the exact multiplier-locked payout and
  // the wallet balance after — we trust both numbers.
  const handleCashout = useCallback(
    async (panel: 1 | 2) => {
      if (gamePhase !== "flying") return
      const amount = panel === 1 ? betAmount1 : betAmount2
      const isActive = panel === 1 ? bet1Active : bet2Active
      const isCashedOut = panel === 1 ? bet1CashedOut : bet2CashedOut
      const betId = panel === 1 ? bet1IdRef.current : bet2IdRef.current
      const betRoundId = panel === 1 ? bet1RoundIdRef.current : bet2RoundIdRef.current
      if (!isActive || isCashedOut || !betId || !betRoundId) return

      try {
        const res = await cashoutAviator({ bet_id: betId, round_id: betRoundId })
        setBalance(res.balance_after)

        const now = new Date()
        const dateStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
        setBetHistoryData((prev) => [
          {
            date: dateStr,
            betETB: amount,
            multiplier: res.multiplier_at_cashout,
            cashoutETB: res.payout,
          },
          ...prev,
        ])

        if (panel === 1) {
          setBet1CashedOut(true)
          setBet1CashoutMultiplier(res.multiplier_at_cashout)
        } else {
          setBet2CashedOut(true)
          setBet2CashoutMultiplier(res.multiplier_at_cashout)
        }
      } catch (err) {
        console.error("Aviator cashout failed", err)
      }
    },
    [
      gamePhase,
      betAmount1,
      betAmount2,
      bet1Active,
      bet2Active,
      bet1CashedOut,
      bet2CashedOut,
    ],
  )

  // Queue-to-round bridge: when a queued bet reaches a new waiting round,
  // place the real backend bet (stake debit + settlement eligibility).
  useEffect(() => {
    if (gamePhase !== "waiting" || !roundId) return

    if (bet1Queued && !bet1Active && !placingQueuedBet1Ref.current) {
      placingQueuedBet1Ref.current = true
      void handleBet(1).finally(() => {
        placingQueuedBet1Ref.current = false
      })
    }

    if (bet2Queued && !bet2Active && !placingQueuedBet2Ref.current) {
      placingQueuedBet2Ref.current = true
      void handleBet(2).finally(() => {
        placingQueuedBet2Ref.current = false
      })
    }
  }, [gamePhase, roundId, bet1Queued, bet2Queued, bet1Active, bet2Active, handleBet])

  // Cancel a queued or pre-flight bet. For queued bets we just clear the
  // queue flag — no API call needed because nothing was sent. For active
  // bets in waiting phase we'd need a backend "cancel" endpoint which
  // doesn't exist (the round hasn't started yet so the server treats it
  // as a normal bet). We keep the local cancel for queued bets only to
  // remain consistent with the spec.
  const handleCancelBet = useCallback((panel: 1 | 2) => {
    const isQueued = panel === 1 ? bet1Queued : bet2Queued
    if (!isQueued) return
    if (panel === 1) {
      setBet1Queued(false)
    } else {
      setBet2Queued(false)
    }
  }, [bet1Queued, bet2Queued])

  // Disconnect the socket when the player leaves the page so we don't
  // leak listeners across navigations.
  useEffect(() => {
    return () => {
      disconnectGameSocket()
    }
  }, [])

  return (
    <div 
      data-aviator-page
      className="h-screen flex flex-col overflow-hidden"
      style={{ 
        backgroundColor: '#0e0e0e',
        fontFamily: "'Inter', 'Roboto', sans-serif"
      }}
    >
      {balanceToast}
      {/* CSS Animations */}
      <style jsx global>{`
        @keyframes fly-curve {
          0% { transform: translate(0, 0) rotate(-15deg); }
          100% { transform: translate(calc(100% - 150px), calc(-100% + 100px)) rotate(-30deg); }
        }
        @keyframes pulse-glow {
          0%, 100% { filter: drop-shadow(0 0 10px rgba(229, 5, 57, 0.5)); }
          50% { filter: drop-shadow(0 0 25px rgba(229, 5, 57, 0.8)); }
        }
        @keyframes sun-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        /* Propeller sprite cycling, driven entirely on the compositor so the
           flight loop no longer re-renders the whole React tree 10×/second
           just to swap a frame (the old setInterval(setPlaneFrame) churn was
           a big contributor to jank, especially inside the user-panel iframe
           where the page shares the main thread). Four stacked frames each
           light up for one quarter of a 0.4s cycle. */
        @keyframes plane-prop-0 { 0%,24.99% { opacity: 1 } 25%,100% { opacity: 0 } }
        @keyframes plane-prop-1 { 0%,24.99% { opacity: 0 } 25%,49.99% { opacity: 1 } 50%,100% { opacity: 0 } }
        @keyframes plane-prop-2 { 0%,49.99% { opacity: 0 } 50%,74.99% { opacity: 1 } 75%,100% { opacity: 0 } }
        @keyframes plane-prop-3 { 0%,74.99% { opacity: 0 } 75%,100% { opacity: 1 } }
        .curve-path {
          stroke-dasharray: 1000;
          stroke-dashoffset: 1000;
          animation: draw-curve 5s linear forwards;
        }
        @keyframes draw-curve {
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      {/* Header */}
      <header 
        className="flex items-center justify-between px-4 py-2.5"
        style={{ 
          backgroundColor: '#1a1a1a',
          borderBottom: '1px solid #2a2a2a'
        }}
      >
        {/* Left - Back Button and Aviator Logo */}
        <div className="flex items-center gap-2">
          {/* Back Button */}
          <button 
            onClick={() => goBackToParent(() => router.push('/'))}
            className="p-1 hover:opacity-80 transition-opacity"
            aria-label="Back to lobby"
          >
            <svg 
              className="w-5 h-5 text-gray-400" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M15 19l-7-7 7-7" 
              />
            </svg>
          </button>
          
          {/* Aviator Logo */}
          <img 
            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-PCnSTgJBvW8diWzbfgc8OgnkcIarUu.png"
            alt="Aviator"
            className="cursor-pointer"
            onClick={() => goBackToParent(() => router.push('/'))}
            style={{
              height: '24px',
              width: 'auto'
            }}
          />
        </div>
        
        {/* Right - Balance and Icons */}
        <div className="flex items-center gap-3">
          {/* Balance */}
          <div className="flex items-center gap-1">
            <span 
              style={{
                color: '#4ade80',
                fontWeight: 600,
                fontSize: '0.95rem'
              }}
            >
              {balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span 
              style={{
                color: '#9ca3af',
                fontSize: '0.85rem',
                fontWeight: 400
              }}
            >
              ETB
            </span>
          </div>
          
          {/* Menu Icon */}
          <div className="relative">
            <button 
              className="p-1 hover:opacity-80 transition-opacity"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu className="w-5 h-5 text-gray-400" />
            </button>
            
            {/* Dropdown Menu */}
            {menuOpen && (
              <>
                {/* Backdrop */}
                <div 
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                
                {/* Menu Panel */}
                <div 
                  className="absolute top-full mt-2 z-50"
                  style={{
                    right: '-16px',
                    width: '340px',
                    backgroundColor: '#1a1b1e',
                    borderRadius: '12px',
                    border: '1px solid #2c2d30',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
                  }}
                >
                  {/* User Profile Section */}
                  <div 
                    className="flex items-center justify-between p-4"
                    style={{ borderBottom: '1px solid #2c2d30' }}
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full overflow-hidden">
                        <img 
                          src={AVATAR_IMAGES[selectedAvatar % AVATAR_IMAGES.length]}
                          alt="Profile Avatar"
                          className="w-full h-full object-cover"
                          crossOrigin="anonymous"
                        />
                      </div>
                      <span className="text-white font-medium">t***e</span>
                    </div>
                    <button 
                      onClick={() => {
                        setShowAvatarPopup(true)
                        setMenuOpen(false)
                      }}
                      className="px-3 py-1.5 text-xs rounded-full"
                      style={{ 
                        backgroundColor: '#2c2d30',
                        color: '#9ca3af'
                      }}
                    >
                      Change<br/>Avatar
                    </button>
                  </div>
                  
                  {/* Settings Toggles */}
                  <div style={{ borderBottom: '1px solid #2c2d30' }}>
                    {/* Sound */}
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                        <span className="text-white text-sm">Sound</span>
                      </div>
                      <button 
                        className="w-11 h-6 rounded-full transition-colors relative"
                        style={{ backgroundColor: soundEnabled ? '#22c55e' : '#374151' }}
                        onClick={() => setSoundEnabled(!soundEnabled)}
                      >
                        <div 
                          className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform"
                          style={{ left: soundEnabled ? '24px' : '4px' }}
                        />
                      </button>
                    </div>
                    
                    {/* Music */}
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                        <span className="text-white text-sm">Music</span>
                      </div>
                      <button 
                        className="w-11 h-6 rounded-full transition-colors relative"
                        style={{ backgroundColor: musicEnabled ? '#22c55e' : '#374151' }}
                        onClick={() => setMusicEnabled(!musicEnabled)}
                      >
                        <div 
                          className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform"
                          style={{ left: musicEnabled ? '24px' : '4px' }}
                        />
                      </button>
                    </div>
                    
                    {/* Animation */}
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span className="text-white text-sm">Animation</span>
                      </div>
                      <button 
                        className="w-11 h-6 rounded-full transition-colors relative"
                        style={{ backgroundColor: animationEnabled ? '#22c55e' : '#374151' }}
                        onClick={() => setAnimationEnabled(!animationEnabled)}
                      >
                        <div 
                          className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform"
                          style={{ left: animationEnabled ? '24px' : '4px' }}
                        />
                      </button>
                    </div>
                  </div>
                  
                  {/* Menu Items */}
                  <div style={{ borderBottom: '1px solid #2c2d30' }}>
                    <button 
                      onClick={() => {
                        setShowFreeBetsPopup(true)
                        setMenuOpen(false)
                      }}
                      className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 transition-colors"
                    >
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                      <span className="text-white text-sm">Free Bets</span>
                      {activeFreeBets.length > 0 && (
                        <span 
                          className="flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full"
                          style={{ backgroundColor: '#ef4444', color: '#fff' }}
                        >
                          {activeFreeBets.length}
                        </span>
                      )}
                    </button>
                    
                    <button 
                      onClick={() => {
                        setShowBetHistoryPopup(true)
                        setMenuOpen(false)
                      }}
                      className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 transition-colors"
                    >
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-white text-sm">My Bet History</span>
                    </button>
                    
                    <button 
                      onClick={() => {
                        setShowGameLimitsPopup(true)
                        setMenuOpen(false)
                      }}
                      className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 transition-colors"
                    >
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                      <span className="text-white text-sm">Game Limits</span>
                    </button>
                    
                    <button className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 transition-colors">
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-white text-sm">How To Play</span>
                    </button>
                    
                    <button className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 transition-colors">
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-white text-sm">Game Rules</span>
                    </button>
                    
                    <button className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/5 transition-colors">
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <span className="text-white text-sm">Provably Fair Settings</span>
                    </button>
                  </div>
                  
                  {/* Home Link */}
                  <div className="p-3 flex justify-center">
                    <button className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                      <span className="text-sm">Home</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          
          {/* Chat Icon */}
          <button 
            className="p-1 hover:opacity-80 transition-opacity"
            onClick={() => setChatPanelOpen(!chatPanelOpen)}
          >
            <svg 
              className={`w-5 h-5 ${chatPanelOpen ? 'text-green-400' : 'text-gray-400'}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={1.5} 
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" 
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden" data-av-section="main">
        {/* Left Panel - Bets */}
        <div 
          data-av-section="left-panel"
          className="flex-shrink-0 flex flex-col m-1 h-full"
          style={{ 
            width: '397px',
            maxHeight: 'calc(100vh - 60px)',
            backgroundColor: '#101112',
            borderRadius: '16px',
            border: '1px solid #2c2d30',
            overflow: 'hidden'
          }}
        >
          {/* Tabs Container - with border */}
          <div 
            className="mx-2 mt-2"
            style={{ 
              backgroundColor: '#1b1c1d',
              borderRadius: '20px',
              border: '1px solid #2c2d30',
              padding: '3px'
            }}
          >
            <div className="flex items-center gap-0.5">
              <button 
                onClick={() => setActiveTab("all")}
                className="flex-1 py-1.5 text-xs font-medium transition-all"
                style={{ 
                  backgroundColor: activeTab === "all" ? '#ffffff' : 'transparent',
                  color: activeTab === "all" ? '#000000' : '#6a7a7a',
                  borderRadius: '18px'
                }}
              >
                All Bets
              </button>
              <button 
                onClick={() => setActiveTab("previous")}
                className="flex-1 py-1.5 text-xs font-medium transition-all"
                style={{ 
                  backgroundColor: activeTab === "previous" ? '#ffffff' : 'transparent',
                  color: activeTab === "previous" ? '#000000' : '#6a7a7a',
                  borderRadius: '18px'
                }}
              >
                Previous
              </button>
              <button 
                onClick={() => setActiveTab("top")}
                className="flex-1 py-1.5 text-xs font-medium transition-all"
                style={{ 
                  backgroundColor: activeTab === "top" ? '#ffffff' : 'transparent',
                  color: activeTab === "top" ? '#000000' : '#6a7a7a',
                  borderRadius: '18px'
                }}
              >
                Top
              </button>
            </div>
          </div>
          
          {/* Stats Row Container - with border and loading indicator at bottom - ONLY show for All Bets tab */}
          {activeTab === "all" && (
            <div 
              className="mx-2 mt-2"
              style={{ 
                backgroundColor: '#1b1c1d',
                borderRadius: '16px',
                border: '1px solid #2c2d30',
                padding: '10px 14px 14px 14px',
                position: 'relative'
              }}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs">
                  <span style={{ color: '#ffffff', fontWeight: 500 }}>{allBets.filter(b => b.won).length}</span>
                  <span style={{ color: '#6a7a7a' }}>/{allBets.length} </span>
                  <span style={{ color: '#6a7a7a' }}>Bets</span>
                </div>
                <div className="text-right">
                  <div style={{ color: '#ffffff', fontSize: '0.9rem', fontWeight: 500 }}>
                    {allBets.reduce((sum, b) => sum + (b.won ? b.bet * (b.multiplier || 1) : 0), 0).toFixed(2)}
                  </div>
                  <div style={{ color: '#51b579', fontSize: '0.65rem' }}>Total win ETB</div>
                </div>
              </div>
              {/* Loading indicator - thin bar at BOTTOM with margin from edges */}
              <div 
                style={{
                  position: 'absolute',
                  left: '10px',
                  right: '10px',
                  bottom: '6px',
                  height: '3px',
                  backgroundColor: '#2c2d30',
                  borderRadius: '3px'
                }}
              >
                <div 
                  style={{
                    height: '100%',
                    width: `${allBets.length > 0 ? (allBets.filter(b => b.won).length / allBets.length) * 100 : 0}%`,
                    backgroundColor: '#51b579',
                    borderRadius: '3px',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
            </div>
          )}
          
          {/* Column Headers - show for All Bets and Previous tabs */}
          {(activeTab === "all" || activeTab === "previous") && (
            <div 
              className="flex items-center px-3 py-2 mt-2 text-[10px]"
              style={{ color: '#6a7a7a' }}
            >
              <div style={{ flex: '1.2' }}>Player</div>
              <div style={{ flex: '1', textAlign: 'center' }}>Bet ETB</div>
              <div style={{ flex: '0.5', textAlign: 'center' }}>X</div>
              <div style={{ flex: '1', textAlign: 'right' }}>Win ETB</div>
            </div>
          )}
          
          {/* Bets list - scrollable container */}
          <div className="flex-1 overflow-y-auto scrollbar-hide px-2 py-1" style={{ minHeight: 0, maxHeight: '100%' }}>
            {activeTab === "all" && allBets.length > 0 ? (
              <div>
                {allBets.map((bet, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-center justify-between"
                    style={{ 
                      padding: '6px 10px',
                      borderRadius: '12px',
                      marginBottom: '4px',
                      backgroundColor: bet.won ? 'rgba(81, 181, 121, 0.15)' : '#252527',
                      fontSize: '11px'
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <div 
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold overflow-hidden"
                        style={{ backgroundColor: '#8b5cf6' }}
                      >
                        <img 
                          src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${bet.user}`}
                          alt={bet.user}
                          className="w-full h-full"
                        />
                      </div>
                      <span style={{ color: '#9ca3af', fontSize: '11px' }}>{bet.user}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span style={{ color: '#fff', fontSize: '11px' }}>
                        {bet.bet.toFixed(2)}
                      </span>
                      {bet.multiplier && (
                        <span style={{ color: '#a855f7', fontSize: '11px' }}>
                          {bet.multiplier.toFixed(2)}x
                        </span>
                      )}
                      {bet.won && (
                        <span style={{ color: '#51b579', fontSize: '11px' }}>
                          {(bet.bet * (bet.multiplier || 1)).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : activeTab === "previous" ? (
              <div className="p-4 text-center text-gray-500 text-xs">
                No previous bets
              </div>
            ) : activeTab === "top" ? (
              <div>
                {/* Sub-tabs - ALL in ONE rounded container - FIXED at top */}
                <div 
                  className="mb-3 flex-shrink-0"
                  style={{ 
                    backgroundColor: '#1b1c1d',
                    borderRadius: '20px',
                    border: '1px solid #2c2d30',
                    padding: '4px'
                  }}
                >
                  {/* Row 1: X, Win, Rounds */}
                  <div className="flex items-center gap-0.5 mb-1">
                    <button 
                      onClick={() => setTopSubTab("x")}
                      className="flex-1 py-1.5 text-xs font-medium transition-all"
                      style={{ 
                        backgroundColor: topSubTab === "x" ? '#ffffff' : 'transparent',
                        color: topSubTab === "x" ? '#000000' : '#6a7a7a',
                        borderRadius: '16px'
                      }}
                    >
                      X
                    </button>
                    <button 
                      onClick={() => setTopSubTab("win")}
                      className="flex-1 py-1.5 text-xs font-medium transition-all"
                      style={{ 
                        backgroundColor: topSubTab === "win" ? '#ffffff' : 'transparent',
                        color: topSubTab === "win" ? '#000000' : '#6a7a7a',
                        borderRadius: '16px'
                      }}
                    >
                      Win
                    </button>
                    <button 
                      onClick={() => setTopSubTab("rounds")}
                      className="flex-1 py-1.5 text-xs font-medium transition-all"
                      style={{ 
                        backgroundColor: topSubTab === "rounds" ? '#ffffff' : 'transparent',
                        color: topSubTab === "rounds" ? '#000000' : '#6a7a7a',
                        borderRadius: '16px'
                      }}
                    >
                      Rounds
                    </button>
                  </div>
                  {/* Row 2: Day, Month, Year */}
                  <div className="flex items-center gap-0.5">
                    <button 
                      onClick={() => setTopTimeFilter("day")}
                      className="flex-1 py-1.5 text-xs font-medium transition-all"
                      style={{ 
                        backgroundColor: topTimeFilter === "day" ? '#ffffff' : 'transparent',
                        color: topTimeFilter === "day" ? '#000000' : '#6a7a7a',
                        borderRadius: '16px'
                      }}
                    >
                      Day
                    </button>
                    <button 
                      onClick={() => setTopTimeFilter("month")}
                      className="flex-1 py-1.5 text-xs font-medium transition-all"
                      style={{ 
                        backgroundColor: topTimeFilter === "month" ? '#ffffff' : 'transparent',
                        color: topTimeFilter === "month" ? '#000000' : '#6a7a7a',
                        borderRadius: '16px'
                      }}
                    >
                      Month
                    </button>
                    <button 
                      onClick={() => setTopTimeFilter("year")}
                      className="flex-1 py-1.5 text-xs font-medium transition-all"
                      style={{ 
                        backgroundColor: topTimeFilter === "year" ? '#ffffff' : 'transparent',
                        color: topTimeFilter === "year" ? '#000000' : '#6a7a7a',
                        borderRadius: '16px'
                      }}
                    >
                      Year
                    </button>
                  </div>
                </div>

                {/* Conditional content based on sub-tab selection */}
                {topSubTab === "rounds" ? (
                  <>
                    {/* Column Headers for Rounds */}
                    <div 
                      className="flex items-center justify-between px-2 py-1.5 text-[11px]"
                      style={{ color: '#6a7a7a' }}
                    >
                      <span>Date & Time</span>
                      <span>X</span>
                    </div>
                    
                    {/* Rounds List */}
                    {roundsData.map((round, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between"
                        style={{ 
                          padding: '10px 12px',
                          borderRadius: '12px',
                          marginBottom: '4px',
                          backgroundColor: '#252527'
                        }}
                      >
                        <span style={{ color: '#fff', fontSize: '12px' }}>{round.dateTime}</span>
                        <div className="flex items-center gap-2">
                          <span style={{ color: '#e879f9', fontSize: '12px' }}>{round.multiplier.toFixed(2)}x</span>
                          <button className="p-1 hover:bg-white/10 rounded">
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  /* Top Players List for X and Win sub-tabs */
                  topPlayers.map((player, idx) => (
                    <div 
                      key={idx}
                      style={{ 
                        padding: '10px 12px',
                        borderRadius: '12px',
                        marginBottom: '6px',
                        backgroundColor: '#252527'
                      }}
                    >
                      {/* Top row: Avatar, Username, Date, Icons */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-6 h-6 rounded-full overflow-hidden"
                            style={{ backgroundColor: '#8b5cf6' }}
                          >
                            <img 
                              src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${player.user}`}
                              alt={player.user}
                              className="w-full h-full"
                            />
                          </div>
                          <div>
                            <span style={{ color: '#fff', fontSize: '12px' }}>{player.user}</span>
                            <div style={{ color: '#6a7a7a', fontSize: '10px' }}>{player.date}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="p-1 hover:bg-white/10 rounded">
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                          </button>
                          <button className="p-1 hover:bg-white/10 rounded">
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      
                      {/* Bottom row: Stats */}
                      <div className="flex items-center justify-between">
                        <div>
                          <div style={{ color: '#6a7a7a', fontSize: '10px' }}>Bet ETB</div>
                          <div style={{ color: '#fff', fontSize: '12px' }}>{player.betETB.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                          <div style={{ color: '#6a7a7a', fontSize: '10px', marginTop: '2px' }}>Win ETB</div>
                          <div style={{ color: '#fff', fontSize: '12px' }}>{player.winETB.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                        </div>
                        <div className="text-right">
                          <div style={{ color: '#6a7a7a', fontSize: '10px' }}>Result</div>
                          <div style={{ color: '#a855f7', fontSize: '12px' }}>{player.result.toFixed(2)}x</div>
                          <div style={{ color: '#6a7a7a', fontSize: '10px', marginTop: '2px' }}>Round max.</div>
                          <div style={{ color: '#a855f7', fontSize: '12px' }}>{player.roundMax.toFixed(2)}x</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="p-4 text-center text-gray-500 text-xs">
                No bets yet
              </div>
            )}
          </div>
          
          {/* Footer - Inside left panel at bottom */}
          <div 
            data-av-section="left-footer"
            className="flex items-center justify-between px-3 py-3 mt-auto"
            style={{ borderTop: '1px solid #2c2d30' }}
          >
            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#6a7a7a" strokeWidth="1.5"/>
                <path d="M9 12L11 14L15 10" stroke="#6a7a7a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span style={{ color: '#6a7a7a', fontSize: '0.75rem' }}>Provably Fair Game</span>
            </div>
            <div style={{ fontSize: '0.7rem' }}>
              <span style={{ color: '#6a7a7a' }}>Powered by </span>
              <span style={{ color: '#e50539', fontWeight: 700, letterSpacing: '1px' }}>SPRIBE</span>
            </div>
          </div>
        </div>

        {/* Center - Game Area */}
        <div className="flex-1 flex flex-col" style={{ backgroundColor: '#101112' }} data-av-section="center">
          {/* Recent multipliers bar - separate from game area */}
          {!historyExpanded ? (
            <div 
              className="flex items-center gap-1.5 px-0.5 py-0.5 overflow-x-auto"
              style={{ backgroundColor: 'transparent' }}
            >
              {recentMultipliers.slice(0, 15).map((m, idx) => (
                <span 
                  key={idx}
                  className="text-xs font-bold whitespace-nowrap"
                  style={{ 
                    color: getMultiplierColor(m.value)
                  }}
                >
                  {m.value.toFixed(2)}x
                </span>
              ))}
              {/* Three dots button */}
              <button 
                onClick={() => setHistoryExpanded(true)}
                className="ml-auto px-2 py-1 rounded text-xs"
                style={{ backgroundColor: '#2c2d30', color: '#6a7a7a' }}
              >
                ...
              </button>
            </div>
          ) : (
            /* Expanded Round History */
            <div 
              className="p-1.5 rounded-md relative"
              style={{ backgroundColor: '#1b1c1d', border: '1px solid #2c2d30' }}
            >
              {/* Header with title and close button */}
              <div className="flex items-center justify-between mb-2">
                <span style={{ color: '#6a7a7a', fontSize: '12px' }}>Round History</span>
                <button 
                  onClick={() => setHistoryExpanded(false)}
                  className="w-5 h-5 flex items-center justify-center rounded"
                  style={{ backgroundColor: '#2c2d30', color: '#6a7a7a' }}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Multipliers in wrap layout */}
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {recentMultipliers.map((m, idx) => (
                  <span 
                    key={idx}
                    className="text-xs font-bold whitespace-nowrap"
                    style={{ 
                      color: getMultiplierColor(m.value)
                    }}
                  >
                    {m.value.toFixed(2)}x
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Game Canvas Area - Rounded Card */}
          <div 
            data-av-section="game-canvas"
            className="flex-1 relative overflow-hidden rounded-2xl"
            style={{ 
              background: '#0e0e0e',
              border: '1px solid #2c2d30'
            }}
          >
            {/* Background Radial Rays - SVG sunburst from bottom-left corner */}
            <div 
              className="absolute pointer-events-none"
              style={{
                bottom: '0',
                left: '0',
                width: '500%',
                height: '500%',
                transformOrigin: '0% 100%',
                opacity: 1,
                animation: gamePhase === "crashed" ? 'none' : 'sun-rotate 80s linear infinite'
              }}
            >
              <img 
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/bg-sun-zJAMLXRqO1HDTD1jPw1W8xVgD8Z5AB.svg"
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'translate(-50%, 50%)',
                  filter: 'brightness(1.3) contrast(1.1)'
                }}
              />
            </div>

            {/* Blue/Cyan glow effect - only during flying */}
            {gamePhase === "flying" && (
              <div 
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: 'radial-gradient(ellipse at 35% 50%, rgba(30, 120, 180, 0.4) 0%, rgba(20, 80, 140, 0.25) 35%, transparent 65%)'
                }}
              />
            )}

            {/* Game Content */}
            <div className="absolute inset-0 flex items-center justify-center">
              {gamePhase === "waiting" && (
                <div className="text-center flex flex-col items-center">
                  {/* UFC | Aviator Partnership Logo */}
                  <img 
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ufc-v3oHiU5tKGc7DaVbJ2QZ5VP4x8J3b6.svg"
                    alt="UFC | Aviator Official Partners"
                    style={{ width: '280px', height: 'auto', marginBottom: '20px' }}
                  />
                  
                  {/* Loading Progress Bar */}
                  <div 
                    className="relative mb-5"
                    style={{ width: '200px', height: '4px', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: '2px' }}
                  >
                    <div 
                      className="absolute left-0 top-0 h-full rounded-full"
                      style={{ 
                        width: `${((5 - waitingTimer) / 5) * 100}%`,
                        background: 'linear-gradient(90deg, #e5355d 0%, #ff6b6b 100%)',
                        transition: 'width 0.3s ease-out',
                        boxShadow: '0 0 8px rgba(229, 53, 93, 0.6)'
                      }}
                    />
                  </div>
                  
                  {/* SPRIBE Official Badge */}
                  <img 
                    src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/official-HKyWkOuCTmsSdkI5aaQRw0qbrypVKg.svg"
                    alt="SPRIBE Official Game"
                    style={{ width: '120px', height: 'auto' }}
                  />
                </div>
              )}
              
              {/* Red Airplane in bottom left - only during waiting */}
              {gamePhase === "waiting" && (
                <div 
                  className="absolute"
                  style={{
                    bottom: '2%',
                    left: '0%',
                    transform: 'rotate(-12deg)'
                  }}
                >
                  <img 
                    src={PLANE_FRAMES[0]}
                    alt="Aviator Plane"
                    style={{
                      width: '100px',
                      height: 'auto',
                      filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))'
                    }}
                  />
                </div>
              )}

              {gamePhase === "flying" && (() => {
                // Curve parameters based on config
                const maxVisibleX = 82; // When plane reaches this X, start scrolling
                const maxY = 70; // Max Y position (top)
                
                // Calculate curve progress based on multiplier
                // 1.00x = almost flat, 1.20x = slight rise, 1.80x = visible curve, 3.00x+ = steep climb
                const normalizedMultiplier = Math.max(0, multiplier - 1);
                const progress = Math.min(normalizedMultiplier / 3, 1); // 4x = full progress
                
                // Check if we've reached the right edge (need to scroll)
                const atRightEdge = progress >= 0.90;
                
                // Calculate scroll offset when at right edge - curve scrolls left, plane stays near right
                const scrollOffset = atRightEdge ? (progress - 0.90) * 150 : 0;
                
                // Bobbing animation when at right edge - smooth slow up/down movement for ENTIRE curve
                // Speed: 400ms per cycle (slower), Amplitude: 4% of height (gentle float)
                const bobAmount = atRightEdge ? Math.sin(bobOffset / 400) * 4 : 0;
                
                // Exponential curve function for smooth growth
                // y = x^2 creates the slow start, steep climb effect
                const getCurveY = (t: number) => {
                  return Math.pow(t, 2.2) * maxY;
                };
                
                // Current curve endpoint (where plane TAIL sits)
                // Keep plane 5-6% away from right edge so it doesn't touch the wall
                const planeMaxX = maxVisibleX - 6;
                const curveEndX = atRightEdge ? planeMaxX : progress * maxVisibleX;
                const curveEndY = getCurveY(progress) + bobAmount;
                
                // Generate smooth curve path - 60 FPS quality
                // When bobbing, the ENTIRE curve moves up/down together
                const generateCurvePath = () => {
                  const points: string[] = [];
                  const steps = 80; // More steps for smoother curve
                  
                  // Start from origin point (0, 100) which is bottom-left
                  // Apply bobbing to entire curve when at right edge
                  points.push(`M ${Math.max(0, -scrollOffset)} ${100 - bobAmount}`);
                  
                  for (let i = 0; i <= steps; i++) {
                    const t = (i / steps) * progress;
                    const x = progress > 0 ? (t / progress) * curveEndX - scrollOffset : 0;
                    // Apply bobbing to ALL points so entire curve moves together
                    const y = 100 - getCurveY(t) - bobAmount;
                    points.push(`L ${Math.max(0, x)} ${y}`);
                  }
                  return points.join(' ');
                };
                
                // Generate filled area under curve
                const generateFilledPath = () => {
                  const points: string[] = [];
                  const steps = 80;
                  
                  // Start from bottom-left corner (stays fixed at bottom)
                  points.push(`M ${Math.max(0, -scrollOffset)} 100`);
                  
                  // Draw along the curve - entire curve bobs together
                  for (let i = 0; i <= steps; i++) {
                    const t = (i / steps) * progress;
                    const x = progress > 0 ? (t / progress) * curveEndX - scrollOffset : 0;
                    // Apply bobbing to ALL points so entire curve moves together
                    const y = 100 - getCurveY(t) - bobAmount;
                    points.push(`L ${Math.max(0, x)} ${y}`);
                  }
                  
                  // Close path: go down to bottom, then back to start
                  points.push(`L ${curveEndX - scrollOffset} 100`);
                  points.push('Z');
                  
                  return points.join(' ');
                };
                
                return (
                <div className="relative w-full h-full overflow-hidden">
                  {/* Flying Curve Path with filled area */}
                  <svg 
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient id="curveGradient" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="rgba(139, 0, 30, 0.95)" />
                        <stop offset="40%" stopColor="rgba(120, 0, 25, 0.85)" />
                        <stop offset="70%" stopColor="rgba(100, 0, 20, 0.6)" />
                        <stop offset="100%" stopColor="rgba(80, 0, 15, 0.3)" />
                      </linearGradient>
                    </defs>
                    
                    {/* Filled area under curve - deep crimson red */}
                    <path
                      d={generateFilledPath()}
                      fill="url(#curveGradient)"
                    />
                    
                    {/* Curve stroke line - deep red */}
                    <path
                      d={generateCurvePath()}
                      fill="none"
                      stroke="#c41e3a"
                      strokeWidth="0.7"
                      strokeLinecap="round"
                    />
                  </svg>

                  {/* Plane - TOP of TAIL directly attached to curve end point */}
                  <div 
                    className="absolute"
                    style={{
                      // Position at curve endpoint
                      left: `${curveEndX - scrollOffset}%`,
                      bottom: `${curveEndY}%`,
                      // Move plane to close the gap completely - tail directly touches curve
                      transform: 'translate(-18px, 15px) rotate(-15deg)',
                      transformOrigin: 'left top',
                      // The server streams the multiplier ~5×/second; glide the
                      // plane between those samples on the compositor so the
                      // motion reads as 60fps instead of 5fps steps.
                      transition: 'left 0.2s linear, bottom 0.2s linear',
                      willChange: 'left, bottom',
                    }}
                  >
                    {/* All sprite frames are mounted once and pre-decoded; the
                        propeller cycles via CSS keyframes (see plane-prop-*),
                        so no React state churn and no remote <img src> swaps
                        mid-flight. */}
                    {PLANE_FRAMES.map((frame, idx) => (
                      <img
                        key={frame}
                        src={frame}
                        alt="Plane"
                        aria-hidden={idx !== 0}
                        decoding="async"
                        draggable={false}
                        style={{
                          width: '100px',
                          height: 'auto',
                          filter: 'drop-shadow(0 0 10px rgba(229, 5, 57, 0.5))',
                          position: idx === 0 ? 'relative' : 'absolute',
                          top: 0,
                          left: 0,
                          animation: `plane-prop-${idx} 0.4s steps(1, end) infinite`,
                          willChange: 'opacity',
                        }}
                      />
                    ))}
                  </div>

                  {/* Multiplier Display - centered */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div 
                      className="text-6xl font-bold"
                      style={{ 
                        color: '#fff',
                        textShadow: '0 0 40px rgba(255,255,255,0.4), 0 0 80px rgba(0, 180, 220, 0.2)'
                      }}
                    >
                      {multiplier.toFixed(2)}x
                    </div>
                  </div>
                </div>
                );
              })()}

              {gamePhase === "crashed" && (
                <div className="relative w-full h-full flex items-center justify-center">
                  {/* FLEW AWAY text - centered, no curve or plane visible */}
                  <div className="text-center z-10">
                    <div 
                      className="text-xl mb-1 font-medium"
                      style={{ color: '#e50539' }}
                    >
                      FLEW AWAY!
                    </div>
                    <div 
                      className="text-5xl font-bold"
                      style={{ color: '#e50539' }}
                    >
                      {multiplier.toFixed(2)}x
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Betting Controls */}
          <div 
            data-av-section="bet-controls"
            style={{ 
              backgroundColor: '#101112',
              padding: '4px'
            }}
          >
            <div className={`flex gap-1 ${showSinglePanel ? 'justify-center' : ''}`} data-av-section="bet-panels-row">
              {/* Bet Panel 1 - hidden when single panel mode */}
              {!showSinglePanel && (
              <div 
                className="flex-1 rounded-md"
                style={{ 
                  backgroundColor: '#1b1c1d', 
                  border: '1px solid #2a2b2d',
                  filter: gamePhase === "flying" ? 'blur(0.5px)' : 'none',
                  opacity: gamePhase === "flying" ? 0.95 : 1,
                  // The wide 60px side padding looks great at full width, but
                  // when the chat panel is open the center shrinks and that
                  // padding would squeeze the BET button into a tiny one. Relax
                  // it while chat is open so the buttons keep their size. (Mobile
                  // padding is overridden with !important in globals.css, so this
                  // only affects desktop.)
                  padding: chatPanelOpen ? '10px 18px 36px 18px' : '10px 60px 36px 60px'
                }}
              >
                {/* Bet/Auto tabs - centered at top */}
                <div className="flex justify-center mb-4">
                  <div 
                    className="flex p-0.5 rounded-full"
                    style={{ backgroundColor: '#0e0e0e', width: '120px' }}
                  >
                    <button 
                      onClick={() => setBetMode1("bet")}
                      className="flex-1 py-1 text-xs font-medium rounded-full"
                      style={{ backgroundColor: betMode1 === "bet" ? '#3a3b3d' : 'transparent', color: betMode1 === "bet" ? '#fff' : '#5a5a5a' }}
                    >
                      Bet
                    </button>
                    <button 
                      onClick={() => setBetMode1("auto")}
                      className="flex-1 py-1 text-xs font-medium rounded-full"
                      style={{ backgroundColor: betMode1 === "auto" ? '#3a3b3d' : 'transparent', color: betMode1 === "auto" ? '#fff' : '#5a5a5a' }}
                    >
                      Auto
                    </button>
                  </div>
                </div>

                {/* Two column layout: Left = controls, Right = bet button */}
                <div className="flex gap-2 items-start">
                  {/* Left column - Amount controls and quick amounts */}
                  <div style={{ width: '135px' }}>
                    {/* Amount controls - all inside one card */}
                    <div 
                      className="flex items-center rounded-full px-1.5 py-1 mb-1"
                      style={{ backgroundColor: '#0e0e0e' }}
                    >
                      <button 
                        onClick={() => setBetAmount1(Math.max(1, betAmount1 - 1))}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{ backgroundColor: '#3a3b3d', color: '#fff' }}
                      >
                        -
                      </button>
                      <div className="flex-1 text-center font-bold text-sm" style={{ color: '#fff' }}>
                        {betAmount1.toFixed(2)}
                      </div>
                      <button 
                        onClick={() => setBetAmount1(betAmount1 + 1)}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{ backgroundColor: '#3a3b3d', color: '#fff' }}
                      >
                        +
                      </button>
                    </div>

                    {/* Quick amounts - 2x2 grid */}
                    <div className="grid grid-cols-2 gap-1">
                      {[16, 40, 80, 400].map(amt => (
                        <button 
                          key={amt}
                          onClick={() => setBetAmount1(amt)}
                          className="py-2 rounded-full text-xs font-medium"
                          style={{ backgroundColor: '#0e0e0e', color: '#6a6a6a' }}
                        >
                          {amt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Right column - Bet button */}
                  <div className="flex-1 flex items-start pt-1">
                    {bet1Queued ? (
                      <button 
                        onClick={() => handleCancelBet(1)}
                        className="w-full font-bold text-white flex flex-col items-center justify-center"
                        style={{ backgroundColor: '#c81e1e', borderRadius: '8px', height: '72px' }}
                      >
                        <span className="text-base font-bold">CANCEL</span>
                        <span className="text-xs font-normal">Waiting for next round</span>
                      </button>
                    ) : !bet1Active ? (
                      <button 
                        onClick={() => handleBet(1)}
                        disabled={gamePhase === "crashed"}
                        className="w-full font-bold text-white disabled:opacity-50 flex flex-col items-center justify-center"
                        style={{ backgroundColor: '#28a909', borderRadius: '8px', height: '72px' }}
                      >
                        <div className="text-sm font-bold">BET</div>
                        <div className="text-base font-bold">{betAmount1.toFixed(2)} ETB</div>
                      </button>
                    ) : bet1CashedOut ? (
                      <button 
                        className="w-full font-bold text-white text-sm flex items-center justify-center"
                        style={{ backgroundColor: '#3d8f5f', borderRadius: '8px', height: '72px' }}
                      >
                        WON {(betAmount1 * bet1CashoutMultiplier).toFixed(2)} ETB
                      </button>
                    ) : gamePhase === "flying" ? (
                      <button 
                        onClick={() => handleCashout(1)}
                        className="w-full font-bold text-white flex flex-col items-center justify-center"
                        style={{ backgroundColor: '#c77b05', borderRadius: '8px', height: '72px' }}
                      >
                        <span className="text-base">Cash Out</span>
                        <span className="text-lg">{(betAmount1 * multiplier).toFixed(2)} <span className="text-base">ETB</span></span>
                      </button>
                    ) : (
                      <button 
                        onClick={() => handleCancelBet(1)}
                        className="w-full font-bold text-white flex flex-col items-center justify-center"
                        style={{ backgroundColor: '#c81e1e', borderRadius: '8px', height: '72px' }}
                      >
                        <span className="text-base font-bold">CANCEL</span>
                        <span className="text-xs font-normal">Waiting for next round</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Auto options row - only visible when Auto tab is selected */}
                {betMode1 === "auto" && (
                  <div className="flex items-center gap-2 mt-3">
                    {/* Auto Play button */}
                    <button 
                      onClick={() => autoPlay1 ? setAutoPlay1(false) : setShowAutoPlayPopup(1)}
                      className="px-3 py-1.5 rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: autoPlay1 ? '#dc2626' : '#28a909' }}
                    >
                      {autoPlay1 ? 'STOP' : 'AUTO PLAY'}
                    </button>
                    
                    {/* Auto Cash Out toggle */}
                    <span className="text-xs" style={{ color: '#6a6a6a' }}>Auto Cash Out</span>
                    <button 
                      onClick={() => setAutoCashout1(!autoCashout1)}
                      className="w-8 h-4 rounded-full relative"
                      style={{ backgroundColor: autoCashout1 ? '#28a909' : '#3a3b3d' }}
                    >
                      <div 
                        className="w-3 h-3 rounded-full absolute top-0.5 transition-all"
                        style={{ backgroundColor: '#fff', left: autoCashout1 ? '16px' : '2px' }}
                      />
                    </button>
                    
                    {/* Cashout value input */}
                    <input 
                      type="number"
                      value={autoCashoutValue1}
                      onChange={(e) => setAutoCashoutValue1(parseFloat(e.target.value) || 1.01)}
                      disabled={!autoCashout1}
                      className="w-14 px-2 py-1 text-xs text-center rounded"
                      style={{ backgroundColor: '#0e0e0e', color: autoCashout1 ? '#fff' : '#5a5a5a', border: '1px solid #3a3b3d' }}
                      step="0.01"
                      min="1.01"
                    />
                  </div>
                )}
              </div>
              )}

              {/* Bet Panel 2 */}
              <div 
                className={`${showSinglePanel ? 'w-full' : 'flex-1'} relative`}
                style={{ 
                  backgroundColor: '#1b1c1d', 
                  border: '1px solid #2a2b2d',
                  borderRadius: '12px',
                  filter: gamePhase === "flying" ? 'blur(0.5px)' : 'none',
                  opacity: gamePhase === "flying" ? 0.95 : 1,
                  padding: showSinglePanel
                    ? '12px 24px 20px 24px'
                    : (chatPanelOpen ? '10px 18px 36px 18px' : '10px 60px 36px 60px')
                }}
              >
                {/* Centered content wrapper for single panel mode */}
                <div className={showSinglePanel ? 'max-w-md mx-auto' : ''}>
                  {/* Header row with tabs and toggle */}
                  <div className="flex items-center justify-center mb-4 relative">
                    {/* Bet/Auto tabs - centered */}
                    <div 
                      className="flex p-0.5 rounded-full"
                      style={{ backgroundColor: '#0e0e0e', width: '140px' }}
                    >
                      <button 
                        onClick={() => setBetMode2("bet")}
                        className="flex-1 py-1.5 text-xs font-medium rounded-full"
                        style={{ backgroundColor: betMode2 === "bet" ? '#3a3b3d' : 'transparent', color: betMode2 === "bet" ? '#fff' : '#5a5a5a' }}
                      >
                        Bet
                      </button>
                      <button 
                        onClick={() => setBetMode2("auto")}
                        className="flex-1 py-1.5 text-xs font-medium rounded-full"
                        style={{ backgroundColor: betMode2 === "auto" ? '#3a3b3d' : 'transparent', color: betMode2 === "auto" ? '#fff' : '#5a5a5a' }}
                      >
                        Auto
                      </button>
                    </div>
                    
                    {/* Small icon - toggle single/dual panel */}
                    <button 
                      onClick={() => setShowSinglePanel(!showSinglePanel)}
                      className="absolute right-0 w-6 h-6 rounded flex items-center justify-center"
                      style={{ backgroundColor: 'transparent', border: `1px solid ${showSinglePanel ? '#28a909' : '#3a3b3d'}` }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke={showSinglePanel ? '#28a909' : '#5a5a5a'} strokeWidth="1.5" viewBox="0 0 24 24">
                        <path d="M4 8V4h4M4 16v4h4M16 4h4v4M16 20h4v-4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>

                  {/* Two column layout: Left = controls, Right = bet button */}
                  <div className="flex gap-2 items-start">
                    {/* Left column - Amount controls and quick amounts */}
                    <div style={{ width: showSinglePanel ? '140px' : '135px' }}>
                    {/* Amount controls - all inside one card */}
                    <div 
                      className="flex items-center rounded-full px-2 py-1.5 mb-2"
                      style={{ backgroundColor: '#0e0e0e' }}
                    >
                      <button 
                        onClick={() => setBetAmount2(Math.max(1, betAmount2 - 1))}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{ backgroundColor: '#3a3b3d', color: '#fff' }}
                      >
                        -
                      </button>
                      <div className="flex-1 text-center font-bold text-base" style={{ color: '#fff' }}>
                        {betAmount2.toFixed(2)}
                      </div>
                      <button 
                        onClick={() => setBetAmount2(betAmount2 + 1)}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{ backgroundColor: '#3a3b3d', color: '#fff' }}
                      >
                        +
                      </button>
                    </div>

                    {/* Quick amounts - 2x2 grid */}
                    <div className="grid grid-cols-2 gap-1">
                      {[16, 40, 80, 400].map(amt => (
                        <button 
                          key={amt}
                          onClick={() => setBetAmount2(amt)}
                          className="py-2 rounded-full text-xs font-medium"
                          style={{ backgroundColor: '#0e0e0e', color: '#6a6a6a' }}
                        >
                          {amt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Right column - Bet button */}
                  <div className="flex-1 flex items-start pt-1">
                    {bet2Queued ? (
                      <button 
                        onClick={() => handleCancelBet(2)}
                        className="w-full font-bold text-white flex flex-col items-center justify-center"
                        style={{ backgroundColor: '#c81e1e', borderRadius: '8px', height: '72px' }}
                      >
                        <span className="text-base font-bold">CANCEL</span>
                        <span className="text-xs font-normal">Waiting for next round</span>
                      </button>
                    ) : !bet2Active ? (
                      <button 
                        onClick={() => handleBet(2)}
                        disabled={gamePhase === "crashed"}
                        className="w-full font-bold text-white disabled:opacity-50 flex flex-col items-center justify-center"
                        style={{ backgroundColor: '#28a909', borderRadius: '8px', height: '72px' }}
                      >
                        <div className="text-sm font-bold">BET</div>
                        <div className="text-base font-bold">{betAmount2.toFixed(2)} ETB</div>
                      </button>
                    ) : bet2CashedOut ? (
                      <button 
                        className="w-full font-bold text-white text-sm flex items-center justify-center"
                        style={{ backgroundColor: '#3d8f5f', borderRadius: '8px', height: '72px' }}
                      >
                        WON {(betAmount2 * bet2CashoutMultiplier).toFixed(2)} ETB
                      </button>
                    ) : gamePhase === "flying" ? (
                      <button 
                        onClick={() => handleCashout(2)}
                        className="w-full font-bold text-white flex flex-col items-center justify-center"
                        style={{ backgroundColor: '#c77b05', borderRadius: '8px', height: '72px' }}
                      >
                        <span className="text-base">Cash Out</span>
                        <span className="text-lg">{(betAmount2 * multiplier).toFixed(2)} <span className="text-base">ETB</span></span>
                      </button>
                    ) : (
                      <button 
                        onClick={() => handleCancelBet(2)}
                        className="w-full font-bold text-white flex flex-col items-center justify-center"
                        style={{ backgroundColor: '#c81e1e', borderRadius: '8px', height: '72px' }}
                      >
                        <span className="text-base font-bold">CANCEL</span>
                        <span className="text-xs font-normal">Waiting for next round</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Auto options row - only visible when Auto tab is selected */}
                {betMode2 === "auto" && (
                  <div className="flex items-center gap-2 mt-3">
                    {/* Auto Play button */}
                    <button 
                      onClick={() => autoPlay2 ? setAutoPlay2(false) : setShowAutoPlayPopup(2)}
                      className="px-3 py-1.5 rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: autoPlay2 ? '#dc2626' : '#28a909' }}
                    >
                      {autoPlay2 ? 'STOP' : 'AUTO PLAY'}
                    </button>
                    
                    {/* Auto Cash Out toggle */}
                    <span className="text-xs" style={{ color: '#6a6a6a' }}>Auto Cash Out</span>
                    <button 
                      onClick={() => setAutoCashout2(!autoCashout2)}
                      className="w-8 h-4 rounded-full relative"
                      style={{ backgroundColor: autoCashout2 ? '#28a909' : '#3a3b3d' }}
                    >
                      <div 
                        className="w-3 h-3 rounded-full absolute top-0.5 transition-all"
                        style={{ backgroundColor: '#fff', left: autoCashout2 ? '16px' : '2px' }}
                      />
                    </button>
                    
                    {/* Cashout value input */}
                    <input 
                      type="number"
                      value={autoCashoutValue2}
                      onChange={(e) => setAutoCashoutValue2(parseFloat(e.target.value) || 1.01)}
                      disabled={!autoCashout2}
                      className="w-14 px-2 py-1 text-xs text-center rounded"
                      style={{ backgroundColor: '#0e0e0e', color: autoCashout2 ? '#fff' : '#5a5a5a', border: '1px solid #3a3b3d' }}
                      step="0.01"
                      min="1.01"
                    />
                  </div>
                )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Chat Panel - Right Side */}
        {chatPanelOpen && (
          <div 
            className="flex-shrink-0 flex flex-col m-1 h-full"
            style={{ 
              width: '280px',
              maxHeight: 'calc(100vh - 60px)',
              backgroundColor: '#101112',
              borderRadius: '16px',
              border: '1px solid #2c2d30',
              overflow: 'hidden'
            }}
          >
            {/* Chat Header */}
            <div 
              className="flex items-center justify-between px-4 py-3 flex-shrink-0"
              style={{ borderBottom: '1px solid #2c2d30' }}
            >
              <div className="flex items-center gap-2">
                <div 
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: '#22c55e' }}
                />
                <span className="text-white font-medium">402</span>
              </div>
              <button 
                onClick={() => setChatPanelOpen(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Chat Messages List */}
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              {/* Free bet offers and regular messages */}
              {chatMessages.map((msg, idx) => (
                <div 
                  key={idx}
                  className="flex items-center justify-between px-3 py-2 hover:bg-white/5"
                  style={{ 
                    borderBottom: '1px solid #1a1b1e',
                    backgroundColor: msg.isFreeBetOffer ? '#166534' : 'transparent'
                  }}
                >
                  {msg.isFreeBetOffer ? (
                    <>
                      <span 
                        className="text-sm font-bold"
                        style={{ color: '#ffffff' }}
                      >
                        {msg.freeBetAmount?.toFixed(2)} ETB
                      </span>
                      <button
                        onClick={() => msg.freeBetId && msg.freeBetAmount && handleClaimFreeBet(msg.freeBetId, msg.freeBetAmount)}
                        className="px-4 py-1 rounded text-xs font-bold uppercase"
                        style={{ 
                          backgroundColor: '#facc15',
                          color: '#000000'
                        }}
                      >
                        Claim
                      </button>
                    </>
                  ) : (
                    <>
                      <span 
                        className="text-sm"
                        style={{ color: msg.color || '#6b7280' }}
                      >
                        {msg.message}
                      </span>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
                          style={{ backgroundColor: msg.color || '#6b7280' }}
                        >
                          {msg.avatar}
                        </div>
                        <span className="text-white text-sm">{msg.user}</span>
                      </div>
                    </>
                  )}
                </div>
              ))}
              
              {/* Static chat entries */}
              {[
                { amount: '50.00', user: 'n***j', avatar: 'https://i.pravatar.cc/32?img=1' },
                { amount: '50.00', user: 'y***u', avatar: 'https://i.pravatar.cc/32?img=2' },
                { amount: '50.00', user: 'a***b', avatar: 'https://i.pravatar.cc/32?img=3' },
                { amount: '50.00', user: 'd***c', avatar: 'https://i.pravatar.cc/32?img=4' },
                { amount: '50.00', user: 'o***y', avatar: 'https://i.pravatar.cc/32?img=5' },
                { amount: '50.00', user: 'e***i', avatar: 'https://i.pravatar.cc/32?img=6' },
                { amount: '50.00', user: 'n***i', avatar: 'https://i.pravatar.cc/32?img=7' },
                { amount: '50.00', user: 'b***e', avatar: 'https://i.pravatar.cc/32?img=8' },
              ].map((msg, idx) => (
                <div 
                  key={`static-${idx}`}
                  className="flex items-center justify-between px-3 py-2 hover:bg-white/5"
                  style={{ borderBottom: '1px solid #1a1b1e' }}
                >
                  <span 
                    className="text-sm font-medium"
                    style={{ color: '#22c55e' }}
                  >
                    {msg.amount} ETB
                  </span>
                  <div className="flex items-center gap-2">
                    <img 
                      src={msg.avatar}
                      alt=""
                      className="w-6 h-6 rounded-full"
                    />
                    <span className="text-white text-sm">{msg.user}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Chat Input */}
            <div 
              className="flex-shrink-0 p-3 relative"
              style={{ borderTop: '1px solid #2c2d30' }}
            >
              {/* Emoji Picker Popup */}
              {showChatEmoji && (
                <div 
                  className="absolute bottom-full left-0 right-0 mb-2 p-2 rounded-lg max-h-48 overflow-y-auto scrollbar-hide"
                  style={{ backgroundColor: '#1a1b1e', border: '1px solid #2c2d30' }}
                >
                  <div className="grid grid-cols-8 gap-1">
                    {['😀', '😂', '😍', '🥰', '😎', '🤑', '🔥', '💰', '🎰', '✈️', '🚀', '💎', '🎯', '👍', '👏', '🙌', '💪', '🤞', '❤️', '💚', '💛', '🧡', '💜', '🖤', '😱', '😭', '🤯', '🥳', '🎉', '🎊', '⭐', '🌟'].map((emoji, idx) => (
                      <button
                        key={idx}
                        className="text-xl p-1 hover:bg-white/10 rounded"
                        onClick={() => {
                          setChatMessage(prev => prev + emoji)
                          setShowChatEmoji(false)
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* GIF Picker Popup */}
              {showChatGif && (
                <div 
                  className="absolute bottom-full left-0 right-0 mb-2 p-2 rounded-lg max-h-48 overflow-y-auto scrollbar-hide"
                  style={{ backgroundColor: '#1a1b1e', border: '1px solid #2c2d30' }}
                >
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif',
                      'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
                      'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif',
                      'https://media.giphy.com/media/3oEjHV0z8S7WM4MwnK/giphy.gif',
                    ].map((gif, idx) => (
                      <button
                        key={idx}
                        className="rounded overflow-hidden hover:opacity-80"
                        onClick={() => {
                          setChatMessage(prev => prev + ` [GIF] `)
                          setShowChatGif(false)
                        }}
                      >
                        <img src={gif} alt="GIF" className="w-full h-16 object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Input Field */}
              <div className="mb-2">
                <input
                  type="text"
                  placeholder="Reply"
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value.slice(0, 160))}
                  className="w-full bg-transparent text-sm outline-none"
                  style={{ color: '#4ade80' }}
                />
              </div>

              {/* Bottom Icons Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Emoji icon */}
                  <button 
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                    onClick={() => {
                      setShowChatEmoji(!showChatEmoji)
                      setShowChatGif(false)
                    }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  {/* GIF icon */}
                  <button 
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                    onClick={() => {
                      setShowChatGif(!showChatGif)
                      setShowChatEmoji(false)
                    }}
                  >
                    <span className="text-xs font-bold border border-gray-500 px-1.5 py-0.5 rounded">GIF</span>
                  </button>
                  {/* Fire icon - Opens Rain popup */}
                  <button 
                    className="text-orange-500 hover:text-orange-400 transition-colors"
                    onClick={() => setShowRainPopup(true)}
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 23c-3.866 0-7-3.134-7-7 0-3.052 2.021-6.195 4.034-8.612.949-1.139 1.915-2.129 2.664-2.87l.302-.295.302.295c.749.741 1.715 1.731 2.664 2.87C17.979 9.805 20 12.948 20 16c0 3.866-3.134 7-7 7zm0-16.174c-.604.624-1.298 1.391-1.966 2.193C8.146 11.317 6.5 13.899 6.5 16a5.5 5.5 0 0011 0c0-2.101-1.646-4.683-3.534-6.981-.668-.802-1.362-1.569-1.966-2.193zM12 20c-2.206 0-4-1.794-4-4 0-.702.28-1.507.673-2.358.33-.714.741-1.437 1.17-2.122.182-.29.366-.57.546-.833l.611-.86.611.86c.18.263.364.543.546.833.429.685.84 1.408 1.17 2.122.393.851.673 1.656.673 2.358 0 2.206-1.794 4-4 4z"/>
                    </svg>
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  {/* Character count */}
                  <span className="text-gray-500 text-xs">{160 - chatMessage.length}</span>
                  {/* Send button */}
                  <button 
                    className="text-gray-500 hover:text-green-400 transition-colors"
                    onClick={() => {
                      if (chatMessage.trim()) {
                        // Send message logic here
                        setChatMessage('')
                      }
                    }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        </div>

      {/* GIF Popup */}
      {showGifPopup && (
        <>
          <div 
            className="fixed inset-0 z-40"
            onClick={() => setShowGifPopup(false)}
          />
          <div 
            className="fixed z-50"
            style={{ 
              bottom: '70px',
              right: '10px',
              width: '280px'
            }}
          >
            <div 
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
              }}
            >
              <div 
                className="flex items-center justify-between px-3 py-2"
                style={{ backgroundColor: '#252525', borderBottom: '1px solid #333' }}
              >
                <span style={{ color: '#51b579', fontWeight: 600 }}>GIF</span>
                <button onClick={() => setShowGifPopup(false)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-2">
                <input
                  type="text"
                  placeholder="Search for GIFs..."
                  value={gifSearch}
                  onChange={e => setGifSearch(e.target.value)}
                  className="w-full px-3 py-2 rounded text-sm"
                  style={{ backgroundColor: '#252525', border: '1px solid #333', color: '#fff' }}
                />
              </div>
              <div className="grid grid-cols-2 gap-1 p-2" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                {[
                  'https://media.giphy.com/media/3oriO0OEd9QIDdllqo/giphy.gif',
                  'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
                  'https://media.giphy.com/media/26uf7LY5MJKJD1Tb2/giphy.gif',
                  'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif',
                ].map((gif, i) => (
                  <div 
                    key={i}
                    className="h-20 rounded cursor-pointer hover:opacity-80"
                    style={{ 
                      backgroundImage: `url(${gif})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}
                    onClick={() => setShowGifPopup(false)}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Rain Popup */}
      {showRainPopup && (
        <>
          <div 
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowRainPopup(false)}
          />
          <div 
            className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ 
              width: '300px'
            }}
          >
            <div 
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 10px 40px rgba(0,0,0,0.6)'
              }}
            >
              {/* Header */}
              <div 
                className="flex items-center justify-between px-4 py-3"
                style={{ backgroundColor: '#252525', borderBottom: '1px solid #333' }}
              >
                <span style={{ color: '#51b579', fontWeight: 700, fontSize: '1rem' }}>RAIN</span>
                <button onClick={() => setShowRainPopup(false)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4">
                <p className="text-gray-400 text-xs mb-5 leading-relaxed">
                  This feature gives selected amount to random users in chat.
                </p>
                
                {/* Amount per player */}
                <div className="mb-4">
                  <label className="text-gray-500 text-xs block mb-2">Amount per player, ETB</label>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setRainAmount(Math.max(1, rainAmount - 0.5))}
                      className="w-10 h-10 rounded-md flex items-center justify-center text-lg font-medium"
                      style={{ backgroundColor: '#2a2a2a', border: '1px solid #3a3a3a', color: '#888' }}
                    >-</button>
                    <div className="flex-1 text-center py-2 rounded-md font-semibold text-lg" style={{ backgroundColor: '#2a2a2a', border: '1px solid #3a3a3a', color: '#fff' }}>
                      {rainAmount.toFixed(2)}
                    </div>
                    <button 
                      onClick={() => setRainAmount(rainAmount + 0.5)}
                      className="w-10 h-10 rounded-md flex items-center justify-center text-lg font-medium"
                      style={{ backgroundColor: '#2a2a2a', border: '1px solid #3a3a3a', color: '#888' }}
                    >+</button>
                  </div>
                </div>
                
                {/* Number of players */}
                <div className="mb-4">
                  <label className="text-gray-500 text-xs block mb-2">Number of players</label>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setRainPlayers(Math.max(1, rainPlayers - 1))}
                      className="w-10 h-10 rounded-md flex items-center justify-center text-lg font-medium"
                      style={{ backgroundColor: '#2a2a2a', border: '1px solid #3a3a3a', color: '#888' }}
                    >-</button>
                    <div className="flex-1 text-center py-2 rounded-md font-semibold text-lg" style={{ backgroundColor: '#2a2a2a', border: '1px solid #3a3a3a', color: '#fff' }}>
                      {rainPlayers}
                    </div>
                    <button 
                      onClick={() => setRainPlayers(rainPlayers + 1)}
                      className="w-10 h-10 rounded-md flex items-center justify-center text-lg font-medium"
                      style={{ backgroundColor: '#2a2a2a', border: '1px solid #3a3a3a', color: '#888' }}
                    >+</button>
                  </div>
                </div>
                
                {/* Total */}
                <div className="mb-5">
                  <label className="text-gray-500 text-xs block mb-2">Total, ETB</label>
                  <div className="text-white font-bold text-xl">
                    {(rainAmount * rainPlayers).toFixed(2)}
                  </div>
                </div>
                
                {/* Rain Button */}
                <button 
                  onClick={() => {
                    // Keep wallet authoritative: this UI helper must not
                    // mutate real-money balance client-side.
                    const totalCost = rainAmount * rainPlayers
                    if (balance >= totalCost) {
                      setShowRainPopup(false)
                    }
                  }}
                  disabled={balance < rainAmount * rainPlayers}
                  className="w-full py-3 rounded-lg font-bold text-white text-base disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#51b579' }}
                >
                  RAIN {(rainAmount * rainPlayers).toFixed(2)} ETB
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Auto Play Options Popup */}
      {showAutoPlayPopup && (
        <>
          <div 
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowAutoPlayPopup(null)}
          />
          <div 
            className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: '420px' }}
          >
            <div 
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
                border: '1px solid #333'
              }}
            >
              {/* Header */}
              <div 
                className="flex items-center justify-between px-4 py-3"
                style={{ backgroundColor: '#252525', borderBottom: '1px solid #333' }}
              >
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>AUTO PLAY OPTIONS</span>
                <button onClick={() => setShowAutoPlayPopup(null)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4">
                {/* Number of Rounds */}
                <div className="text-center mb-4">
                  <span className="text-gray-400 text-sm">Number of Rounds:</span>
                  <div className="flex justify-center gap-2 mt-3">
                    {[10, 20, 50, 100].map(rounds => (
                      <button
                        key={rounds}
                        onClick={() => showAutoPlayPopup === 1 ? setAutoPlayRounds1(rounds) : setAutoPlayRounds2(rounds)}
                        className="px-4 py-2 rounded-full text-sm font-medium"
                        style={{ 
                          backgroundColor: (showAutoPlayPopup === 1 ? autoPlayRounds1 : autoPlayRounds2) === rounds ? '#3a3b3d' : '#0e0e0e',
                          color: (showAutoPlayPopup === 1 ? autoPlayRounds1 : autoPlayRounds2) === rounds ? '#fff' : '#6a6a6a',
                          border: '1px solid #3a3b3d'
                        }}
                      >
                        {rounds}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stop if cash decreases by */}
                <div 
                  className="flex items-center justify-between py-3 px-3 mb-2 rounded"
                  style={{ backgroundColor: '#252525', border: '1px solid #333' }}
                >
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => showAutoPlayPopup === 1 ? setStopOnDecrease1(!stopOnDecrease1) : setStopOnDecrease2(!stopOnDecrease2)}
                      className="w-10 h-5 rounded-full relative"
                      style={{ backgroundColor: (showAutoPlayPopup === 1 ? stopOnDecrease1 : stopOnDecrease2) ? '#28a909' : '#3a3b3d' }}
                    >
                      <div 
                        className="w-4 h-4 rounded-full absolute top-0.5 transition-all"
                        style={{ backgroundColor: '#fff', left: (showAutoPlayPopup === 1 ? stopOnDecrease1 : stopOnDecrease2) ? '22px' : '2px' }}
                      />
                    </button>
                    <span className="text-gray-300 text-sm">Stop if cash decreases by</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => showAutoPlayPopup === 1 ? setStopOnDecreaseValue1(Math.max(0, stopOnDecreaseValue1 - 1)) : setStopOnDecreaseValue2(Math.max(0, stopOnDecreaseValue2 - 1))}
                      className="w-7 h-7 rounded flex items-center justify-center text-sm"
                      style={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a', color: '#888' }}
                    >-</button>
                    <div className="w-14 text-center py-1 rounded text-sm" style={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a', color: '#fff' }}>
                      {(showAutoPlayPopup === 1 ? stopOnDecreaseValue1 : stopOnDecreaseValue2).toFixed(2)}
                    </div>
                    <button 
                      onClick={() => showAutoPlayPopup === 1 ? setStopOnDecreaseValue1(stopOnDecreaseValue1 + 1) : setStopOnDecreaseValue2(stopOnDecreaseValue2 + 1)}
                      className="w-7 h-7 rounded flex items-center justify-center text-sm"
                      style={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a', color: '#888' }}
                    >+</button>
                    <span className="text-gray-500 text-xs ml-1">ETB</span>
                  </div>
                </div>

                {/* Stop if cash increases by */}
                <div 
                  className="flex items-center justify-between py-3 px-3 mb-2 rounded"
                  style={{ backgroundColor: '#252525', border: '1px solid #333' }}
                >
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => showAutoPlayPopup === 1 ? setStopOnIncrease1(!stopOnIncrease1) : setStopOnIncrease2(!stopOnIncrease2)}
                      className="w-10 h-5 rounded-full relative"
                      style={{ backgroundColor: (showAutoPlayPopup === 1 ? stopOnIncrease1 : stopOnIncrease2) ? '#28a909' : '#3a3b3d' }}
                    >
                      <div 
                        className="w-4 h-4 rounded-full absolute top-0.5 transition-all"
                        style={{ backgroundColor: '#fff', left: (showAutoPlayPopup === 1 ? stopOnIncrease1 : stopOnIncrease2) ? '22px' : '2px' }}
                      />
                    </button>
                    <span className="text-gray-300 text-sm">Stop if cash increases by</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => showAutoPlayPopup === 1 ? setStopOnIncreaseValue1(Math.max(0, stopOnIncreaseValue1 - 1)) : setStopOnIncreaseValue2(Math.max(0, stopOnIncreaseValue2 - 1))}
                      className="w-7 h-7 rounded flex items-center justify-center text-sm"
                      style={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a', color: '#888' }}
                    >-</button>
                    <div className="w-14 text-center py-1 rounded text-sm" style={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a', color: '#fff' }}>
                      {(showAutoPlayPopup === 1 ? stopOnIncreaseValue1 : stopOnIncreaseValue2).toFixed(2)}
                    </div>
                    <button 
                      onClick={() => showAutoPlayPopup === 1 ? setStopOnIncreaseValue1(stopOnIncreaseValue1 + 1) : setStopOnIncreaseValue2(stopOnIncreaseValue2 + 1)}
                      className="w-7 h-7 rounded flex items-center justify-center text-sm"
                      style={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a', color: '#888' }}
                    >+</button>
                    <span className="text-gray-500 text-xs ml-1">ETB</span>
                  </div>
                </div>

                {/* Stop if single win exceeds */}
                <div 
                  className="flex items-center justify-between py-3 px-3 mb-4 rounded"
                  style={{ backgroundColor: '#252525', border: '1px solid #333' }}
                >
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => showAutoPlayPopup === 1 ? setStopOnSingleWin1(!stopOnSingleWin1) : setStopOnSingleWin2(!stopOnSingleWin2)}
                      className="w-10 h-5 rounded-full relative"
                      style={{ backgroundColor: (showAutoPlayPopup === 1 ? stopOnSingleWin1 : stopOnSingleWin2) ? '#28a909' : '#3a3b3d' }}
                    >
                      <div 
                        className="w-4 h-4 rounded-full absolute top-0.5 transition-all"
                        style={{ backgroundColor: '#fff', left: (showAutoPlayPopup === 1 ? stopOnSingleWin1 : stopOnSingleWin2) ? '22px' : '2px' }}
                      />
                    </button>
                    <span className="text-gray-300 text-sm">Stop if single win exceeds</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => showAutoPlayPopup === 1 ? setStopOnSingleWinValue1(Math.max(0, stopOnSingleWinValue1 - 1)) : setStopOnSingleWinValue2(Math.max(0, stopOnSingleWinValue2 - 1))}
                      className="w-7 h-7 rounded flex items-center justify-center text-sm"
                      style={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a', color: '#888' }}
                    >-</button>
                    <div className="w-14 text-center py-1 rounded text-sm" style={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a', color: '#fff' }}>
                      {(showAutoPlayPopup === 1 ? stopOnSingleWinValue1 : stopOnSingleWinValue2).toFixed(2)}
                    </div>
                    <button 
                      onClick={() => showAutoPlayPopup === 1 ? setStopOnSingleWinValue1(stopOnSingleWinValue1 + 1) : setStopOnSingleWinValue2(stopOnSingleWinValue2 + 1)}
                      className="w-7 h-7 rounded flex items-center justify-center text-sm"
                      style={{ backgroundColor: '#1a1a1a', border: '1px solid #3a3a3a', color: '#888' }}
                    >+</button>
                    <span className="text-gray-500 text-xs ml-1">ETB</span>
                  </div>
                </div>

                {/* Footer buttons */}
                <div className="flex justify-center gap-3">
                  <button 
                    onClick={() => {
                      // Reset all values for this panel
                      if (showAutoPlayPopup === 1) {
                        setAutoPlayRounds1(10)
                        setStopOnDecrease1(false)
                        setStopOnDecreaseValue1(0)
                        setStopOnIncrease1(false)
                        setStopOnIncreaseValue1(0)
                        setStopOnSingleWin1(false)
                        setStopOnSingleWinValue1(0)
                      } else {
                        setAutoPlayRounds2(10)
                        setStopOnDecrease2(false)
                        setStopOnDecreaseValue2(0)
                        setStopOnIncrease2(false)
                        setStopOnIncreaseValue2(0)
                        setStopOnSingleWin2(false)
                        setStopOnSingleWinValue2(0)
                      }
                    }}
                    className="px-6 py-2 rounded-full text-sm font-bold"
                    style={{ backgroundColor: '#d4a017', color: '#fff' }}
                  >
                    Reset
                  </button>
                  <button 
                    onClick={() => {
                      // Start auto play
                      if (showAutoPlayPopup === 1) {
                        setAutoPlay1(true)
                      } else {
                        setAutoPlay2(true)
                      }
                      setShowAutoPlayPopup(null)
                    }}
                    className="px-8 py-2 rounded-full text-sm font-bold"
                    style={{ backgroundColor: '#28a909', color: '#fff' }}
                  >
                    Start
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Game Limits Popup */}
      {showGameLimitsPopup && (
        <>
          <div 
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowGameLimitsPopup(false)}
          />
          <div 
            className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: '380px', maxWidth: '95vw' }}
          >
            <div 
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
                border: '1px solid #333'
              }}
            >
              {/* Header */}
              <div 
                className="flex items-center justify-between px-4 py-3"
                style={{ backgroundColor: '#1a1a1a', borderBottom: '1px solid #333' }}
              >
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>GAME LIMITS</span>
                <button onClick={() => setShowGameLimitsPopup(false)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              {/* Limits Content */}
              <div className="p-4 space-y-3">
                {/* Minimum bet */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Minimum bet ETB:</span>
                  <span 
                    className="px-4 py-1 rounded-full text-sm"
                    style={{ 
                      color: '#22c55e',
                      border: '1px solid #22c55e'
                    }}
                  >
                    2
                  </span>
                </div>

                {/* Maximum bet */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Maximum bet ETB:</span>
                  <span 
                    className="px-4 py-1 rounded-full text-sm"
                    style={{ 
                      color: '#22c55e',
                      border: '1px solid #22c55e'
                    }}
                  >
                    20000
                  </span>
                </div>

                {/* Maximum win */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Maximum win for one bet ETB:</span>
                  <span 
                    className="px-4 py-1 rounded-full text-sm"
                    style={{ 
                      color: '#22c55e',
                      border: '1px solid #22c55e'
                    }}
                  >
                    500000
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* My Bet History Popup */}
      {showBetHistoryPopup && (
        <>
          <div 
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowBetHistoryPopup(false)}
          />
          <div 
            className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: '480px', maxWidth: '95vw' }}
          >
            <div 
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
                border: '1px solid #333'
              }}
            >
              {/* Header */}
              <div 
                className="flex items-center justify-between px-4 py-3"
                style={{ backgroundColor: '#1a1a1a', borderBottom: '1px solid #333' }}
              >
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>
                  MY <span style={{ color: '#f59e0b' }}>BET</span> HISTORY
                </span>
                <button onClick={() => setShowBetHistoryPopup(false)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              {/* Table Header */}
              <div 
                className="grid grid-cols-4 px-4 py-3"
                style={{ borderBottom: '1px solid #333' }}
              >
                <span className="text-gray-500 text-xs">Date</span>
                <span className="text-gray-500 text-xs text-center">Bet ETB</span>
                <span className="text-gray-500 text-xs text-center">X</span>
                <span className="text-gray-500 text-xs text-right">Cash out ETB</span>
              </div>

              {/* Table Body */}
              <div className="min-h-[100px] max-h-[300px] overflow-y-auto">
                {betHistoryData.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <span className="text-gray-500 text-sm">No bet history yet</span>
                  </div>
                ) : (
                  betHistoryData.map((bet, index) => (
                    <div 
                      key={index}
                      className="grid grid-cols-4 px-4 py-2"
                      style={{ borderBottom: '1px solid #2a2a2a' }}
                    >
                      <span className="text-gray-400 text-xs">{bet.date}</span>
                      <span className="text-white text-xs text-center">{bet.betETB.toFixed(2)}</span>
                      <span className="text-xs text-center" style={{ color: bet.multiplier >= 2 ? '#22c55e' : '#ef4444' }}>
                        {bet.multiplier.toFixed(2)}x
                      </span>
                      <span className="text-white text-xs text-right">{bet.cashoutETB.toFixed(2)}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Load More Button */}
              <div className="flex justify-center py-4">
                <button 
                  className="px-6 py-2 text-sm rounded-full"
                  style={{ 
                    backgroundColor: 'transparent',
                    color: '#6b7280',
                    border: '1px solid #3a3b3d'
                  }}
                >
                  Load more
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Free Bets Management Popup */}
      {showFreeBetsPopup && (
        <>
          <div 
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowFreeBetsPopup(false)}
          />
          <div 
            className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: '420px', maxWidth: '95vw' }}
          >
            <div 
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
                border: '1px solid #333'
              }}
            >
              {/* Header */}
              <div 
                className="flex items-center justify-between px-4 py-3"
                style={{ backgroundColor: '#252525', borderBottom: '1px solid #333' }}
              >
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>FREE BETS MANAGEMENT</span>
                <button onClick={() => setShowFreeBetsPopup(false)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              {/* Play with cash option */}
              <div className="p-4">
                <button
                  onClick={() => setPlayWithCash(true)}
                  className="flex items-center gap-3 w-full p-3 rounded"
                  style={{
                    backgroundColor: '#1e1e1e',
                    border: playWithCash ? '1px solid #28a909' : '1px solid #333'
                  }}
                >
                  <div 
                    className="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                    style={{ borderColor: playWithCash ? '#28a909' : '#666' }}
                  >
                    {playWithCash && (
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#28a909' }} />
                    )}
                  </div>
                  <span className="text-white text-sm">Play with cash</span>
                </button>
              </div>

              {/* Active Free Bets section */}
              <div className="px-4 pb-4">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-gray-400 text-xs font-medium">ACTIVE FREE BETS</span>
                  <button 
                    onClick={() => setShowFreeBetsArchive(!showFreeBetsArchive)}
                    className="px-3 py-1 text-xs rounded"
                    style={{ 
                      backgroundColor: 'transparent',
                      color: '#6b7280',
                      border: '1px solid #3a3b3d'
                    }}
                  >
                    Archive
                  </button>
                </div>

                {/* Free bets list or empty state */}
                {activeFreeBets.length > 0 ? (
                  <div className="space-y-2">
                    {activeFreeBets.map((bet, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between p-3 rounded"
                        style={{ backgroundColor: '#1e1e1e', border: '1px solid #333' }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm" style={{ color: '#22c55e' }}>
                            {bet.amount.toFixed(2)} ETB
                          </span>
                          <span className="text-xs text-gray-500">
                            Claimed at {bet.claimedAt}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setFreeBetsBalance(prev => prev - bet.amount)
                            setActiveFreeBets(prev => prev.filter((_, i) => i !== idx))
                          }}
                          className="px-3 py-1 text-xs rounded"
                          style={{ 
                            backgroundColor: '#28a909',
                            color: '#fff'
                          }}
                        >
                          Use
                        </button>
                      </div>
                    ))}
                    <div className="text-center pt-2">
                      <span className="text-xs text-gray-400">
                        Total: <span style={{ color: '#22c55e' }}>{freeBetsBalance.toFixed(2)} ETB</span>
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8">
                    {/* Ticket icon */}
                    <svg 
                      className="w-16 h-16 mb-4" 
                      viewBox="0 0 64 64" 
                      fill="none"
                      style={{ opacity: 0.5 }}
                    >
                      <rect x="8" y="16" width="48" height="32" rx="4" stroke="#666" strokeWidth="2" fill="none" />
                      <rect x="14" y="22" width="36" height="20" rx="2" stroke="#666" strokeWidth="1.5" fill="none" />
                      <circle cx="20" cy="32" r="3" stroke="#666" strokeWidth="1.5" fill="none" />
                      <path d="M26 28h18M26 32h14M26 36h10" stroke="#666" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M4 28v8M60 28v8" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 2" />
                    </svg>
                    <span className="text-gray-400 text-sm">No Active Free Bets. Yet!</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Avatar Selection Popup */}
      {showAvatarPopup && (
        <>
          <div 
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowAvatarPopup(false)}
          />
          <div 
            className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: '580px', maxWidth: '95vw', maxHeight: '90vh' }}
          >
            <div 
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
                border: '1px solid #333',
                display: 'flex',
                flexDirection: 'column',
                maxHeight: '90vh'
              }}
            >
              {/* Header */}
              <div 
                className="flex items-center justify-between px-4 py-3 shrink-0"
                style={{ backgroundColor: '#252525', borderBottom: '1px solid #333' }}
              >
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>CHOOSE GAME AVATAR</span>
                <button onClick={() => setShowAvatarPopup(false)} className="text-gray-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              {/* Avatar Grid */}
              <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 120px)' }}>
                <div className="grid grid-cols-9 gap-2">
                  {Array.from({ length: 63 }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedAvatar(i)}
                      className="relative aspect-square rounded-full overflow-hidden transition-all"
                      style={{
                        backgroundColor: '#2a2a2a',
                        border: selectedAvatar === i ? '3px solid #28a909' : '3px solid transparent'
                      }}
                    >
                      <img 
                        src={AVATAR_IMAGES[i % AVATAR_IMAGES.length]}
                        alt={`Avatar ${i + 1}`}
                        className="w-full h-full object-cover rounded-full"
                        crossOrigin="anonymous"
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Footer with Close button */}
              <div 
                className="flex justify-center py-3 shrink-0"
                style={{ backgroundColor: '#252525', borderTop: '1px solid #333' }}
              >
                <button 
                  onClick={() => setShowAvatarPopup(false)}
                  className="px-8 py-2 text-sm rounded"
                  style={{ 
                    backgroundColor: 'transparent',
                    color: '#6b7280',
                    border: '1px solid #3a3b3d'
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
