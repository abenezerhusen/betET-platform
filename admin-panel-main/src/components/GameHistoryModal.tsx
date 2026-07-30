import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Search, RotateCcw, History, ChevronDown, ChevronRight } from 'lucide-react';
import * as gameActivityApi from '../lib/api/game-activity';
import type { GameBetRow } from '../lib/api/game-activity';
import { formatCurrency } from '../lib/format';
import { toast } from '../lib/toast';

interface GameHistoryModalProps {
  /** Internal game id/slug, e.g. "multi-hot-5". */
  gameId: string;
  gameName: string;
  onClose: () => void;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** The 20 numbers drawn for a Fast Keno round (round column, else bet metadata). */
function drawnNumbersOf(r: GameBetRow): number[] {
  if (Array.isArray(r.drawn_numbers) && r.drawn_numbers.length) return r.drawn_numbers;
  const meta = (r.metadata ?? {}) as { all_numbers?: unknown };
  return Array.isArray(meta.all_numbers) ? (meta.all_numbers as number[]) : [];
}

/**
 * Complete game history for a single internal game, opened from the Game List
 * "History" action. Shows every recorded play with its 8-digit Game ID, the
 * player, win/lose result, bet amount, winning amount and date/time.
 *
 * Supports filtering by date range and by the 8-digit Game ID.
 */
export function GameHistoryModal({ gameId, gameName, onClose }: GameHistoryModalProps) {
  const [rows, setRows] = useState<GameBetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [code, setCode] = useState('');
  // Rows expanded to reveal the Fast Keno drawn-numbers result.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const load = useCallback(
    (filters?: { from?: string; to?: string; code?: string }) => {
      setLoading(true);
      const query: gameActivityApi.GameActivityQuery = {
        game_id: gameId,
        limit: 500,
        offset: 0,
      };
      // Date inputs are calendar days; widen to full-day boundaries in UTC.
      if (filters?.from) query.from = new Date(`${filters.from}T00:00:00`).toISOString();
      if (filters?.to) query.to = new Date(`${filters.to}T23:59:59.999`).toISOString();
      if (filters?.code?.trim()) query.code = filters.code.trim();
      gameActivityApi
        .listGameActivity(query)
        .then((res) => setRows(res.items ?? []))
        .catch((err: Error) => toast(`Failed to load history: ${err.message}`, 'error'))
        .finally(() => setLoading(false));
    },
    [gameId]
  );

  useEffect(() => {
    load();
  }, [load]);

  const applyFilters = () => load({ from, to, code });
  const resetFilters = () => {
    setFrom('');
    setTo('');
    setCode('');
    load();
  };

  const summary = useMemo(() => {
    let staked = 0;
    let won = 0;
    let wins = 0;
    for (const r of rows) {
      staked += Number(r.amount) || 0;
      won += Number(r.payout) || 0;
      if (r.result === 'win') wins += 1;
    }
    return { staked, won, wins, losses: rows.length - wins };
  }, [rows]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <History className="h-6 w-6 text-blue-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Game History</h2>
              <p className="text-sm text-gray-500">{gameName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        {/* Filters */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From date</label>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To date</label>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Game ID</label>
              <input
                type="search"
                value={code}
                placeholder="e.g. 10000042"
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyFilters();
                }}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm w-40"
              />
            </div>
            <button
              type="button"
              onClick={applyFilters}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
            >
              <Search size={14} className="mr-1.5" /> Apply
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center px-3 py-2 border border-gray-300 text-gray-600 rounded-md text-sm font-medium hover:bg-gray-100"
            >
              <RotateCcw size={14} className="mr-1.5" /> Reset
            </button>
          </div>
        </div>

        {/* Summary */}
        <div className="px-6 py-3 border-b border-gray-200 flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <span className="text-gray-500">
            Records: <span className="font-semibold text-gray-900">{rows.length}</span>
          </span>
          <span className="text-gray-500">
            Total Bet: <span className="font-semibold text-gray-900">{formatCurrency(summary.staked)}</span>
          </span>
          <span className="text-gray-500">
            Total Won: <span className="font-semibold text-gray-900">{formatCurrency(summary.won)}</span>
          </span>
          <span className="text-gray-500">
            Wins / Losses:{' '}
            <span className="font-semibold text-green-700">{summary.wins}</span> /{' '}
            <span className="font-semibold text-red-700">{summary.losses}</span>
          </span>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Game ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Result</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Bet Amount</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Winning Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date &amp; Time</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                    Loading history…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                    No game history found for the selected filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isKeno = r.game_id === 'fast-keno';
                  const drawn = isKeno ? drawnNumbersOf(r) : [];
                  const selected = Array.isArray(r.selected_numbers) ? r.selected_numbers : [];
                  const canExpand = isKeno && drawn.length > 0;
                  const isOpen = expanded.has(r.id);
                  return (
                  <React.Fragment key={r.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-mono font-medium text-gray-900 whitespace-nowrap">
                      {canExpand ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(r.id)}
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                          title="Show drawn numbers"
                        >
                          {isOpen ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                          {r.game_code ?? '—'}
                        </button>
                      ) : (
                        r.game_code ?? '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {r.user_name ?? r.user_phone ?? r.user_email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {r.result === 'win' ? (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Win
                        </span>
                      ) : r.result === 'loss' ? (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Lose
                        </span>
                      ) : (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 text-right whitespace-nowrap">
                      {formatCurrency(r.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                      <span className={Number(r.payout) > 0 ? 'text-green-700 font-medium' : 'text-gray-500'}>
                        {formatCurrency(r.payout)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {fmtDateTime(r.created_at)}
                    </td>
                  </tr>
                  {canExpand && isOpen && (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="px-4 py-4">
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
                              Drawn Numbers (20)
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {drawn.map((n, idx) => {
                                const hit = selected.includes(n);
                                return (
                                  <span
                                    key={`${r.id}-d-${idx}`}
                                    className={`inline-flex items-center justify-center w-8 h-8 rounded text-xs font-semibold ${
                                      hit
                                        ? 'bg-green-600 text-white'
                                        : 'bg-white border border-gray-300 text-gray-700'
                                    }`}
                                  >
                                    {n}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                          {selected.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">
                                Player Picks ({selected.length}) ·{' '}
                                {selected.filter((n) => drawn.includes(n)).length} hit
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {selected.map((n, idx) => {
                                  const hit = drawn.includes(n);
                                  return (
                                    <span
                                      key={`${r.id}-s-${idx}`}
                                      className={`inline-flex items-center justify-center w-8 h-8 rounded text-xs font-semibold ${
                                        hit
                                          ? 'bg-green-600 text-white'
                                          : 'bg-red-100 text-red-700 border border-red-200'
                                      }`}
                                    >
                                      {n}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
