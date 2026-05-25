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
