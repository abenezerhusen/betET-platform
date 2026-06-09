"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Heart, RotateCcw, Maximize2, Settings, Play, History, Check, BarChart3, Menu, Smile, Send, X, MessageCircle } from "lucide-react"
import {
  connectGameSocket,
  disconnectGameSocket,
  ensureGameToken,
  fetchPlayerMe,
  getKenoRound,
  placeKenoBet,
  readBalance,
  type KenoNumberDrawnEvent,
  type KenoRoundCompleteEvent,
  type KenoRoundStartEvent,
} from "@/lib/game-engine"
import { goBackToParent } from "@/lib/embed-nav"
import { useBalanceToast } from "@/components/balance-toast"
import { useStageScale } from "@/hooks/use-stage-scale"

// Bet type
interface Bet {
  id: number | string
  user: string
  numbers: number[]
  amount: number
  status: "waiting" | "drawing" | "won" | "lost"
  winAmount?: number
  matchedNumbers?: number[]
  // Round this bet was placed in — used in the My Tickets / History panels
  // to match a bet to its drawn numbers. Optional so the legacy "other
  // players" mock data stays valid.
  roundId?: number | string
}

// Game round history
interface GameRound {
  id: number | string
  drawnNumbers: number[]
  timestamp: Date
}

export default function FastKenoPage() {
  const router = useRouter()
  const { notify: notifyBalance, toast: balanceToast } = useBalanceToast()
  useStageScale()
  
  // Game state — drawnNumbers, gamePhase and roundId are populated by
  // Socket.io events emitted from the backend keno-loop worker (Section 17
  // spec). Balance comes from /api/users/me.
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([])
  const [drawnNumbers, setDrawnNumbers] = useState<number[]>([])
  const [currentDrawIndex, setCurrentDrawIndex] = useState(0)
  const [gamePhase, setGamePhase] = useState<"betting" | "drawing" | "result">("betting")
  const [betAmount, setBetAmount] = useState(2.00)
  const [balance, setBalance] = useState(0)
  const [roundTimer, setRoundTimer] = useState(30) // 30-second betting window
  const [roundId, setRoundId] = useState<string>("")
  // Track in-flight bets so we can correlate server `round_complete` events
  // back to the player's slips.
  const myBetsRef = useRef<Bet[]>([])
  
  // Header state
  const [practiceMode, setPracticeMode] = useState(true)
  const [isFavorite, setIsFavorite] = useState(false)
  
  // Sidebar state
  const [activeTab, setActiveTab] = useState<"game" | "history" | "results" | "stats">("game")
  const [activeSubTab, setActiveSubTab] = useState<"all" | "myTickets" | "myBets">("all")
  const [playerId] = useState(241009)
  
  // Bets state
  const [allBets, setAllBets] = useState<Bet[]>([
    { id: 1, user: "p***n", numbers: [36, 46, 54], amount: 2, status: "waiting" },
    { id: 2, user: "a***k", numbers: [12, 25, 38, 44, 67], amount: 5, status: "waiting" },
    { id: 3, user: "m***r", numbers: [7, 19, 33, 41, 55, 72], amount: 10, status: "waiting" },
  ])
  const [myBets, setMyBets] = useState<Bet[]>([])
  
  // Game history - 20 numbers drawn per round
  const [gameHistory, setGameHistory] = useState<GameRound[]>([
    { id: 1000, drawnNumbers: [3, 8, 15, 19, 22, 28, 34, 37, 41, 45, 52, 55, 58, 63, 67, 71, 74, 77, 79, 80], timestamp: new Date() },
    { id: 999, drawnNumbers: [2, 8, 11, 17, 23, 27, 33, 39, 45, 48, 51, 56, 62, 65, 69, 72, 74, 76, 78, 80], timestamp: new Date() },
  ])
  
  // Chat state
  const [onlineCount, setOnlineCount] = useState(401)
  const [chatMessage, setChatMessage] = useState("")
  const [chatMessages, setChatMessages] = useState([
    { id: 1, user: "d***v", message: "Rain operator", likes: 1, avatar: "blue" },
    { id: 2, user: "d***v", message: "@e***l Rain bro", likes: 0, avatar: "yellow" },
    { id: 3, user: "w***j", message: "Wahte naw", likes: 0, avatar: "gray" },
    { id: 4, user: "y***t", message: "Hlo", likes: 1, avatar: "green" },
    { id: 5, user: "i***n", message: "Diposite aydergm", likes: 0, avatar: "blue" },
    { id: 6, user: "f***m", message: "1000510468035", likes: 0, avatar: "yellow" },
    { id: 7, user: "f***m", message: "@c***t", likes: 1, avatar: "yellow" },
    { id: 8, user: "f***m", message: "withdraw yemideregewu endet naw", likes: 0, avatar: "yellow" },
    { id: 9, user: "f***t", message: "pls rain", likes: 0, avatar: "pink" },
    { id: 10, user: "i***n", message: "@m***f @i***y", likes: 0, avatar: "green" },
  ])

  // Hot/cold number indicators (calculated from history)
  const [hotNumbers, setHotNumbers] = useState<number[]>([5, 21, 37, 57])
  const [coldNumbers, setColdNumbers] = useState<number[]>([38, 54])
  
  // Popup states
  const [showGifPopup, setShowGifPopup] = useState(false)
  const [showRainPopup, setShowRainPopup] = useState(false)
  const [gifSearch, setGifSearch] = useState("")
  const [rainAmount, setRainAmount] = useState(2.00)
  const [rainPlayers, setRainPlayers] = useState(3)
  // Mobile-only: controls whether the right chat sidebar is visible.
  // On desktop (>= 768px) the right sidebar is always visible via CSS,
  // so this state only has an effect on mobile.
  const [showMobileChat, setShowMobileChat] = useState(false)

  const maxNumbers = 10 // Player can choose 1-10 numbers
  const totalNumbers = 80 // Numbers 1-80 available
  const drawCount = 20 // 20 numbers drawn per round

  // Payout table based on picks and matches
  // All winning ball combinations have corresponding odds which is multiplied by the player's bet amount
  // The winning combination is calculated as the ratio of the number of balls bet to the number of guessed balls
  const getPayoutMultiplier = (picks: number, matches: number): number => {
    const payoutTable: { [key: number]: { [key: number]: number } } = {
      1: { 1: 3.5 },
      2: { 1: 1, 2: 10 },
      3: { 2: 1.5, 3: 50 },
      4: { 2: 1, 3: 10, 4: 80 },
      5: { 3: 3, 4: 30, 5: 150 },
      6: { 3: 2, 4: 15, 5: 60, 6: 500 },
      7: { 0: 1, 4: 4, 5: 20, 6: 80, 7: 1000 },
      8: { 0: 1, 5: 5, 6: 50, 7: 200, 8: 2000 },
      9: { 0: 2, 5: 2, 6: 10, 7: 125, 8: 1000, 9: 5000 },
      10: { 0: 2, 5: 5, 6: 30, 7: 100, 8: 300, 9: 2000, 10: 10000 },
    }
    return payoutTable[picks]?.[matches] || 0
  }

  // Calculate winnings for a bet — purely a presentation helper; the
  // server has already settled the bet and credited the wallet, so this
  // is just so the UI can highlight which of *my* picks matched.
  const calculateWinnings = (bet: Bet, drawn: number[]): { won: boolean; matches: number[]; winAmount: number } => {
    const matches = bet.numbers.filter(n => drawn.includes(n))
    const multiplier = getPayoutMultiplier(bet.numbers.length, matches.length)
    const winAmount = bet.amount * multiplier
    return {
      won: winAmount > 0,
      matches,
      winAmount
    }
  }

  // Keep ref in sync so the socket handler (mount-only) can always read
  // the latest list of my bets.
  useEffect(() => {
    myBetsRef.current = myBets
  }, [myBets])

  // ============================================================
  // Backend integration — Section 17 spec
  // ============================================================
  useEffect(() => {
    let cancelled = false
    let socket: ReturnType<typeof connectGameSocket> = null

    const onStart = (ev: KenoRoundStartEvent) => {
      setRoundId(ev.round_id)
      setGamePhase("betting")
      setSelectedNumbers([])
      setDrawnNumbers([])
      setCurrentDrawIndex(0)
      setRoundTimer(ev.betting_seconds ?? 30)
      // New round → reset my-bets and all-bets so the table doesn't show
      // stale rows from the previous draw.
      setMyBets([])
      setAllBets([])
    }

    const onNumberDrawn = (ev: KenoNumberDrawnEvent) => {
      setGamePhase("drawing")
      setDrawnNumbers((prev) => {
        if (prev.includes(ev.number)) return prev
        return [...prev, ev.number]
      })
      setCurrentDrawIndex((prev) => prev + 1)
    }

    const onComplete = (ev: KenoRoundCompleteEvent) => {
      setDrawnNumbers(ev.all_numbers)
      setCurrentDrawIndex(ev.all_numbers.length)
      setGamePhase("result")

      // Settle my bets locally for visual feedback. We rely on
      // fetchPlayerMe() below to refresh the authoritative balance.
      setMyBets((prev) =>
        prev.map((bet) => {
          if (bet.roundId !== ev.round_id) return bet
          const result = calculateWinnings(bet, ev.all_numbers)
          return {
            ...bet,
            status: result.won ? ("won" as const) : ("lost" as const),
            matchedNumbers: result.matches,
            winAmount: result.winAmount,
          }
        }),
      )
      setAllBets((prev) =>
        prev.map((bet) =>
          bet.roundId === ev.round_id
            ? { ...bet, status: "drawing" as const }
            : bet,
        ),
      )
      setGameHistory((prev) => [
        { id: ev.round_id, drawnNumbers: ev.all_numbers, timestamp: new Date() },
        ...prev.slice(0, 9),
      ])
      setHotNumbers(ev.all_numbers.slice(0, 4))
      const cold: number[] = []
      for (let i = 1; i <= 80 && cold.length < 4; i++) {
        if (!ev.all_numbers.includes(i)) cold.push(i)
      }
      setColdNumbers(cold.slice(0, 2))

      // Refresh balance from server so any winnings are accurately
      // reflected without trusting the client-side multiplier table.
      fetchPlayerMe()
        .then((me) => setBalance(readBalance(me)))
        .catch(() => {})
    }

    // Resolve a token first (live: iframe token; local dev: auto-minted
    // seeded-player token) so the game always opens, then hydrate wallet +
    // round and subscribe to the live feed.
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

      // Snapshot the current round in case the page joins mid-game.
      getKenoRound()
        .then((snap) => {
          if (cancelled) return
          if (snap.round_id) setRoundId(snap.round_id)
          if (snap.phase === "betting" || snap.phase === "drawing" || snap.phase === "complete") {
            setGamePhase(snap.phase === "complete" ? "result" : snap.phase)
          }
          if (Array.isArray(snap.numbers_drawn) && snap.numbers_drawn.length > 0) {
            setDrawnNumbers(snap.numbers_drawn)
            setCurrentDrawIndex(snap.numbers_drawn.length)
          }
          if (typeof snap.time_remaining === "number") {
            setRoundTimer(Math.max(0, Math.min(30, snap.time_remaining)))
          }
        })
        .catch(() => {
          /* worker may not have spun up yet — ignore */
        })

      socket = connectGameSocket("keno")
      if (!socket) return
      socket.on("keno:round_start", onStart)
      socket.on("keno:number_drawn", onNumberDrawn)
      socket.on("keno:round_complete", onComplete)
    })()

    return () => {
      cancelled = true
      if (socket) {
        socket.off("keno:round_start", onStart)
        socket.off("keno:number_drawn", onNumberDrawn)
        socket.off("keno:round_complete", onComplete)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cosmetic countdown in the betting phase — authoritative timing comes
  // from the server, but ticking the visible counter every second feels
  // responsive.
  useEffect(() => {
    if (gamePhase !== "betting") return
    const interval = setInterval(() => {
      setRoundTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(interval)
  }, [gamePhase])

  // Disconnect socket on page unmount so we don't leak listeners.
  useEffect(() => {
    return () => {
      disconnectGameSocket()
    }
  }, [])

  const toggleNumber = (num: number) => {
    if (gamePhase !== "betting") return
    
    if (selectedNumbers.includes(num)) {
      setSelectedNumbers(selectedNumbers.filter(n => n !== num))
    } else if (selectedNumbers.length < maxNumbers) {
      setSelectedNumbers([...selectedNumbers, num].sort((a, b) => a - b))
    }
  }

  const adjustBet = (increment: boolean) => {
    if (increment) {
      setBetAmount(prev => Math.min(prev + 1, 1000))
    } else {
      setBetAmount(prev => Math.max(prev - 1, 1))
    }
  }

  const doubleBet = () => {
    setBetAmount(prev => Math.min(prev * 2, 1000))
  }

  const maxBet = () => {
    setBetAmount(Math.min(balance, 1000))
  }

  const clearSelection = () => {
    if (gamePhase === "betting") {
      setSelectedNumbers([])
    }
  }

  const quickPick = () => {
    if (gamePhase !== "betting") return
    const picks: number[] = []
    while (picks.length < maxNumbers) {
      const n = Math.floor(Math.random() * 80) + 1
      if (!picks.includes(n)) picks.push(n)
    }
    setSelectedNumbers(picks.sort((a, b) => a - b))
  }

  const placeBet = async () => {
    if (selectedNumbers.length === 0 || gamePhase !== "betting") return
    if (balance < betAmount) {
      notifyBalance("Insufficient balance — please deposit")
      return
    }
    if (!roundId) return

    try {
      const res = await placeKenoBet({
        round_id: roundId,
        selected_numbers: [...selectedNumbers],
        spots: selectedNumbers.length,
        amount: betAmount,
      })
      setBalance(res.balance_after)
      const newBet: Bet = {
        id: res.bet_id,
        user: "You",
        numbers: [...selectedNumbers],
        amount: betAmount,
        status: "waiting",
        roundId,
      }
      setMyBets((prev) => [...prev, newBet])
      setAllBets((prev) => [...prev, { ...newBet, user: "p***n" }])
      setSelectedNumbers([])
    } catch (err) {
      console.error("Keno bet failed", err)
      const msg = err instanceof Error ? err.message : ""
      notifyBalance(/insufficient/i.test(msg) ? "Insufficient balance — please deposit" : "Bet failed")
    }
  }

  const sendChatMessage = () => {
    if (!chatMessage.trim()) return
    const newMsg = {
      id: Date.now(),
      user: "p***n",
      message: chatMessage,
      likes: 0,
      avatar: "yellow"
    }
    setChatMessages(prev => [...prev, newMsg])
    setChatMessage("")
  }

  const likeMessage = (id: number) => {
    setChatMessages(prev => prev.map(msg => 
      msg.id === id ? { ...msg, likes: msg.likes + 1 } : msg
    ))
  }

  const isSelected = (num: number) => selectedNumbers.includes(num)
  const isDrawn = (num: number) => drawnNumbers.slice(0, currentDrawIndex).includes(num)
  const isMatch = (num: number) => isSelected(num) && isDrawn(num)

  // Get number button style based on state
  const getNumberStyle = (num: number) => {
    if (gamePhase === "drawing" || gamePhase === "result") {
      if (isMatch(num)) {
        return { background: '#22c55e', color: '#ffffff', boxShadow: '0 0 10px #22c55e' }
      }
      if (isDrawn(num)) {
        return { background: '#dc2626', color: '#ffffff' }
      }
      if (isSelected(num)) {
        return { background: '#22c55e', color: '#ffffff', opacity: 0.6 }
      }
    } else if (isSelected(num)) {
      return { background: '#22c55e', color: '#ffffff' }
    }
    return { background: 'linear-gradient(180deg, #333f46, #242b31)', color: '#a0a0a0' }
  }

  // Filter bets based on active sub tab
  const getFilteredBets = () => {
    if (activeSubTab === "myBets") return myBets
    if (activeSubTab === "myTickets") return myBets.filter(b => b.status === "won")
    return allBets
  }

  // Simulate online count changes
  useEffect(() => {
    const interval = setInterval(() => {
      setOnlineCount(prev => prev + Math.floor(Math.random() * 5) - 2)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="fk-stage-wrapper">
    <div 
      className="fk-page min-h-screen text-white overflow-hidden"
      data-show-mobile-chat={showMobileChat ? "true" : undefined}
      style={{
        backgroundImage: "url('https://hebbkx1anhila5yf.public.blob.vercel-storage.com/bg-mSSL4UFL5WLvBmuUQsAC0aIgxOpHmP.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      {balanceToast}
      {/* Header */}
      <div className="bg-[#1a1f2e]/95 border-b border-slate-700/50" data-fk-section="desktop-header">
        <div className="flex items-center justify-between px-3 py-2">
          {/* Left - Back Button */}
          <button 
            onClick={() => goBackToParent(() => router.push("/"))}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-sm font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          
          {/* Center - Round Info */}
          <div className="text-xs text-slate-400" data-fk-section="round-info">
            Round #{roundId}
          </div>
          
          {/* Right - Controls */}
          <div className="flex items-center gap-2">
            {/* Practice Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPracticeMode(!practiceMode)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  practiceMode ? "bg-pink-500" : "bg-slate-600"
                }`}
              >
                <div 
                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    practiceMode ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
              <span className="text-xs font-medium text-white">PRACTICE</span>
            </div>
            
            {/* Favorite */}
            <button 
              onClick={() => setIsFavorite(!isFavorite)}
              className="p-1.5 hover:bg-slate-700/50 rounded transition-colors"
            >
              <Heart className={`w-4 h-4 ${isFavorite ? "fill-pink-500 text-pink-500" : "text-slate-400"}`} />
            </button>
            
            {/* Refresh */}
            <button 
              onClick={clearSelection}
              className="p-1.5 hover:bg-slate-700/50 rounded transition-colors"
            >
              <RotateCcw className="w-4 h-4 text-slate-400" />
            </button>
            
            {/* Fullscreen */}
            <button 
              onClick={() => {
                if (document.fullscreenElement) {
                  document.exitFullscreen()
                } else {
                  document.documentElement.requestFullscreen()
                }
              }}
              className="p-1.5 hover:bg-slate-700/50 rounded transition-colors"
            >
              <Maximize2 className="w-4 h-4 text-slate-400" />
            </button>

            {/* Deposit Button */}
            <button className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 rounded text-xs font-medium transition-colors">
              Deposit
            </button>
            
            {/* Settings */}
            <button className="p-1.5 bg-pink-500 hover:bg-pink-600 rounded-full transition-colors">
              <Settings className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-41px)]" data-fk-section="main">
        {/* Left Sidebar */}
        <div className="w-[280px] ml-[170px] mt-4 bg-[#0d1117]/90 backdrop-blur-sm rounded-lg flex-shrink-0 flex flex-col" style={{ height: 'calc(100vh - 73px)' }} data-fk-section="left-sidebar">
          {/* Sidebar Header — on mobile this row is repositioned (via CSS) to a
              full-width top bar that also shows the FAST KENO logo (img below
              is hidden on desktop). All state, handlers, and visual styling
              are unchanged on desktop. */}
          <div className="flex items-center justify-between p-2.5 border-b border-slate-700/50" data-fk-section="sidebar-header">
            {/* Mobile-only logo (hidden on >= 768px via CSS) */}
            <img
              src="/fk-logo-mobile.png"
              alt="FAST KENO"
              data-fk-mobile-only
              className="fk-mobile-logo"
            />
            {/* Balance */}
            <div 
              className="px-2.5 py-1 rounded"
              style={{
                border: '1px solid rgba(31, 85, 54, 0.7)',
                background: 'rgba(30, 43, 34, 0.5)'
              }}
            >
              <span style={{
                color: '#e6b529',
                fontFamily: "system-ui, -apple-system, sans-serif",
                fontWeight: 400,
                fontSize: '1.2rem',
                lineHeight: '1.2rem'
              }}>
                {balance.toFixed(2)}
              </span>
              <span style={{
                fontSize: '60%',
                color: '#fff',
                fontFamily: "system-ui, -apple-system, sans-serif",
                fontWeight: 400,
                marginLeft: '4px'
              }}>
                ETB
              </span>
            </div>
            
            {/* Player ID */}
            <span style={{
              color: '#fff',
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontWeight: 400,
              fontSize: '1.2rem',
              lineHeight: '2rem',
              cursor: 'pointer'
            }}>
              ID: <span style={{ color: '#fff' }}>{playerId}</span>
            </span>
            
            {/* Menu */}
            <button className="p-1 hover:bg-slate-700/50 rounded transition-colors">
              <Menu className="w-4 h-4 text-slate-400" />
            </button>

            {/* Chat / message-menu trigger (mobile-only — opens the right
                sidebar as a slide-in. Hidden on >= 768px via CSS). */}
            <button
              type="button"
              onClick={() => setShowMobileChat(true)}
              className="fk-mobile-chat-btn p-1 hover:bg-slate-700/50 rounded transition-colors"
              aria-label="Open chat"
            >
              <MessageCircle className="w-4 h-4 text-slate-400" />
            </button>
          </div>
          
          {/* Main Tabs */}
          <div className="flex items-center border-b border-slate-700/50">
            <button
              onClick={() => setActiveTab("game")}
              className={`flex items-center gap-1 px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "game" ? "text-emerald-400" : "text-slate-400 hover:text-slate-300"
              }`}
            >
              <Play className={`w-3.5 h-3.5 ${activeTab === "game" ? "fill-emerald-400" : ""}`} />
              GAME
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-1 px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "history" ? "text-emerald-400" : "text-slate-400 hover:text-slate-300"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              HISTORY
            </button>
            <button
              onClick={() => setActiveTab("results")}
              className={`flex items-center gap-1 px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "results" ? "text-emerald-400" : "text-slate-400 hover:text-slate-300"
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              RESULTS
            </button>
            <button
              onClick={() => setActiveTab("stats")}
              className={`flex items-center gap-1 px-2.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "stats" ? "text-emerald-400" : "text-slate-400 hover:text-slate-300"
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
          </div>
          
          {/* Sub Tabs */}
          <div className="flex items-center gap-3 px-2.5 py-2 border-b border-slate-700/50">
            <button
              onClick={() => setActiveSubTab("all")}
              className={`text-xs transition-colors ${
                activeSubTab === "all" ? "text-emerald-400" : "text-slate-500 hover:text-slate-400"
              }`}
            >
              All <span className="text-emerald-400">{allBets.length}</span>
            </button>
            <button
              onClick={() => setActiveSubTab("myTickets")}
              className={`text-xs transition-colors ${
                activeSubTab === "myTickets" ? "text-emerald-400" : "text-slate-500 hover:text-slate-400"
              }`}
            >
              My Tickets <span className="text-emerald-400">{myBets.filter(b => b.status === "won").length}</span>
            </button>
            <button
              onClick={() => setActiveSubTab("myBets")}
              className={`text-xs transition-colors ${
                activeSubTab === "myBets" ? "text-emerald-400" : "text-slate-500 hover:text-slate-400"
              }`}
            >
              My Bets <span className="text-emerald-400">{myBets.length}</span>
            </button>
          </div>
          
          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "game" && getFilteredBets().map((bet) => (
              <div 
                key={bet.id} 
                style={{
                  backgroundColor: '#1a2024',
                  borderBottom: '1px solid #2a3438',
                  padding: '8px 10px'
                }}
              >
                {/* Username */}
                <div 
                  style={{
                    color: '#d4a853',
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    fontWeight: 400,
                    fontSize: '0.85rem',
                    lineHeight: '1.2rem',
                    marginBottom: '4px'
                  }}
                >
                  {bet.user}
                </div>
                {/* Numbers row */}
                <div className="flex gap-1 mb-1">
                  {bet.numbers.map(n => (
                    <div 
                      key={n}
                      style={{
                        background: bet.matchedNumbers?.includes(n) ? '#51b579' : '#2a3438',
                        borderRadius: '2px',
                        fontFamily: "system-ui, -apple-system, sans-serif",
                        fontWeight: 600,
                        color: bet.matchedNumbers?.includes(n) ? '#fff' : '#8a9a9a',
                        fontSize: '0.8rem',
                        textAlign: 'center',
                        padding: '4px 8px',
                        minWidth: '28px'
                      }}
                    >
                      {n}
                    </div>
                  ))}
                </div>
                {/* Bet amount and status row */}
                <div className="flex items-center justify-between">
                  <span 
                    style={{
                      color: '#6a7a7a',
                      fontFamily: "system-ui, -apple-system, sans-serif",
                      fontWeight: 400,
                      fontSize: '0.8rem'
                    }}
                  >
                    Bet {bet.amount}
                  </span>
                  <span 
                    style={{
                      color: bet.status === "won" ? '#51b579' : bet.status === "waiting" ? '#51b579' : '#ff5c5c',
                      fontFamily: "system-ui, -apple-system, sans-serif",
                      fontWeight: 400,
                      fontSize: '0.8rem'
                    }}
                  >
                    {bet.status === "won" ? `Won ${bet.winAmount?.toFixed(2)}` : 
                     bet.status.charAt(0).toUpperCase() + bet.status.slice(1)}
                  </span>
                </div>
              </div>
            ))}
            
            {activeTab === "history" && gameHistory.map((round) => (
              <div key={round.id} className="mb-3 bg-slate-800/50 rounded p-2">
                <div className="text-slate-400 text-xs mb-1">Round #{round.id}</div>
                <div className="flex flex-wrap gap-1">
                  {round.drawnNumbers.map(n => (
                    <div key={n} className="w-6 h-6 bg-emerald-500/80 rounded flex items-center justify-center text-xs font-medium">
                      {n}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            
            {activeTab === "results" && (
              <div className="text-xs">
                {/* Header row */}
                <div 
                  className="flex items-center justify-between px-2.5 py-2"
                  style={{ 
                    borderBottom: '1px solid #2a3438',
                    color: '#6a7a7a',
                    fontSize: '0.75rem'
                  }}
                >
                  <span>Draw ID</span>
                  <span>Combination</span>
                </div>
                
                {/* Results list */}
                {[...gameHistory].map((round, idx) => {
                  // Check if user had winning bet in this round
                  const hasWin = myBets.some(b => b.roundId === round.id && b.status === "won")
                  const roundTime = new Date(round.timestamp)
                  const timeStr = `${String(roundTime.getHours()).padStart(2, '0')}:${String(roundTime.getMinutes()).padStart(2, '0')}:${String(roundTime.getSeconds()).padStart(2, '0')}`
                  
                  return (
                    <div 
                      key={round.id}
                      style={{
                        backgroundColor: idx % 2 === 0 ? '#1a2024' : '#1e2529',
                        borderBottom: '1px solid #2a3438',
                        padding: '8px 10px'
                      }}
                    >
                      <div className="flex gap-2">
                        {/* Win indicator */}
                        <div style={{ width: '18px', flexShrink: 0 }}>
                          {hasWin && (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" fill="#51b579"/>
                              <path d="M8 12l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                        
                        {/* Draw ID and time */}
                        <div style={{ flexShrink: 0, width: '55px' }}>
                          <div style={{ 
                            color: '#51b579', 
                            fontWeight: 600, 
                            fontSize: '0.8rem',
                            lineHeight: '1.1'
                          }}>
                            {round.id}
                          </div>
                          <div style={{ 
                            color: '#6a7a7a', 
                            fontSize: '0.7rem',
                            lineHeight: '1.1'
                          }}>
                            {timeStr}
                          </div>
                        </div>
                        
                        {/* Numbers - two rows of 10 */}
                        <div className="flex-1">
                          {/* Row 1 - First 10 numbers */}
                          <div className="flex gap-0.5 mb-0.5">
                            {round.drawnNumbers.slice(0, 10).map((n, nIdx) => {
                              const isMatched = selectedNumbers.includes(n)
                              return (
                                <span 
                                  key={nIdx}
                                  style={{
                                    color: isMatched ? '#70f7a6' : '#8a9a9a',
                                    fontWeight: isMatched ? 700 : 400,
                                    fontSize: '0.75rem',
                                    minWidth: '18px',
                                    textAlign: 'center'
                                  }}
                                >
                                  {n}
                                </span>
                              )
                            })}
                          </div>
                          {/* Row 2 - Next 10 numbers */}
                          <div className="flex gap-0.5">
                            {round.drawnNumbers.slice(10, 20).map((n, nIdx) => {
                              const isMatched = selectedNumbers.includes(n)
                              return (
                                <span 
                                  key={nIdx}
                                  style={{
                                    color: isMatched ? '#70f7a6' : '#8a9a9a',
                                    fontWeight: isMatched ? 700 : 400,
                                    fontSize: '0.75rem',
                                    minWidth: '18px',
                                    textAlign: 'center'
                                  }}
                                >
                                  {n}
                                </span>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                
                {gameHistory.length === 0 && (
                  <div className="text-center py-4 text-slate-500">No results yet...</div>
                )}
              </div>
            )}
            
            {activeTab === "stats" && (
              <div className="text-xs">
                <div className="mb-3">
                  <div className="text-emerald-400 mb-1">Hot Numbers</div>
                  <div className="flex flex-wrap gap-1">
                    {hotNumbers.map(n => (
                      <div key={n} className="w-7 h-7 bg-red-500/80 rounded flex items-center justify-center font-medium">
                        {n}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-cyan-400 mb-1">Cold Numbers</div>
                  <div className="flex flex-wrap gap-1">
                    {coldNumbers.map(n => (
                      <div key={n} className="w-7 h-7 bg-cyan-500/80 rounded flex items-center justify-center font-medium">
                        {n}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center Game Area - Single Unified Panel */}
        <div className="flex-1 flex flex-col items-center justify-center px-2 py-2" data-fk-section="game-area">
          {/* Main Game Panel Container */}
          <div 
            className="game_panel"
            style={{
              width: '100%',
              maxWidth: '480px',
              backgroundColor: '#1a2228',
              borderRadius: '6px',
              overflow: 'hidden'
            }}
          >
            {/* Timer - DS-Digital font style */}
            <div 
              className="game_timer"
              style={{
                textAlign: 'center',
                padding: '12px 0',
                width: '100%',
                zIndex: 3,
                backgroundImage: 'url(https://hebbkx1anhila5yf.public.blob.vercel-storage.com/timer_bg-JKhfbLWqP6SmYMkz8OvXVAi58nZ1Y3.svg)',
                backgroundSize: '180px',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: '50% 50%',
                color: '#fff',
                fontFamily: "'DS-Digital', 'Courier New', monospace",
                fontWeight: 700,
                fontSize: '2rem',
                lineHeight: 'normal',
                letterSpacing: '3px'
              }}
            >
              <span style={{ display: 'inline-block', width: '36px', textAlign: 'center' }}>
                {String(Math.floor(roundTimer / 60)).padStart(2, '0')}
              </span>
              <span style={{ 
                margin: '0 6px',
                display: 'inline-block',
                color: '#fff',
                letterSpacing: '2px'
              }}>:</span>
              <span style={{ display: 'inline-block', width: '36px', textAlign: 'center' }}>
                {String(roundTimer % 60).padStart(2, '0')}
              </span>
            </div>

          {/* Ticket Selection Card - Shows different content based on game phase */}
            <div 
              className="relative"
              style={{
                minHeight: (gamePhase === "drawing" || gamePhase === "result") ? '160px' : (selectedNumbers.length > 0 ? '120px' : '100px'),
                backgroundColor: 'rgba(30, 40, 45, 0.6)',
                overflow: 'hidden',
                padding: '8px 10px'
              }}
            >
              {/* DRAWING/RESULT PHASE - Show animated ball and drawn numbers */}
              {(gamePhase === "drawing" || gamePhase === "result") && drawnNumbers.length > 0 ? (
                <div 
                  className="game_animation"
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    minHeight: '145px'
                  }}
                >
                  {/* Rotating animation background behind ball - positioned behind the ball area */}
                  <div 
                    style={{
                      position: 'absolute',
                      top: '-50px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '220px',
                      height: '220px',
                      backgroundImage: 'url(https://hebbkx1anhila5yf.public.blob.vercel-storage.com/gameplay_bg_anim-sPx95K4gcRzU8to7oZRI5GLAAFGts3.svg)',
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: '50% 50%',
                      backgroundSize: 'contain',
                      animation: 'ball_bg_rotation 15s infinite linear',
                      zIndex: 1,
                      opacity: 0.6,
                      pointerEvents: 'none'
                    }}
                  />
                  {/* Counter - top right */}
                  <div 
                    className="balls_counter"
                    style={{
                      position: 'absolute',
                      top: '5px',
                      right: '8px',
                      color: 'rgba(112, 247, 166, 0.85)',
                      fontFamily: "'DS-Digital', 'Courier New', monospace",
                      fontWeight: 700,
                      fontSize: '1.2rem',
                      zIndex: 10
                    }}
                  >
                    <span style={{ color: '#fff' }}>{currentDrawIndex}</span>
                    <span style={{ margin: '0 2px' }}>/</span>
                    <span>{drawCount}</span>
                  </div>

                  {/* Large animated ball container - center top */}
                  <div 
                    className="anim_ball_cont"
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '0',
                      width: '55px',
                      height: '55px',
                      transform: 'translateX(-50%)',
                      zIndex: 5
                    }}
                  >
                    {currentDrawIndex > 0 && currentDrawIndex <= drawnNumbers.length && (
                      <div 
                        key={`main-ball-${currentDrawIndex}`}
                        className={`anim_ball ${selectedNumbers.includes(drawnNumbers[currentDrawIndex - 1]) ? 'active' : ''}`}
                        style={{
                          position: 'absolute',
                          width: '100%',
                          height: '100%',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: selectedNumbers.includes(drawnNumbers[currentDrawIndex - 1])
                            ? 'radial-gradient(circle, #087b67, #03493f 59%, #0d4239 60%, #47736b 77%, #6be2a8 78%)'
                            : 'radial-gradient(circle, #0d3b69, #061c33 36%, #05182b 59%, #0a2435 60%, #4c6e6e 84%)',
                          boxShadow: '0 4px 15px rgba(0,0,0,0.4)',
                          fontFamily: "'Roboto Condensed', sans-serif",
                          fontWeight: 700,
                          fontSize: '1.8rem',
                          color: selectedNumbers.includes(drawnNumbers[currentDrawIndex - 1]) ? '#70f7a6' : '#e2e2e2',
                          animation: 'ball_show 0.5s ease-out forwards',
                          opacity: 0
                        }}
                      >
                        {/* Shine effect */}
                        <i style={{
                          opacity: 0.4,
                          display: 'block',
                          position: 'absolute',
                          borderRadius: '50%',
                          overflow: 'hidden',
                          zIndex: 4,
                          left: '19%',
                          top: '0',
                          width: '62%',
                          height: '40%',
                          background: 'linear-gradient(180deg, #fff, rgba(255,255,255,0.5))'
                        }} />
                        <span style={{ position: 'relative', zIndex: 3 }}>
                          {drawnNumbers[currentDrawIndex - 1]}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Row 1 - First 10 drawn numbers - only show revealed balls, left aligned */}
                  <div 
                    className="game_animation_row1"
                    style={{
                      position: 'absolute',
                      top: '65px',
                      left: '8px',
                      right: '8px',
                      display: 'flex',
                      justifyContent: 'flex-start',
                      gap: '5px',
                      flexWrap: 'wrap'
                    }}
                  >
                    {drawnNumbers.slice(0, 10).map((num, idx) => {
                      const isMatched = selectedNumbers.includes(num)
                      const isRevealed = idx < currentDrawIndex
                      if (!isRevealed) return null
                      return (
                        <div 
                          key={`row1-ball-${idx}`}
                          style={{
                            width: '30px',
                            height: '30px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: isMatched 
                              ? 'radial-gradient(circle, #087b67, #03493f 59%, #0d4239 60%, #47736b 77%, #6be2a8 78%)'
                              : 'radial-gradient(circle, #0d3b69, #061c33 36%, #05182b 59%, #0a2435 60%, #4c6e6e 84%)',
                            fontFamily: "'Roboto Condensed', sans-serif",
                            fontWeight: 700,
                            fontSize: '0.8rem',
                            color: isMatched ? '#70f7a6' : '#e2e2e2',
                            boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                            animation: idx === currentDrawIndex - 1 ? 'ball_show 0.3s ease-out forwards' : 'none'
                          }}
                        >
                          {num}
                        </div>
                      )
                    })}
                  </div>

                  {/* Row 2 - Next 10 drawn numbers - only show revealed balls, left aligned */}
                  <div 
                    className="game_animation_row2"
                    style={{
                      position: 'absolute',
                      top: '102px',
                      left: '8px',
                      right: '8px',
                      display: 'flex',
                      justifyContent: 'flex-start',
                      gap: '5px',
                      flexWrap: 'wrap'
                    }}
                  >
                    {drawnNumbers.slice(10, 20).map((num, idx) => {
                      const actualIdx = idx + 10
                      const isMatched = selectedNumbers.includes(num)
                      const isRevealed = actualIdx < currentDrawIndex
                      if (!isRevealed) return null
                      return (
                        <div 
                          key={`row2-ball-${idx}`}
                          style={{
                            width: '30px',
                            height: '30px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: isMatched 
                              ? 'radial-gradient(circle, #087b67, #03493f 59%, #0d4239 60%, #47736b 77%, #6be2a8 78%)'
                              : 'radial-gradient(circle, #0d3b69, #061c33 36%, #05182b 59%, #0a2435 60%, #4c6e6e 84%)',
                            fontFamily: "'Roboto Condensed', sans-serif",
                            fontWeight: 700,
                            fontSize: '0.8rem',
                            color: isMatched ? '#70f7a6' : '#e2e2e2',
                            boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                            animation: actualIdx === currentDrawIndex - 1 ? 'ball_show 0.3s ease-out forwards' : 'none'
                          }}
                        >
                          {num}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <>
                  {/* Help Icon positioned top-right */}
                  <button 
                    className="absolute flex items-center justify-center transition-colors z-20"
                    style={{
                      right: '8px',
                      top: '8px',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      color: '#51b579',
                      fontFamily: "'Roboto Condensed', sans-serif",
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      lineHeight: 1,
                      textAlign: 'center',
                      background: '#35434b',
                      border: '1px solid #4a5a5a'
                    }}
                  >
                    ?
                  </button>

                  {selectedNumbers.length === 0 ? (
                    <>
                      {/* Circular animation background - positioned left */}
                      <div 
                        className="absolute"
                        style={{
                          top: '-80%',
                          left: '-15%',
                          width: '200px',
                          height: '200px',
                          backgroundImage: 'url(https://hebbkx1anhila5yf.public.blob.vercel-storage.com/gameplay_bg_anim-sPx95K4gcRzU8to7oZRI5GLAAFGts3.svg)',
                          backgroundRepeat: 'no-repeat',
                          backgroundPosition: '50% 50%',
                          backgroundSize: 'contain',
                          animation: 'ball_bg_rotation 20s infinite linear',
                          zIndex: 1,
                          opacity: 0.8
                        }}
                      />
                      
                      {/* Ball Icons positioned left */}
                      <div 
                        className="absolute pointer-events-none"
                        style={{
                          width: '55px',
                          height: '80px',
                          left: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          backgroundImage: 'url(https://hebbkx1anhila5yf.public.blob.vercel-storage.com/balls-TvCCRuGZht3Ee1wvMQ4e1xB3qzadwp.png)',
                          backgroundRepeat: 'no-repeat',
                          backgroundSize: 'contain',
                          backgroundPosition: '0 0',
                          zIndex: 2
                        }}
                      />

                      {/* Title - when no numbers selected */}
                      <div 
                        className="absolute z-10"
                        style={{
                          top: '50%',
                          transform: 'translateY(-50%)',
                          left: '75px',
                          right: '45px'
                        }}
                      >
                        <div style={{
                          color: '#fff',
                          fontFamily: "'Roboto Condensed', sans-serif",
                          fontWeight: 700,
                          fontSize: '1.2rem',
                          lineHeight: '1.6rem',
                          textAlign: 'left'
                        }}>
                          Choose 10 numbers
                        </div>
                        <div style={{
                          color: '#5fdb94',
                          fontFamily: "'Roboto Condensed', sans-serif",
                          fontWeight: 700,
                          fontSize: '0.95rem',
                          lineHeight: '1.2rem',
                          textAlign: 'left'
                        }}>
                          From 1 to 80
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* When numbers are selected - show Possible win and selected numbers */}
                      {/* Possible win header */}
                      <div style={{ marginBottom: '6px' }}>
                        <span style={{
                          color: '#5fdb94',
                          fontFamily: "system-ui, -apple-system, sans-serif",
                          fontWeight: 600,
                          fontSize: '0.85rem'
                        }}>
                          Possible win{' '}
                        </span>
                        <span style={{
                          color: '#5fdb94',
                          fontFamily: "system-ui, -apple-system, sans-serif",
                          fontWeight: 700,
                          fontSize: '0.85rem'
                        }}>
                          {(betAmount * getPayoutMultiplier(selectedNumbers.length, selectedNumbers.length)).toFixed(0)}
                        </span>
                      </div>

                      {/* Match / PAYS row */}
                      <div className="flex items-center gap-4 mb-2" style={{ fontSize: '0.7rem' }}>
                        <div>
                          <div style={{ color: '#6a7a7a', fontWeight: 400 }}>Match</div>
                          <div style={{ color: '#6a7a7a', fontWeight: 400 }}>PAYS</div>
                        </div>
                        {[2, 3, 4, 5].map(matchCount => {
                          const multiplier = selectedNumbers.length >= matchCount 
                            ? getPayoutMultiplier(selectedNumbers.length, matchCount)
                            : 0
                          return (
                            <div key={matchCount} style={{ textAlign: 'center', minWidth: '30px' }}>
                              <div style={{ color: '#fff', fontWeight: 600 }}>{matchCount}</div>
                              <div style={{ color: '#6a7a7a', fontWeight: 400 }}>
                                {multiplier > 0 ? `x${multiplier}` : '-'}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* Selected numbers display - 10 slots */}
                      <div className="flex gap-1">
                        {Array.from({ length: 10 }, (_, idx) => {
                          const num = selectedNumbers[idx]
                          return (
                            <div 
                              key={idx}
                              style={{
                                width: '32px',
                                height: '32px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '3px',
                                background: num ? '#2a3438' : 'rgba(42, 52, 56, 0.5)',
                                border: num ? 'none' : '1px solid rgba(80, 90, 90, 0.3)',
                                fontFamily: "'Roboto Condensed', sans-serif",
                                fontWeight: 700,
                                fontSize: '1.1rem',
                                color: '#fff'
                              }}
                            >
                              {num || ''}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

          {/* Number Grid - Table Layout - Inside Panel */}
            <div style={{ padding: '6px' }}>
              <div style={{ display: 'table', width: '100%', borderSpacing: '2px', borderCollapse: 'separate' }}>
                {Array.from({ length: 8 }, (_, rowIdx) => (
                  <div key={rowIdx} style={{ display: 'table-row' }}>
                    {Array.from({ length: 10 }, (_, colIdx) => {
                      const num = rowIdx * 10 + colIdx + 1
                      const isNumSelected = isSelected(num)
                      const isNumDrawn = isDrawn(num)
                      const isNumMatch = isMatch(num)
                      
                      return (
                        <button
                          key={num}
                          onClick={() => toggleNumber(num)}
                          disabled={gamePhase !== "betting"}
                          className={`relative transition-all ${
                            gamePhase !== "betting" ? "cursor-default" : "cursor-pointer"
                          }`}
                          style={{
                            display: 'table-cell',
                            width: '10%',
                            padding: '10px 0',
                            borderRadius: '3px',
                            fontFamily: "'Roboto Condensed', sans-serif",
                            fontWeight: 700,
                            fontSize: '1.1rem',
                            lineHeight: 1,
                            textAlign: 'center',
                            verticalAlign: 'middle',
                            color: isNumSelected || isNumDrawn ? '#fff' : '#8a9a9a',
                            background: isNumMatch
                              ? '#51b579'
                              : isNumSelected
                                ? 'linear-gradient(180deg, #254632, #4c8b65)'
                                : isNumDrawn
                                  ? '#51b579'
                                  : 'linear-gradient(180deg, #333f46, #242b31)'
                          }}
                        >
                          {num}
                          {/* Hot indicator (red dot) */}
                          {hotNumbers.includes(num) && (
                            <span 
                              className="absolute rounded-full"
                              style={{
                                top: '2px',
                                right: '2px',
                                width: '4px',
                                height: '4px',
                                background: '#ff5c5c'
                              }}
                            />
                          )}
                          {/* Cold indicator (cyan dot) */}
                          {coldNumbers.includes(num) && (
                            <span 
                              className="absolute rounded-full"
                              style={{
                                top: '2px',
                                right: '2px',
                                width: '4px',
                                height: '4px',
                                background: '#8bdbff'
                              }}
                            />
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

          {/* Betting Controls - Inside Panel - Hidden during drawing */}
            {gamePhase !== "drawing" && (
            <div style={{ padding: '6px' }}>
              {/* Betting Controls Row */}
              <div className="flex gap-1">
                {/* Input UI with minus, amount, plus */}
                <div 
                  className="flex items-center justify-between flex-grow"
                  style={{
                    borderRadius: '3px',
                    height: '36px',
                    background: 'linear-gradient(180deg, #242b31, #333f46)'
                  }}
                >
                  {/* Minus Button */}
                  <button 
                    onClick={() => adjustBet(false)}
                    disabled={gamePhase !== "betting"}
                    className="inline-flex items-center justify-center h-full disabled:opacity-50"
                    style={{ width: '36px' }}
                  >
                    <span style={{ color: '#6a7a7a', fontSize: '1.2rem', fontWeight: 300 }}>−</span>
                  </button>
                  
                  {/* Amount Display */}
                  <div
                    className="flex-1 h-full flex items-center justify-center text-white"
                    style={{
                      fontFamily: "system-ui, -apple-system, sans-serif",
                      fontWeight: 600,
                      fontSize: '1rem'
                    }}
                  >
                    {betAmount.toFixed(2)}
                  </div>
                  
                  {/* Plus Button */}
                  <button 
                    onClick={() => adjustBet(true)}
                    disabled={gamePhase !== "betting"}
                    className="inline-flex items-center justify-center h-full disabled:opacity-50"
                    style={{ width: '36px' }}
                  >
                    <span style={{ color: '#6a7a7a', fontSize: '1.2rem', fontWeight: 300 }}>+</span>
                  </button>
                </div>
                
                {/* X2 Button */}
                <button 
                  onClick={doubleBet}
                  disabled={gamePhase !== "betting"}
                  className="h-[36px] w-[36px] inline-flex items-center justify-center disabled:opacity-50"
                  style={{
                    borderRadius: '3px',
                    border: '1px solid #3a5a4a',
                    background: 'transparent'
                  }}
                >
                  <span style={{
                    color: '#51b579',
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    fontWeight: 600,
                    fontSize: '0.75rem'
                  }}>X2</span>
                </button>
                
                {/* MAX Button */}
                <button 
                  onClick={maxBet}
                  disabled={gamePhase !== "betting"}
                  className="h-[36px] w-[36px] inline-flex items-center justify-center disabled:opacity-50"
                  style={{
                    borderRadius: '3px',
                    border: '1px solid #3a5a4a',
                    background: 'transparent'
                  }}
                >
                  <span style={{
                    color: '#51b579',
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    fontWeight: 600,
                    fontSize: '0.65rem'
                  }}>MAX</span>
                </button>
                
                {/* Settings Button */}
                <button 
                  data-fk-section="bet-settings"
                  className="h-[36px] w-[36px] inline-flex items-center justify-center"
                  style={{
                    borderRadius: '3px',
                    background: 'transparent'
                  }}
                >
                  <Settings className="w-4 h-4" style={{ color: '#51b579' }} />
                </button>
              </div>

              {/* BET Button */}
              <button
                onClick={placeBet}
                disabled={selectedNumbers.length === 0 || gamePhase !== "betting" || balance < betAmount}
                className={`w-full mt-1 disabled:cursor-not-allowed ${
                  gamePhase !== "betting" || selectedNumbers.length === 0 ? 'opacity-60' : ''
                }`}
                style={{
                  height: '38px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  borderRadius: '3px',
                  background: 'linear-gradient(180deg, #4c8b65, #254632)',
                  color: '#fff',
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  fontSize: '1rem',
                  letterSpacing: '1px'
                }}
              >
                BET
              </button>
            </div>
            )}
          </div>
        </div>

        {/* Right Chat Panel */}
        <div className="w-[280px] mr-[170px] mt-4 bg-[#1a2332]/80 backdrop-blur-sm rounded-lg flex flex-col" style={{ height: 'calc(100vh - 73px)' }} data-fk-section="right-chat">
          {/* Online Count + (mobile-only) close button */}
          <div className="flex items-center gap-2 p-3 border-b border-slate-700/50">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-slate-400 text-sm">{onlineCount}</span>
            <button
              type="button"
              onClick={() => setShowMobileChat(false)}
              className="fk-mobile-chat-close ml-auto p-1 hover:bg-slate-700/50 rounded transition-colors"
              aria-label="Close chat"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {chatMessages.map(msg => (
              <div key={msg.id} className="flex items-start gap-2">
                <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs ${
                  msg.avatar === "blue" ? "bg-blue-500" :
                  msg.avatar === "yellow" ? "bg-yellow-500" :
                  msg.avatar === "green" ? "bg-emerald-500" :
                  msg.avatar === "pink" ? "bg-pink-500" :
                  "bg-slate-500"
                }`}>
                  :)
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-emerald-400 text-xs font-medium">{msg.user}</span>
                  <p className="text-slate-300 text-xs break-words leading-relaxed">{msg.message}</p>
                </div>
                <div className="flex items-center gap-1 text-slate-500">
                  {msg.likes > 0 && <span className="text-xs">{msg.likes}</span>}
                  <button 
                    onClick={() => likeMessage(msg.id)}
                    className="hover:text-white transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
          
          {/* Chat Input */}
          <div className="p-3 border-t border-slate-700/30">
            <div className="flex items-center gap-2 bg-[#2a3441] rounded px-3 py-2.5">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                placeholder="Send message"
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
              />
              <button 
                onClick={sendChatMessage}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-2.5 px-1">
              <div className="flex items-center gap-4">
                <button className="text-yellow-500 hover:text-yellow-400 transition-colors">
                  <Smile className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setShowGifPopup(true)}
                  className="text-slate-400 hover:text-white text-xs font-medium transition-colors"
                >
                  GIF
                </button>
                <button 
                  onClick={() => setShowRainPopup(true)}
                  className="flex items-center gap-1 text-orange-500 hover:text-orange-400 transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 23c-3.866 0-7-3.134-7-7 0-3.052 2.021-6.195 4.034-8.612.949-1.139 1.915-2.129 2.664-2.87l.302-.295.302.295c.749.741 1.715 1.731 2.664 2.87C17.979 9.805 20 12.948 20 16c0 3.866-3.134 7-7 7zm0-16.174c-.604.624-1.298 1.391-1.966 2.193C8.146 11.317 6.5 13.899 6.5 16a5.5 5.5 0 0011 0c0-2.101-1.646-4.683-3.534-6.981-.668-.802-1.362-1.569-1.966-2.193zM12 20c-2.206 0-4-1.794-4-4 0-.702.28-1.507.673-2.358.33-.714.741-1.437 1.17-2.122.182-.29.366-.57.546-.833l.611-.86.611.86c.18.263.364.543.546.833.429.685.84 1.408 1.17 2.122.393.851.673 1.656.673 2.358 0 2.206-1.794 4-4 4z"/>
                  </svg>
                  <span className="text-xs">Rain</span>
                </button>
              </div>
              <span className="text-slate-500 text-xs">{160 - chatMessage.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* GIF Popup - positioned at bottom of chat panel */}
      {showGifPopup && (
        <>
          {/* Backdrop to close */}
          <div 
            className="fixed inset-0 z-40"
            onClick={() => setShowGifPopup(false)}
          />
          <div 
            className="fixed z-50"
            style={{ 
              bottom: '70px',
              right: '10px',
              width: '280px',
              maxWidth: 'calc(100vw - 20px)'
            }}
          >
          <div 
            style={{
              width: '100%',
              maxHeight: '350px',
              backgroundColor: '#1a2024',
              borderRadius: '8px',
              overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
            }}
          >
            {/* Header */}
            <div 
              className="flex items-center justify-between px-3 py-2"
              style={{ backgroundColor: '#252d32', borderBottom: '1px solid #2a3438' }}
            >
              <span style={{ color: '#51b579', fontWeight: 600, fontSize: '0.9rem' }}>GIF</span>
              <button 
                onClick={() => setShowGifPopup(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Search */}
            <div className="p-2">
              <input
                type="text"
                placeholder="Search for GIFs..."
                value={gifSearch}
                onChange={e => setGifSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#252d32',
                  border: '1px solid #3a4448',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '0.85rem'
                }}
              />
            </div>
            
            {/* GIF Grid */}
            <div 
              className="grid grid-cols-2 gap-1 p-2"
              style={{ maxHeight: '300px', overflowY: 'auto' }}
            >
              {[
                'https://media.giphy.com/media/3oriO0OEd9QIDdllqo/giphy.gif',
                'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
                'https://media.giphy.com/media/26uf7LY5MJKJD1Tb2/giphy.gif',
                'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif',
                'https://media.giphy.com/media/l2JhtKtDWYNKdRpoA/giphy.gif',
                'https://media.giphy.com/media/3oz8xIsloV7zOmt81G/giphy.gif'
              ].map((gif, idx) => (
                <div 
                  key={idx}
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ 
                    height: '90px', 
                    backgroundColor: '#252d32',
                    backgroundImage: `url(${gif})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    borderRadius: '4px'
                  }}
                  onClick={() => {
                    setChatMessage(`[GIF]`)
                    setShowGifPopup(false)
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        </>
      )}

      {/* Rain Popup - centered modal */}
      {showRainPopup && (
        <>
          {/* Backdrop to close */}
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
                    // Rain logic - deduct from balance and distribute to random users
                    const totalCost = rainAmount * rainPlayers
                    if (balance >= totalCost) {
                      setBalance(prev => prev - totalCost)
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
    </div>
    </div>
  )
}
