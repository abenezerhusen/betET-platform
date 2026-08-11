/**
 * Settlement-grading unit tests (STEP 22).
 *
 * `gradeSelection` is the single source of truth used by the auto-settlement
 * bridge (results.service → gradeEventFromScore) to turn a final score into
 * won | lost | void per selection. These tests pin down:
 *   - every market family the platform publishes,
 *   - push/void rules (DNB draw, integer AH/OU lines),
 *   - the "never guess" rule: unknown market types return null so the leg
 *     stays unsettled and is flagged for review instead of being mis-graded.
 */
import { describe, it, expect } from 'vitest';
import { gradeSelection, parseMarketType } from './market-grading';

describe('parseMarketType', () => {
  it('parses fixed keys with no line', () => {
    expect(parseMarketType('1x2')).toEqual({ family: '1x2', line: null });
    expect(parseMarketType('btts')).toEqual({ family: 'btts', line: null });
  });

  it('parses line-keyed families', () => {
    expect(parseMarketType('ou:2.5')).toEqual({ family: 'ou', line: 2.5 });
    expect(parseMarketType('ah:-1.5')).toEqual({ family: 'ah', line: -1.5 });
    expect(parseMarketType('eh:1')).toEqual({ family: 'eh', line: 1 });
  });

  it('returns null line for a malformed line', () => {
    expect(parseMarketType('ou:abc')).toEqual({ family: 'ou', line: null });
  });
});

describe('gradeSelection — 1x2', () => {
  it('grades home win', () => {
    expect(gradeSelection('1x2', 'Home', 2, 1)).toBe('won');
    expect(gradeSelection('1x2', 'Away', 2, 1)).toBe('lost');
    expect(gradeSelection('1x2', 'Draw', 2, 1)).toBe('lost');
  });

  it('grades draw', () => {
    expect(gradeSelection('1x2', 'Draw', 1, 1)).toBe('won');
    expect(gradeSelection('1x2', 'Home', 1, 1)).toBe('lost');
    expect(gradeSelection('1x2', 'Away', 1, 1)).toBe('lost');
  });

  it('accepts numeric labels', () => {
    expect(gradeSelection('1x2', '1', 3, 0)).toBe('won');
    expect(gradeSelection('1x2', 'X', 0, 0)).toBe('won');
    expect(gradeSelection('1x2', '2', 0, 3)).toBe('won');
  });

  it('returns null for an unknown label (never guesses)', () => {
    expect(gradeSelection('1x2', 'Banana', 1, 0)).toBeNull();
  });
});

describe('gradeSelection — double chance', () => {
  it('grades all three outcomes for a home win', () => {
    expect(gradeSelection('double_chance', 'Home or Draw', 2, 0)).toBe('won');
    expect(gradeSelection('double_chance', 'Home or Away', 2, 0)).toBe('won');
    expect(gradeSelection('double_chance', 'Draw or Away', 2, 0)).toBe('lost');
  });

  it('grades all three outcomes for a draw', () => {
    expect(gradeSelection('double_chance', 'Home or Draw', 1, 1)).toBe('won');
    expect(gradeSelection('double_chance', 'Home or Away', 1, 1)).toBe('lost');
    expect(gradeSelection('double_chance', 'Draw or Away', 1, 1)).toBe('won');
  });
});

describe('gradeSelection — draw no bet (void on draw)', () => {
  it('refunds the stake on a draw', () => {
    expect(gradeSelection('dnb', 'Home', 1, 1)).toBe('void');
    expect(gradeSelection('dnb', 'Away', 1, 1)).toBe('void');
  });

  it('grades a decisive result normally', () => {
    expect(gradeSelection('dnb', 'Home', 2, 0)).toBe('won');
    expect(gradeSelection('dnb', 'Away', 2, 0)).toBe('lost');
  });
});

describe('gradeSelection — both teams to score', () => {
  it('grades yes/no', () => {
    expect(gradeSelection('btts', 'Yes', 1, 1)).toBe('won');
    expect(gradeSelection('btts', 'No', 1, 1)).toBe('lost');
    expect(gradeSelection('btts', 'Yes', 2, 0)).toBe('lost');
    expect(gradeSelection('btts', 'No', 0, 0)).toBe('won');
  });
});

describe('gradeSelection — over/under', () => {
  it('grades the legacy 2.5 market', () => {
    expect(gradeSelection('over_under_2_5', 'Over', 2, 1)).toBe('won');
    expect(gradeSelection('over_under_2_5', 'Under', 2, 1)).toBe('lost');
    expect(gradeSelection('over_under_2_5', 'Over', 1, 1)).toBe('lost');
  });

  it('grades line-keyed totals', () => {
    expect(gradeSelection('ou:3.5', 'Over 3.5', 3, 1)).toBe('won');
    expect(gradeSelection('ou:3.5', 'Under 3.5', 3, 1)).toBe('lost');
  });

  it('pushes (void) on an exact integer line', () => {
    expect(gradeSelection('ou:3', 'Over 3', 2, 1)).toBe('void');
    expect(gradeSelection('ou:3', 'Under 3', 2, 1)).toBe('void');
  });

  it('returns null when the line is missing', () => {
    expect(gradeSelection('ou:', 'Over', 2, 1)).toBeNull();
  });
});

describe('gradeSelection — team totals', () => {
  it('grades home team total against the home score only', () => {
    expect(gradeSelection('tt_home:1.5', 'Over 1.5', 2, 0)).toBe('won');
    expect(gradeSelection('tt_home:1.5', 'Under 1.5', 2, 0)).toBe('lost');
  });

  it('grades away team total against the away score only', () => {
    expect(gradeSelection('tt_away:0.5', 'Over 0.5', 3, 0)).toBe('lost');
    expect(gradeSelection('tt_away:0.5', 'Under 0.5', 3, 0)).toBe('won');
  });

  it('pushes on an integer team-total line', () => {
    expect(gradeSelection('tt_home:2', 'Over 2', 2, 1)).toBe('void');
  });
});

describe('gradeSelection — correct score', () => {
  it('grades an exact score', () => {
    expect(gradeSelection('correct_score', '2-1', 2, 1)).toBe('won');
    expect(gradeSelection('correct_score', '1-1', 2, 1)).toBe('lost');
  });

  it('returns null for non-score labels like "Other"', () => {
    expect(gradeSelection('correct_score', 'Other', 2, 1)).toBeNull();
  });
});

describe('gradeSelection — exact goals', () => {
  it('grades exact totals', () => {
    expect(gradeSelection('exact_goals', '3', 2, 1)).toBe('won');
    expect(gradeSelection('exact_goals', '2', 2, 1)).toBe('lost');
  });

  it('grades "N+" as at-least-N', () => {
    expect(gradeSelection('exact_goals', '2+', 2, 1)).toBe('won');
    expect(gradeSelection('exact_goals', '4+', 2, 1)).toBe('lost');
  });
});

describe('gradeSelection — european handicap (3-way)', () => {
  it('applies the line to the home score', () => {
    // 0-1 with home +1 → adjusted 1-1 → handicap draw wins.
    expect(gradeSelection('eh:1', 'Home +1', 0, 1)).toBe('lost');
    expect(gradeSelection('eh:1', 'Draw +1', 0, 1)).toBe('won');
    expect(gradeSelection('eh:1', 'Away +1', 0, 1)).toBe('lost');
  });
});

describe('gradeSelection — asian handicap', () => {
  it('grades half lines with no push possible', () => {
    // Home -0.5: home must win outright.
    expect(gradeSelection('ah:-0.5', 'Home -0.5', 2, 1)).toBe('won');
    expect(gradeSelection('ah:-0.5', 'Home -0.5', 1, 1)).toBe('lost');
    expect(gradeSelection('ah:-0.5', 'Away +0.5', 1, 1)).toBe('won');
  });

  it('pushes on an integer line when the margin equals the line', () => {
    // Home -1 and home wins by exactly one → stake refunded both sides.
    expect(gradeSelection('ah:-1', 'Home -1', 2, 1)).toBe('void');
    expect(gradeSelection('ah:-1', 'Away +1', 2, 1)).toBe('void');
  });

  it('grades an integer line decisively when the margin differs', () => {
    expect(gradeSelection('ah:-1', 'Home -1', 3, 1)).toBe('won');
    expect(gradeSelection('ah:-1', 'Away +1', 3, 1)).toBe('lost');
  });
});

describe('gradeSelection — safety', () => {
  it('returns null for market types it cannot settle', () => {
    expect(gradeSelection('first_goalscorer', 'Player X', 2, 1)).toBeNull();
    expect(gradeSelection('corners_ou:9.5', 'Over 9.5', 2, 1)).toBeNull();
    expect(gradeSelection('ht_ft', 'Home/Home', 2, 1)).toBeNull();
  });
});
