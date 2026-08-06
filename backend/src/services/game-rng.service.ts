import crypto from 'node:crypto';

export interface RoundSeed {
  serverSeed: string;
  serverSeedHash: string;
}

const DEFAULT_SLOT_SYMBOLS = [
  'A',
  'K',
  'Q',
  'J',
  '10',
  'WILD',
  'SCATTER',
] as const;

export interface SlotRtpConfig {
  symbolWeights: string[];
}

/**
 * Convert an RTP percent (0..100) to the multiplicative house edge used by
 * the crash/keno/slot RNG. A 97% RTP keeps 97% of stakes returned to players
 * on average — equivalent to multiplying the raw fair distribution by 0.97.
 * Anything outside [50, 99] is clamped defensively.
 */
function rtpToHouseEdge(rtpPercent: number | null | undefined): number {
  if (!rtpPercent || !Number.isFinite(rtpPercent)) return 0.97;
  const pct = Math.min(99, Math.max(50, Number(rtpPercent)));
  return pct / 100;
}

class GameRngService {
  generateRoundSeed(): RoundSeed {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const serverSeedHash = crypto
      .createHash('sha256')
      .update(serverSeed)
      .digest('hex');
    return { serverSeed, serverSeedHash };
  }

  /**
   * Crash multiplier for Aviator/JetX. The optional `rtpPercent` overrides
   * the default 97% house edge — admin-tuned RTP from internal_games is
   * passed through here so each round honours the latest setting (the
   * change takes effect on the NEXT round, never the current one).
   */
  generateAviatorCrashPoint(
    serverSeed: string,
    clientSeed: string,
    roundId: string,
    rtpPercent?: number | null
  ): number {
    const hmac = crypto
      .createHmac('sha256', serverSeed)
      .update(`${clientSeed}-${roundId}`)
      .digest('hex');
    const num = parseInt(hmac.slice(0, 8), 16);
    const maxVal = 0xffffffff;
    const houseEdge = rtpToHouseEdge(rtpPercent);
    const e = maxVal / Math.max(1, maxVal - num);
    return Math.max(1, Math.floor(e * houseEdge * 100) / 100);
  }

  generateKenoNumbers(
    serverSeed: string,
    clientSeed: string,
    roundId: string
  ): number[] {
    const out: number[] = [];
    let counter = 0;
    while (out.length < 20) {
      const hmac = crypto
        .createHmac('sha256', serverSeed)
        .update(`${clientSeed}-${roundId}-${counter}`)
        .digest('hex');
      const n = (parseInt(hmac.slice(0, 8), 16) % 80) + 1;
      if (!out.includes(n)) out.push(n);
      counter += 1;
    }
    return out.sort((a, b) => a - b);
  }

  generateSlotOutcome(
    serverSeed: string,
    clientSeed: string,
    roundId: string,
    rtpConfig?: SlotRtpConfig
  ): string[] {
    const symbols =
      rtpConfig?.symbolWeights && rtpConfig.symbolWeights.length > 0
        ? rtpConfig.symbolWeights
        : [...DEFAULT_SLOT_SYMBOLS];

    const reels: string[] = [];
    for (let reel = 0; reel < 5; reel += 1) {
      const hmac = crypto
        .createHmac('sha256', serverSeed)
        .update(`${clientSeed}-${roundId}-reel${reel}`)
        .digest('hex');
      const num = parseInt(hmac.slice(0, 8), 16);
      reels.push(symbols[num % symbols.length]);
    }
    return reels;
  }

  /**
   * RTP-aware slot payout multiplier. Returns a number that scales the
   * base symbol payout so that — averaged across thousands of spins —
   * the platform pays back `rtpPercent` of stakes. Used by Multi Hot 5.
   */
  slotPayoutMultiplier(rtpPercent?: number | null): number {
    return rtpToHouseEdge(rtpPercent);
  }

  /** Deterministic [0,1) drawn from the round seeds (provably fair). */
  private seededFloat(
    serverSeed: string,
    clientSeed: string,
    roundId: string,
    salt: string
  ): number {
    const hmac = crypto
      .createHmac('sha256', serverSeed)
      .update(`${clientSeed}-${roundId}-${salt}`)
      .digest('hex');
    return parseInt(hmac.slice(0, 8), 16) / 0xffffffff;
  }

  /**
   * Multi Hot 5 round outcome — a classic 3-reel × 3-row slot with 5 fixed
   * paylines (3 horizontal + 2 diagonal) and a 1x–5x multiplier reel.
   *
   * This is a REAL slot model (no forced wins):
   *   1. Each of the 9 cells is drawn INDEPENDENTLY from a weighted symbol
   *      distribution (`SYMBOL_WEIGHTS`). High-value symbols (777 / $$$) carry
   *      a tiny weight, so a 3-of-a-kind of a premium symbol only ever appears
   *      NATURALLY, by chance, and is extremely rare. They are never forced.
   *   2. All 5 paylines are then evaluated for a genuine 3-of-a-kind. A spin
   *      can therefore produce zero, one, or several winning lines — exactly
   *      like a real slot, and most spins naturally lose.
   *   3. A single RTP frequency-gate keeps the long-run return on target
   *      (default 97.05%, or the admin-configured RTP) WITHOUT altering any
   *      individual payout: the natural model returns `R0` (≈100%), and each
   *      winning board is converted to a loss with probability `1 - target/R0`.
   *      Payouts that ARE paid are always the exact paytable amount.
   *
   * The caller pays each winning line as `betPerLine × paytable[symbol]`,
   * sums the lines, then multiplies by the 1x–5x multiplier reel — no RTP
   * scaling is applied to the payout itself.
   */
  generateMultiHot5Outcome(
    serverSeed: string,
    clientSeed: string,
    roundId: string,
    targetRtpPercent?: number | null
  ): {
    grid: string[][];
    multiplier: number;
    winningLines: Array<{ line: number; symbol: string }>;
  } {
    // Reel-strip composition (weights sum to 1). Bell is the primary paying
    // symbol; 777 (seven) and $$$ (dollar) are rare premium symbols that are
    // NEVER forced — their low weight is the ONLY thing that decides how often
    // they line up. These weights, with the paytable below and a uniform
    // 1x–5x multiplier (E[mult]=3), give a natural return R0 ≈ 99.8%, which the
    // frequency-gate trims to the configured RTP (default 97.05%).
    const SYMBOL_WEIGHTS: Array<{ sym: string; w: number }> = [
      { sym: 'seven', w: 0.02 },
      { sym: 'dollar', w: 0.03 },
      { sym: 'bell', w: 0.4 },
      { sym: 'watermelon', w: 0.09 },
      { sym: 'grapes', w: 0.09 },
      { sym: 'orange', w: 0.0925 },
      { sym: 'cherry', w: 0.0925 },
      { sym: 'lemon', w: 0.0925 },
      { sym: 'plum', w: 0.0925 },
    ];
    // Line-win = betPerLine × multiple, for a 3-of-a-kind (mirrors the in-game
    // rules screen). Kept in sync with MULTI_HOT_5_PAYTABLE in games.routes.ts.
    const PAYTABLE: Record<string, number> = {
      seven: 15,
      dollar: 10,
      bell: 5,
      watermelon: 4,
      grapes: 4,
      orange: 2,
      cherry: 2,
      lemon: 2,
      plum: 2,
    };
    // The 5 fixed paylines as [reel, row] cell triples.
    //   0 middle row, 1 top row, 2 bottom row, 3 ↘ diagonal, 4 ↗ diagonal
    const PAYLINES: Array<Array<[number, number]>> = [
      [[0, 1], [1, 1], [2, 1]],
      [[0, 0], [1, 0], [2, 0]],
      [[0, 2], [1, 2], [2, 2]],
      [[0, 0], [1, 1], [2, 2]],
      [[0, 2], [1, 1], [2, 0]],
    ];

    const pickSymbol = (u: number): string => {
      let cum = 0;
      for (const s of SYMBOL_WEIGHTS) {
        cum += s.w;
        if (u < cum) return s.sym;
      }
      return SYMBOL_WEIGHTS[SYMBOL_WEIGHTS.length - 1].sym;
    };

    // Natural (ungated) return of the model: with a uniform 1x–5x multiplier
    // reel, E[mult] = 3, and by linearity of expectation each of the 5 identical
    // paylines returns betPerLine × Σ_s w_s³ · pay_s, so
    //   R0 = E[mult] × Σ_s w_s³ · pay_s.
    const R0 =
      3 *
      SYMBOL_WEIGHTS.reduce(
        (acc, s) => acc + Math.pow(s.w, 3) * (PAYTABLE[s.sym] ?? 0),
        0
      );
    const target = Math.min(
      0.99,
      Math.max(0.5, (targetRtpPercent ?? 97.05) / 100)
    );
    // Keep each winning board with this probability so long-run RTP = target.
    const keepProb = R0 > 0 ? Math.min(1, target / R0) : 1;

    // grid[reel][row] — every cell drawn independently from the weighted strip.
    const symAt = (salt: string) =>
      pickSymbol(this.seededFloat(serverSeed, clientSeed, roundId, salt));
    const grid: string[][] = [
      [symAt('c0r0'), symAt('c0r1'), symAt('c0r2')],
      [symAt('c1r0'), symAt('c1r1'), symAt('c1r2')],
      [symAt('c2r0'), symAt('c2r1'), symAt('c2r2')],
    ];

    const evaluateLines = (): Array<{ line: number; symbol: string }> => {
      const wins: Array<{ line: number; symbol: string }> = [];
      for (let li = 0; li < PAYLINES.length; li += 1) {
        const [[c0, r0], [c1, r1], [c2, r2]] = PAYLINES[li];
        const s0 = grid[c0][r0];
        if (grid[c1][r1] === s0 && grid[c2][r2] === s0) {
          wins.push({ line: li, symbol: s0 });
        }
      }
      return wins;
    };

    let winningLines = evaluateLines();

    // Frequency-gate: convert this winning board to a loss with probability
    // (1 - keepProb). This trims RTP to target without ever touching a paid
    // amount. The gate roll uses an independent salt, so the keep decision is
    // independent of the win size — long-run RTP = keepProb × R0 = target.
    if (winningLines.length > 0) {
      const gateRoll = this.seededFloat(serverSeed, clientSeed, roundId, 'mh5-gate');
      if (gateRoll >= keepProb) {
        // Rewrite the board into a genuine losing board (break every line).
        for (let guard = 0; guard < 40; guard += 1) {
          let changed = false;
          for (let li = 0; li < PAYLINES.length; li += 1) {
            const [[c0, r0], [c1, r1], [c2, r2]] = PAYLINES[li];
            const s0 = grid[c0][r0];
            if (grid[c1][r1] === s0 && grid[c2][r2] === s0) {
              const u = this.seededFloat(
                serverSeed,
                clientSeed,
                roundId,
                `brk-${li}-${guard}`
              );
              let cand = pickSymbol(u);
              if (cand === s0) {
                const idx = SYMBOL_WEIGHTS.findIndex((s) => s.sym === cand);
                cand = SYMBOL_WEIGHTS[(idx + 1) % SYMBOL_WEIGHTS.length].sym;
              }
              grid[c0][r0] = cand;
              changed = true;
            }
          }
          if (!changed) break;
        }
        winningLines = evaluateLines();
      }
    }

    const multiplier =
      Math.floor(this.seededFloat(serverSeed, clientSeed, roundId, 'mh5-mult') * 5) + 1;

    return { grid, multiplier, winningLines };
  }

  verifyRound(serverSeed: string, serverSeedHash: string): boolean {
    const expectedHash = crypto
      .createHash('sha256')
      .update(serverSeed)
      .digest('hex');
    return expectedHash === serverSeedHash;
  }

  createClientSeed(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}

export const gameRngService = new GameRngService();
