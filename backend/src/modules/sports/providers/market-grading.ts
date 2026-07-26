/**
 * Score-deterministic market grading — the single source of truth shared by:
 *   - the NORMALIZER (which market_type keys we are allowed to publish), and
 *   - the RESULTS/settlement bridge (how each selection is graded).
 *
 * Keeping both in lockstep guarantees that every market we import can be graded
 * from the FINAL SCORE alone, so a ticket can NEVER strand as un-settleable.
 * A selection is always resolved to exactly one of: 'won' | 'lost' | 'void'
 * (void = push/refund). Anything this module cannot classify returns null and
 * MUST NOT be imported as a bettable market.
 *
 * market_type key format:
 *   1x2 | double_chance | dnb | btts | over_under_2_5 | correct_score |
 *   exact_goals               (fixed keys)
 *   ou:<line> | eh:<line> | ah:<line> | tt_home:<line> | tt_away:<line>
 *                             (line-keyed families, line embedded after ':')
 */

export type GradeResult = 'won' | 'lost' | 'void';

/** Parse a line-keyed market_type ("ah:-1.5") → { family, line }. */
export function parseMarketType(marketType: string): { family: string; line: number | null } {
  const idx = marketType.indexOf(':');
  if (idx === -1) return { family: marketType, line: null };
  const family = marketType.slice(0, idx);
  const line = parseFloat(marketType.slice(idx + 1));
  return { family, line: Number.isFinite(line) ? line : null };
}

const norm = (s: string) => s.toLowerCase().trim();

/** Over/Under a total (never call with a quarter line). */
function gradeOverUnder(isOver: boolean, total: number, line: number): GradeResult {
  if (total === line) return 'void'; // integer-line push
  const over = total > line;
  return isOver === over ? 'won' : 'lost';
}

/**
 * Grade one selection from a final score. Returns null when the market_type is
 * not one we can settle (such selections must never be published for betting).
 */
export function gradeSelection(
  marketType: string,
  label: string,
  home: number,
  away: number
): GradeResult | null {
  const { family, line } = parseMarketType(marketType);
  const l = norm(label);
  const total = home + away;

  switch (family) {
    case '1x2': {
      if (l.startsWith('home') || l === '1') return home > away ? 'won' : 'lost';
      if (l.startsWith('draw') || l === 'x' || l.startsWith('tie'))
        return home === away ? 'won' : 'lost';
      if (l.startsWith('away') || l === '2') return home < away ? 'won' : 'lost';
      return null;
    }

    case 'double_chance': {
      // Standardised labels: "Home or Draw" | "Home or Away" | "Draw or Away".
      if (l.includes('home') && l.includes('draw')) return home >= away ? 'won' : 'lost';
      if (l.includes('home') && l.includes('away')) return home !== away ? 'won' : 'lost';
      if (l.includes('draw') && l.includes('away')) return home <= away ? 'won' : 'lost';
      return null;
    }

    case 'dnb': {
      if (home === away) return 'void'; // stake refunded on a draw
      if (l.startsWith('home') || l === '1') return home > away ? 'won' : 'lost';
      if (l.startsWith('away') || l === '2') return home < away ? 'won' : 'lost';
      return null;
    }

    case 'btts': {
      const both = home > 0 && away > 0;
      if (l.startsWith('yes')) return both ? 'won' : 'lost';
      if (l.startsWith('no')) return both ? 'lost' : 'won';
      return null;
    }

    case 'over_under_2_5': {
      if (l.startsWith('over')) return gradeOverUnder(true, total, 2.5);
      if (l.startsWith('under')) return gradeOverUnder(false, total, 2.5);
      return null;
    }

    case 'ou': {
      if (line === null) return null;
      if (l.startsWith('over')) return gradeOverUnder(true, total, line);
      if (l.startsWith('under')) return gradeOverUnder(false, total, line);
      return null;
    }

    case 'tt_home': {
      if (line === null) return null;
      if (l.startsWith('over')) return gradeOverUnder(true, home, line);
      if (l.startsWith('under')) return gradeOverUnder(false, home, line);
      return null;
    }

    case 'tt_away': {
      if (line === null) return null;
      if (l.startsWith('over')) return gradeOverUnder(true, away, line);
      if (l.startsWith('under')) return gradeOverUnder(false, away, line);
      return null;
    }

    case 'correct_score': {
      const m = /^(\d+)\s*-\s*(\d+)$/.exec(l);
      if (!m) return null; // "other"/unknown labels are never imported
      const h = Number(m[1]);
      const a = Number(m[2]);
      return home === h && away === a ? 'won' : 'lost';
    }

    case 'exact_goals': {
      // "N" (exact) or "N+" (at least N).
      const plus = /^(\d+)\s*\+$/.exec(l);
      if (plus) return total >= Number(plus[1]) ? 'won' : 'lost';
      const exact = /^(\d+)$/.exec(l);
      if (exact) return total === Number(exact[1]) ? 'won' : 'lost';
      return null;
    }

    case 'eh': {
      // European (3-way) handicap: apply integer line to the home score.
      if (line === null) return null;
      const adj = home + line;
      if (l.startsWith('home') || l === '1') return adj > away ? 'won' : 'lost';
      if (l.startsWith('draw') || l === 'x') return adj === away ? 'won' : 'lost';
      if (l.startsWith('away') || l === '2') return adj < away ? 'won' : 'lost';
      return null;
    }

    case 'ah': {
      // Asian handicap — only .5 and integer lines are ever imported, so the
      // margin is win/lose (or push/void on an integer line). The stored line
      // is the HOME line; the away line is its negation.
      if (line === null) return null;
      if (l.startsWith('home') || l === '1') {
        const v = home + line - away;
        if (v === 0) return 'void';
        return v > 0 ? 'won' : 'lost';
      }
      if (l.startsWith('away') || l === '2') {
        const v = away - line - home;
        if (v === 0) return 'void';
        return v > 0 ? 'won' : 'lost';
      }
      return null;
    }

    default:
      return null;
  }
}
