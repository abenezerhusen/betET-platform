import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Gamepad2, Power, Search } from 'lucide-react';
import * as rtpApi from '../../lib/api/rtp';
import { toast } from '../../lib/toast';
import { useAuthStore } from '../../store/auth';

/**
 * /games/list — enable / disable internal games for the user panel lobby.
 * Disabled games are hidden from GET /api/games/lobby and blocked on bet APIs.
 */
export function GameList() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [games, setGames] = useState<rtpApi.InternalGameRtp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isAuth) return;
    setLoading(true);
    rtpApi
      .listInternalGamesRtp()
      .then(setGames)
      .catch((err: Error) => toast(`Failed to load games: ${err.message}`, 'error'))
      .finally(() => setLoading(false));
  }, [isAuth]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return games;
    return games.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.provider.toLowerCase().includes(q) ||
        (g.gameType ?? '').toLowerCase().includes(q) ||
        g.id.toLowerCase().includes(q)
    );
  }, [games, search]);

  const toggleStatus = async (g: rtpApi.InternalGameRtp) => {
    const next: rtpApi.GameStatus = g.status === 'Active' ? 'Disabled' : 'Active';
    setStatusUpdating(g.id);
    try {
      await rtpApi.updateGameStatus(g.id, next);
      setGames((prev) =>
        prev.map((row) => (row.id === g.id ? { ...row, status: next } : row))
      );
      toast(
        next === 'Disabled'
          ? `${g.name} disabled — hidden from user panel.`
          : `${g.name} enabled — visible on user panel.`
      );
    } catch (err) {
      toast(`Status update failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setStatusUpdating(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Gamepad2 className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Game List</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Enable or disable games on the user panel. Disabled games are removed from the lobby.
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="search"
            placeholder="Search games…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm w-full sm:w-64"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">
            Internal Games ({loading ? 'loading…' : `${games.length} games`})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Game
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && games.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                    Loading games…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                    No games matched your search.
                  </td>
                </tr>
              ) : (
                filtered.map((g) => (
                  <tr key={g.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 whitespace-nowrap">
                      {g.name}
                      <div className="text-xs text-gray-400 mt-0.5">{g.id}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                      {g.gameType ?? '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                      {g.provider}
                    </td>
                    <td className="px-6 py-4 text-sm whitespace-nowrap">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          g.status === 'Active'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {g.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm whitespace-nowrap">
                      <button
                        type="button"
                        disabled={statusUpdating === g.id}
                        onClick={() => void toggleStatus(g)}
                        className={`inline-flex items-center text-sm font-medium disabled:opacity-50 ${
                          g.status === 'Active'
                            ? 'text-red-600 hover:text-red-800'
                            : 'text-green-600 hover:text-green-800'
                        }`}
                      >
                        <Power size={14} className="mr-1" />
                        {g.status === 'Active' ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
