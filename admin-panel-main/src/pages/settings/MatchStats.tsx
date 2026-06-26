import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { BarChart2, TrendingUp, Users, Timer, CheckSquare } from 'lucide-react';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import * as opsApi from '../../lib/api/ops';
import { useAuthStore } from '../../store/auth';
import { SettleMatchModal } from '../../components/SettleMatchModal';

interface MatchStatData {
  id: string;
  match: string;
  league: string;
  totalBets: number;
  totalStake: number;
  avgOdds: number;
  winRate: number;
  status: string;
}

const tabs = [
  { id: 'live', label: 'Live Matches' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
  { id: 'analysis', label: 'Analysis' },
];

const StatCard = ({
  icon: Icon,
  title,
  value,
  trend,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  trend?: string;
}) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-orange-50 rounded-lg">
          <Icon className="h-6 w-6 text-orange-600" />
        </div>
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </div>
      {trend && <span className="text-sm text-green-600">{trend}</span>}
    </div>
  </div>
);

export function MatchStats() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('live');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedLeague, setSelectedLeague] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [rows, setRows] = useState<MatchStatData[]>([]);
  const [summary, setSummary] = useState<{
    total_active_matches: number;
    total_bets_today: number;
    total_stake_today: number;
    avg_win_rate_today: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [settleMatchId, setSettleMatchId] = useState<string | null>(null);
  const [settleMatchLabel, setSettleMatchLabel] = useState<string>('');
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      opsApi.listMatchStats({
        status: activeTab === 'analysis' ? 'completed' : (activeTab as 'live' | 'upcoming' | 'completed'),
        page: 1,
        limit: 200,
      }),
      opsApi.getMatchStatsSummary(),
    ])
      .then(([statsRes, summaryRes]) => {
        if (cancelled) return;
        const items = Array.isArray(statsRes) ? statsRes : [];
        setRows(
          items.map((m) => ({
            id: m.match_id,
            match: m.match,
            league: m.league,
            totalBets: Number(m.total_bets ?? 0),
            totalStake: Number(m.total_stake ?? 0),
            avgOdds: Number(m.avg_odds ?? 0),
            winRate: Number(m.win_rate ?? 0),
            status: m.status,
          }))
        );
        setSummary(summaryRes);
      })
      .catch((err: Error) => toast(`Failed to load match stats: ${err.message ?? err}`, 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, startDate, endDate, activeTab, reloadTick]);

  const filters = [
    { label: 'League', options: Array.from(new Set(rows.map((r) => r.league))).filter(Boolean), value: selectedLeague, onChange: setSelectedLeague },
    { label: 'Status', options: ['scheduled', 'live', 'finished', 'postponed', 'cancelled'], value: selectedStatus, onChange: setSelectedStatus },
  ];

  const data = useMemo(
    () =>
      rows.filter((r) => {
        if (selectedLeague && r.league !== selectedLeague) return false;
        if (selectedStatus && r.status !== selectedStatus) return false;
        return true;
      }),
    [rows, selectedLeague, selectedStatus, activeTab]
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <BarChart2 className="h-8 w-8 text-orange-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Match Statistics</h1>
        </div>
        <div className="space-x-4">
          <button
            onClick={() => {
              opsApi
                .listMatchStats({
                  status: activeTab === 'analysis' ? 'completed' : (activeTab as 'live' | 'upcoming' | 'completed'),
                  page: 1,
                  limit: 500,
                  export: 'csv',
                })
                .then((res) => {
                  if (Array.isArray(res) || !('csv' in res)) {
                    throw new Error('CSV export unavailable');
                  }
                  const lines = res.csv.split('\n');
                  const [header, ...body] = lines;
                  const cols = header.split(',');
                  const rows = body.filter(Boolean).map((line) => {
                    const vals = line.split(',');
                    return {
                      match: vals[1]?.replaceAll('"', '') ?? '',
                      league: vals[2]?.replaceAll('"', '') ?? '',
                      totalBets: Number(vals[3] ?? 0),
                      totalStake: Number(vals[4] ?? 0),
                      avgOdds: Number(vals[5] ?? 0),
                      winRate: Number(vals[6] ?? 0),
                      status: vals[7] ?? '',
                    };
                  });
                  downloadCsv(
                    [
                      { header: 'Match', accessor: 'match' },
                      { header: 'League', accessor: 'league' },
                      { header: 'Total Bets', accessor: 'totalBets' },
                      { header: 'Total Stake', accessor: 'totalStake' },
                      { header: 'Avg Odds', accessor: 'avgOdds' },
                      { header: 'Win Rate', accessor: 'winRate' },
                      { header: 'Status', accessor: 'status' },
                    ],
                    rows,
                    `match-stats-${todayStamp()}`
                  );
                  toast(`Exported ${rows.length} match stats.`);
                })
                .catch((err: Error) => toast(`Export failed: ${err.message ?? err}`, 'error'));
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Export Stats
          </button>
          <button
            onClick={() => {
              setStartDate(new Date(startDate));
              toast('Match stats refreshed.');
            }}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-orange-600 hover:bg-orange-700"
          >
            Refresh Data
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={BarChart2} title="Total Matches" value={loading ? '—' : String(rows.length)} />
        <StatCard icon={TrendingUp} title="Average Odds" value={loading ? '—' : String((rows.reduce((a, r) => a + r.avgOdds, 0) / Math.max(rows.length, 1)).toFixed(2))} />
        <StatCard icon={Users} title="Total Bets Today" value={loading ? '—' : String(summary?.total_bets_today ?? 0)} />
        <StatCard icon={Timer} title="Active Matches" value={loading ? '—' : String(summary?.total_active_matches ?? 0)} />
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
        onClear={() => {
          setSelectedLeague('');
          setSelectedStatus('');
          setStartDate(new Date());
          setEndDate(new Date());
        }}
      />

      <div className="bg-white rounded-lg shadow">
        <DataTable
          columns={[
            { header: 'Match', accessor: 'match' as const },
            { header: 'League', accessor: 'league' as const },
            { header: 'Total Bets', accessor: 'totalBets' as const },
            { header: 'Total Stake', accessor: 'totalStake' as const },
            { header: 'Avg Odds', accessor: 'avgOdds' as const },
            { header: 'Win Rate %', accessor: 'winRate' as const },
            { header: 'Status', accessor: 'status' as const },
            {
              header: 'Actions',
              accessor: 'id' as const,
              render: (_value, row) => (
                <button
                  type="button"
                  onClick={() => {
                    setSettleMatchId(row.id);
                    setSettleMatchLabel(`${row.match} · ${row.league}`);
                  }}
                  className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-md border border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100"
                >
                  <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
                  Settle
                </button>
              ),
            },
          ]}
          data={data}
        />
        {loading && <div className="px-6 pb-6 text-sm text-gray-500">Loading match statistics…</div>}
      </div>

      <SettleMatchModal
        isOpen={settleMatchId !== null}
        onClose={() => setSettleMatchId(null)}
        matchId={settleMatchId}
        matchLabel={settleMatchLabel}
        onSettled={() => setReloadTick((t) => t + 1)}
      />
    </div>
  );
}
