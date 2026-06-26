import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { Trophy, Users, Target, DollarSign, Eye } from 'lucide-react';
import { toast } from '../../lib/toast';
import * as tournamentsApi from '../../lib/api/tournaments';
import { useAuthStore } from '../../store/auth';

interface TournamentData {
  id: string;
  title: string;
  type: string;
  format: string;
  startDate: string;
  endDate: string;
  status: string;
  prizePool: number;
  entryFee: number;
  entryCriteria: string;
  participants: number;
  leaders: Array<{
    name: string;
    score: string;
    rank: number;
  }>;
}

const StatCard = ({ icon: Icon, title, value, trend }: { icon: any; title: string; value: string; trend?: string }) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <div className="p-2 bg-yellow-50 rounded-lg">
        <Icon className="h-6 w-6 text-yellow-600" />
      </div>
    </div>
    <h3 className="text-lg font-semibold text-gray-900">{value}</h3>
    <p className="text-sm text-gray-500 mt-1">{title}</p>
    {trend && (
      <p className="text-sm text-yellow-600 mt-2">{trend}</p>
    )}
  </div>
);

const LeaderboardModal = ({
  isOpen,
  onClose,
  tournament,
}: {
  isOpen: boolean;
  onClose: () => void;
  tournament: TournamentData;
}) => {
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<tournamentsApi.LeaderboardEntry[]>([]);

  useEffect(() => {
    if (!isOpen || !tournament?.id) return;
    let cancelled = false;
    setLoading(true);
    tournamentsApi
      .getTournamentLeaderboard(tournament.id)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.items ?? []);
      })
      .catch((err: Error) => toast(`Failed to load leaderboard: ${err.message}`, 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, tournament?.id]);

  if (!isOpen) return null;

  // Compute the approximate prize for each rank using the default 50/30/20
  // structure when there's no explicit payout breakdown. Backend uses the
  // same default in /complete so this preview matches.
  const defaultStructure = [0.5, 0.3, 0.2];
  const pool = Number(tournament.prizePool ?? 0);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">{tournament.title} - Leaderboard</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">×</button>
          </div>

          {loading && <p className="text-sm text-gray-500">Loading leaderboard…</p>}

          {!loading && entries.length === 0 && (
            <p className="text-sm text-gray-500">No participants yet.</p>
          )}

          <div className="space-y-3">
            {entries.map((entry, index) => {
              const rank = entry.rank ?? index + 1;
              const share = defaultStructure[rank - 1];
              const prize =
                typeof share === 'number' ? (pool * share).toFixed(2) : null;
              return (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center space-x-4">
                    <span className="text-2xl font-bold text-yellow-600">#{rank}</span>
                    <div>
                      <p className="font-medium">
                        {entry.user_email ?? entry.user_phone ?? entry.user_id}
                      </p>
                      <p className="text-sm text-gray-500">Score: {entry.score}</p>
                    </div>
                  </div>
                  {prize && (
                    <div className="text-right">
                      <p className="font-medium text-green-600">ETB {prize}</p>
                      <p className="text-sm text-gray-500">Indicative prize</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export function ViewTournaments() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedType, setSelectedType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [selectedTournament, setSelectedTournament] = useState<TournamentData | null>(null);
  const [rows, setRows] = useState<TournamentData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!isAuth) return;
    setLoading(true);
    try {
      const res = await tournamentsApi.listTournaments({
        status: selectedStatus || undefined,
        limit: 120,
      });
      const mapped = await Promise.all(
        (res.items ?? []).map(async (t) => {
          let leaders: Array<{ name: string; score: string; rank: number }> = [];
          let count = 0;
          try {
            const lb = await tournamentsApi.getTournamentLeaderboard(t.id);
            count = (lb.items ?? []).length;
            leaders = (lb.items ?? []).slice(0, 3).map((e, idx) => ({
              rank: e.rank ?? idx + 1,
              name: e.user_email ?? e.user_phone ?? e.user_id,
              score: e.score,
            }));
          } catch {
            // ignore
          }
          const entryFee = Number(t.entry_fee ?? t.buy_in ?? 0);
          return {
            id: t.id,
            title: t.name,
            type: t.kind ?? t.game_type ?? '—',
            format:
              ((t.rules as Record<string, unknown>)?.format as string | undefined) ??
              'leaderboard',
            startDate: t.starts_at ? new Date(t.starts_at).toLocaleString() : '—',
            endDate: t.ends_at ? new Date(t.ends_at).toLocaleString() : '—',
            status: t.status,
            prizePool: Number(t.prize_pool ?? 0),
            entryFee,
            entryCriteria: `Entry fee ${entryFee} ${t.currency ?? 'ETB'}`,
            participants: count,
            leaders,
          } as TournamentData;
        })
      );
      setRows(mapped);
    } catch (err) {
      toast(`Failed to load tournaments: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [isAuth, selectedStatus]);

  const filters = [
    {
      label: 'Format',
      options: ['leaderboard', 'knockout', 'jackpot'],
      value: selectedType,
      onChange: setSelectedType,
    },
    {
      label: 'Status',
      options: ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'],
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
  ];

  const columns = [
    { header: 'Title', accessor: 'title' as const },
    { header: 'Type', accessor: 'type' as const },
    { header: 'Format', accessor: 'format' as const },
    { header: 'Start Date', accessor: 'startDate' as const },
    { header: 'End Date', accessor: 'endDate' as const },
    { header: 'Status', accessor: 'status' as const },
    { header: 'Entry Fee', accessor: 'entryFee' as const },
    { header: 'Prize Pool', accessor: 'prizePool' as const },
    { header: 'Participants', accessor: 'participants' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (value: string) => {
        const tournament = filteredRows.find(t => t.id === value);
        return (
          <button
            onClick={() => {
              setSelectedTournament(tournament || null);
              setShowLeaderboard(true);
            }}
            className="text-blue-600 hover:text-blue-800"
          >
            <Eye className="h-5 w-5" />
          </button>
        );
      },
    },
  ];

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) => !selectedType || r.format.toLowerCase() === selectedType.toLowerCase()
      ),
    [rows, selectedType]
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Trophy className="h-8 w-8 text-yellow-500" />
          <h1 className="text-2xl font-semibold text-gray-900">Tournaments</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={Trophy}
          title="Active Tournaments"
          value={loading ? '—' : String(rows.filter((r) => r.status === 'running').length)}
          trend="live count"
        />
        <StatCard
          icon={Users}
          title="Total Participants"
          value={loading ? '—' : String(rows.reduce((acc, r) => acc + r.participants, 0))}
          trend="across all tournaments"
        />
        <StatCard
          icon={Target}
          title="Completion Rate"
          value={loading ? '—' : `${Math.round((rows.filter((r) => r.status === 'completed').length * 100) / Math.max(rows.length, 1))}%`}
          trend="completed / total"
        />
        <StatCard
          icon={DollarSign}
          title="Total Prize Pool"
          value={loading ? '—' : `$${rows.reduce((acc, r) => acc + r.prizePool, 0).toLocaleString()}`}
          trend="from tournaments API"
        />
      </div>

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
        onClear={() => {
          setSelectedType('');
          setSelectedStatus('');
          setStartDate(new Date());
          setEndDate(new Date());
        }}
      />

      <div className="bg-white rounded-lg shadow">
        <DataTable columns={columns} data={filteredRows} />
        {loading && <div className="px-6 pb-6 text-sm text-gray-500">Loading tournaments…</div>}
      </div>

      {selectedTournament && (
        <LeaderboardModal
          isOpen={showLeaderboard}
          onClose={() => setShowLeaderboard(false)}
          tournament={selectedTournament}
        />
      )}
    </div>
  );
}