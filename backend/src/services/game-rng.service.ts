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
   * Returns a full 3×3 grid (`grid[reel][row]`) of varied symbols, like the
   * real game. To keep the return-to-player controllable while still showing
   * an authentic varied board, we draw the outcome first (lose, or a win on a
   * single payline with a weighted symbol) and then CONSTRUCT a 3×3 board that
   * realises exactly that outcome:
   *   • a win places the chosen symbol on one real payline; all other cells
   *     are filled so NO other payline completes (so the paid lines and the
   *     client's highlighted lines always agree).
   *   • a loss fills the board so NO payline completes.
   * Win frequencies + paytable give ≈100% fair return per paid line, which the
   * caller scales by the admin RTP (default 96.39%).
   */
  generateMultiHot5Outcome(
    serverSeed: string,
    clientSeed: string,
    roundId: string
  ): { grid: string[][]; multiplier: number; winSymbol: string | null; winLine: number | null } {
    const SYMBOLS = [
      'seven',
      'dollar',
      'bell',
      'watermelon',
      'grapes',
      'orange',
      'cherry',
      'lemon',
      'plum',
    ];
    // The 5 fixed paylines as [reel, row] cell triples.
    //   0 middle row, 1 top row, 2 bottom row, 3 ↘ diagonal, 4 ↗ diagonal
    const PAYLINES: Array<Array<[number, number]>> = [
      [[0, 1], [1, 1], [2, 1]],
      [[0, 0], [1, 0], [2, 0]],
      [[0, 2], [1, 2], [2, 2]],
      [[0, 0], [1, 1], [2, 2]],
      [[0, 2], [1, 1], [2, 0]],
    ];
    // Win symbol → probability of winning on it. Spread across symbols for a
    // realistic mix of frequent small wins and occasional big ones (overall
    // hit rate ≈ 46%). Tuned so Σ p·payTable·E[mult]/lines ≈ 1.0 (fair); the
    // admin RTP then scales it (default → ≈96.4%).
    const WIN_TABLE: Array<{ sym: string; p: number }> = [
      { sym: 'plum', p: 0.1093 },
      { sym: 'lemon', p: 0.0765 },
      { sym: 'cherry', p: 0.0656 },
      { sym: 'orange', p: 0.0547 },
      { sym: 'grapes', p: 0.0328 },
      { sym: 'watermelon', p: 0.0328 },
      { sym: 'bell', p: 0.0383 },
      { sym: 'dollar', p: 0.0273 },
      { sym: 'seven', p: 0.0219 },
    ];

    const roll = this.seededFloat(serverSeed, clientSeed, roundId, 'mh5-outcome');
    let cum = 0;
    let winSymbol: string | null = null;
    for (const tier of WIN_TABLE) {
      cum += tier.p;
      if (roll < cum) {
        winSymbol = tier.sym;
        break;
      }
    }

    const multiplier =
      Math.floor(this.seededFloat(serverSeed, clientSeed, roundId, 'mh5-mult') * 5) + 1;
    const winLine = winSymbol
      ? Math.floor(this.seededFloat(serverSeed, clientSeed, roundId, 'mh5-line') * 5) % 5
      : null;

    const symAt = (salt: string) =>
      SYMBOLS[Math.floor(this.seededFloat(serverSeed, clientSeed, roundId, salt) * SYMBOLS.length) % SYMBOLS.length];

    // grid[reel][row]
    const grid: string[][] = [
      [symAt('c0r0'), symAt('c0r1'), symAt('c0r2')],
      [symAt('c1r0'), symAt('c1r1'), symAt('c1r2')],
      [symAt('c2r0'), symAt('c2r1'), symAt('c2r2')],
    ];

    const winCells = new Set<string>();
    if (winSymbol && winLine !== null) {
      for (const [c, r] of PAYLINES[winLine]) {
        grid[c][r] = winSymbol;
        winCells.add(`${c},${r}`);
      }
    }

    const lineComplete = (line: Array<[number, number]>) =>
      grid[line[0][0]][line[0][1]] === grid[line[1][0]][line[1][1]] &&
      grid[line[1][0]][line[1][1]] === grid[line[2][0]][line[2][1]];

    // Correction pass: ensure no payline other than the intended winning line
    // completes, so the money and the on-screen winning lines always match.
    for (let guard = 0; guard < 30; guard += 1) {
      let changed = false;
      for (let li = 0; li < PAYLINES.length; li += 1) {
        if (winLine !== null && li === winLine) continue;
        if (!lineComplete(PAYLINES[li])) continue;
        // Break this accidental line by changing a cell that is NOT part of
        // the protected winning line.
        const target = PAYLINES[li].find(([c, r]) => !winCells.has(`${c},${r}`));
        if (!target) continue;
        const [c, r] = target;
        const current = grid[c][r];
        // Pick a different symbol deterministically.
        const start = Math.floor(
          this.seededFloat(serverSeed, clientSeed, roundId, `fix-${li}-${guard}`) * SYMBOLS.length
        );
        for (let k = 0; k < SYMBOLS.length; k += 1) {
          const cand = SYMBOLS[(start + k) % SYMBOLS.length];
          if (cand !== current) {
            grid[c][r] = cand;
            break;
          }
        }
        changed = true;
      }
      if (!changed) break;
    }

    return { grid, multiplier, winSymbol, winLine };
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
