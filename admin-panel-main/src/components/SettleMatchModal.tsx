import React, { useEffect, useMemo, useState } from 'react';
import { X, CheckSquare, Save } from 'lucide-react';
import { toast } from '../lib/toast';
import * as sportsbookApi from '../lib/api/sportsbook';

interface MarketRow {
  id: string;
  market_type?: string | null;
  label?: string | null;
  status?: string | null;
  selections: SelectionRow[];
}

interface SelectionRow {
  id: string;
  market_id: string;
  label?: string | null;
  odds_decimal?: string | number | null;
  result?: string | null;
}

type SelectionResult = 'won' | 'lost' | 'void' | '';

interface SettleMatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  matchId?: string | null;
  matchLabel?: string;
  onSettled?: () => void;
}

export function SettleMatchModal({
  isOpen,
  onClose,
  matchId,
  matchLabel,
  onSettled,
}: SettleMatchModalProps) {
  const [homeScore, setHomeScore] = useState<number>(0);
  const [awayScore, setAwayScore] = useState<number>(0);
  const [status, setStatus] = useState<'finished' | 'cancelled' | 'postponed'>('finished');
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [results, setResults] = useState<Record<string, SelectionResult>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!isOpen || !matchId) {
      setMarkets([]);
      setResults({});
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    sportsbookApi
      .listMarkets(matchId)
      .then((res) => {
        if (cancelled) return;
        const raw = (res as { items?: unknown } | unknown[] | undefined);
        const list = Array.isArray(raw) ? raw : (raw as { items?: unknown[] })?.items ?? [];
        const normalised: MarketRow[] = (list as MarketRow[]).map((m) => ({
          id: m.id,
          market_type: m.market_type ?? null,
          label: m.label ?? null,
          status: m.status ?? null,
          selections: Array.isArray(m.selections)
            ? m.selections.map((s) => ({
                id: s.id,
                market_id: s.market_id,
                label: s.label ?? null,
                odds_decimal: s.odds_decimal ?? null,
                result: s.result ?? null,
              }))
            : [],
        }));
        setMarkets(normalised);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err?.message || 'Failed to load markets');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, matchId]);

  const filledCount = useMemo(
    () => Object.values(results).filter((v) => v).length,
    [results]
  );

  const setSelectionResult = (selectionId: string, value: SelectionResult) => {
    setResults((prev) => {
      const next = { ...prev };
      if (value === '') {
        delete next[selectionId];
      } else {
        next[selectionId] = value;
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchId) return;
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore < 0 || awayScore < 0) {
      setError('Scores must be non-negative numbers.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const selection_results = Object.entries(results)
        .filter(([, v]) => v)
        .map(([selection_id, result]) => ({
          selection_id,
          result: result as 'won' | 'lost' | 'void',
        }));
      const out = await sportsbookApi.setMatchResult(matchId, {
        home_score: homeScore,
        away_score: awayScore,
        status,
        selection_results: selection_results.length ? selection_results : undefined,
      });
      toast(
        `Match settled — ${out.settled_selections} selections, ${out.settled_bets} bets resolved.`
      );
      onSettled?.();
      onClose();
    } catch (err) {
      toast(`Failed to settle match: ${(err as Error)?.message ?? err}`, 'error');
      setError((err as Error)?.message ?? 'Failed to settle match');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-[820px] mx-4 max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-3">
            <CheckSquare className="h-5 w-5 text-orange-600" />
            <h2 className="text-xl font-semibold">Settle Match{matchLabel ? ` — ${matchLabel}` : ''}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-xs text-gray-500 mb-4">
          Enters the final score, settles every selection (1X2 / Over-Under /
          BTTS are auto-resolved from the score; explicit overrides below take
          precedence) and credits every bet whose legs are all resolved.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <label className="space-y-1 text-sm">
              <span className="text-gray-700">Home Score</span>
              <input
                type="number"
                min={0}
                value={homeScore}
                onChange={(e) => setHomeScore(Number(e.target.value))}
                className="w-full rounded-md border-gray-300"
                required
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-gray-700">Away Score</span>
              <input
                type="number"
                min={0}
                value={awayScore}
                onChange={(e) => setAwayScore(Number(e.target.value))}
                className="w-full rounded-md border-gray-300"
                required
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-gray-700">Status</span>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as 'finished' | 'cancelled' | 'postponed')
                }
                className="w-full rounded-md border-gray-300"
              >
                <option value="finished">Finished</option>
                <option value="cancelled">Cancelled</option>
                <option value="postponed">Postponed</option>
              </select>
            </label>
          </div>

          <div className="rounded-md border border-gray-200">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
              <h3 className="font-medium text-gray-900">Markets &amp; Selections</h3>
              <span className="text-xs text-gray-500">
                {loading ? 'Loading…' : `${markets.length} markets — ${filledCount} overrides set`}
              </span>
            </div>

            {error && (
              <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">
                {error}
              </div>
            )}

            <div className="divide-y divide-gray-100 max-h-[40vh] overflow-y-auto">
              {!loading && markets.length === 0 && (
                <div className="px-4 py-6 text-sm text-gray-500 text-center">
                  No markets defined for this match. The score will still
                  drive auto-resolution of any standard markets.
                </div>
              )}
              {markets.map((m) => (
                <div key={m.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <span className="font-medium text-gray-900">
                        {m.label ?? m.market_type ?? 'Market'}
                      </span>
                      {m.market_type && m.label && (
                        <span className="ml-2 text-xs text-gray-500">
                          ({m.market_type})
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">{m.status ?? '—'}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {m.selections.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-col">
                          <span className="text-gray-900">{s.label ?? '—'}</span>
                          <span className="text-xs text-gray-500">
                            Odds {Number(s.odds_decimal ?? 0).toFixed(2)}
                            {s.result ? ` · already ${s.result}` : ''}
                          </span>
                        </div>
                        <select
                          value={results[s.id] ?? ''}
                          onChange={(e) =>
                            setSelectionResult(s.id, e.target.value as SelectionResult)
                          }
                          className="rounded-md border-gray-300 text-xs"
                        >
                          <option value="">Auto</option>
                          <option value="won">Won</option>
                          <option value="lost">Lost</option>
                          <option value="void">Void</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4 mr-2" />
              {submitting ? 'Settling…' : 'Settle Match'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
