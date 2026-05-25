import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { Target, TrendingUp, Users, Clock } from 'lucide-react';
import { toast } from '../../lib/toast';
import * as gamePicksApi from '../../lib/api/gamePicks';
import { useAuthStore } from '../../store/auth';

interface GamePickData {
  id: string;
  game: string;
  type: string;
  prediction: string;
  confidence: number;
  subscribers: number;
  status: string;
  startTime: string;
}

const mapPick = (p: gamePicksApi.AdminGamePick): GamePickData => {
  return {
    id: p.id,
    game: String(p.game ?? '—'),
    type: String(p.type ?? 'General'),
    prediction: String(p.prediction ?? '—'),
    confidence: Number(p.confidence ?? 0),
    subscribers: Number(p.subscribers ?? 0),
    status: String(p.status ?? 'Active'),
    startTime: p.start_time ? new Date(p.start_time).toLocaleString() : '—',
  };
};

const columns = [
  { header: 'Game', accessor: 'game' as const },
  { header: 'Type', accessor: 'type' as const },
  { header: 'Prediction', accessor: 'prediction' as const },
  { header: 'Confidence %', accessor: 'confidence' as const },
  { header: 'Subscribers', accessor: 'subscribers' as const },
  { header: 'Status', accessor: 'status' as const },
  { header: 'Start Time', accessor: 'startTime' as const },
];

const tabs = [
  { id: 'active', label: 'Active Picks' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
  { id: 'analysis', label: 'Analysis' },
];

const StatCard = ({ icon: Icon, title, value, trend }: { icon: any, title: string, value: string, trend?: string }) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-green-50 rounded-lg">
          <Icon className="h-6 w-6 text-green-600" />
        </div>
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </div>
      {trend && (
        <span className="text-sm text-green-600">{trend}</span>
      )}
    </div>
  </div>
);

export function GamePicks() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('active');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedType, setSelectedType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [rows, setRows] = useState<GamePickData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    gamePicksApi
      .listAdminGamePicks({ status: activeTab as 'active' | 'upcoming' | 'completed' | 'analysis' })
      .then((res) => {
        if (cancelled) return;
        setRows((res ?? []).map(mapPick));
      })
      .catch((err: Error) => toast(`Failed to load game picks: ${err.message ?? err}`, 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, activeTab]);

  const filters = [
    {
      label: 'Type',
      options: Array.from(new Set(rows.map((r) => r.type).filter(Boolean))),
      value: selectedType,
      onChange: setSelectedType,
    },
    {
      label: 'Status',
      options: Array.from(new Set(rows.map((r) => r.status).filter(Boolean))),
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
  ];

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!selectedType || r.type === selectedType) &&
          (!selectedStatus || r.status === selectedStatus)
      ),
    [rows, selectedType, selectedStatus]
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Target className="h-8 w-8 text-green-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Game Picks</h1>
        </div>
        <div className="space-x-4">
          <button
            onClick={() => toast('Game picks exported.')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Export Picks
          </button>
          <button
            onClick={async () => {
              try {
                const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                await gamePicksApi.createAdminGamePick({
                  game: 'Manual Pick',
                  type: 'General',
                  prediction: 'TBD',
                  confidence: 50,
                  status: 'Upcoming',
                  start_time: start,
                });
                toast('Pick created.');
                const refreshed = await gamePicksApi.listAdminGamePicks({
                  status: activeTab as 'active' | 'upcoming' | 'completed' | 'analysis',
                });
                setRows((refreshed ?? []).map(mapPick));
              } catch (err) {
                toast(`Failed to create pick: ${(err as Error).message ?? err}`, 'error');
              }
            }}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
          >
            Add Pick
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={Target}
          title="Success Rate"
          value={
            loading
              ? '—'
              : `${Math.round(filteredRows.reduce((acc, r) => acc + r.confidence, 0) / Math.max(filteredRows.length, 1))}%`
          }
          trend="average confidence"
        />
        <StatCard
          icon={TrendingUp}
          title="Active Picks"
          value={loading ? '—' : String(filteredRows.filter((r) => /active/i.test(r.status)).length)}
        />
        <StatCard
          icon={Users}
          title="Total Subscribers"
          value={loading ? '—' : String(filteredRows.reduce((acc, r) => acc + r.subscribers, 0))}
          trend="from pick metadata"
        />
        <StatCard
          icon={Clock}
          title="Avg. Response Time"
          value={loading ? '—' : `${filteredRows.length} rows`}
        />
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
      />

      <div className="bg-white rounded-lg shadow">
        <DataTable columns={columns} data={filteredRows} />
      </div>
    </div>
  );
}
