/**
 * /games/activity — internal-game activity monitor.
 *
 * Per-bet view of every Aviator / JetX / Fast Keno / Multi Hot 5 wager, read
 * from `GET /api/admin/game-activity`. Complements the Wallet Transactions
 * page (which shows the `bet_stake` / `bet_win` money movements) by exposing
 * the round-level detail: stake, cash-out multiplier, payout, net result and
 * win / loss outcome — all tied back to the player account.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { FileDown } from 'lucide-react';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import * as gameApi from '../../lib/api/game-activity';
import { useAuthStore } from '../../store/auth';
import { formatCurrency, toIso, toNumber } from '../../lib/format';

interface GameActivityRow {
  id: string;
  date: string;
  user: string;
  phone: string;
  game: string;
  stake: number;
  multiplier: number | null;
  payout: number;
  net: number;
  result: string;
  status: string;
  raw: gameApi.GameBetRow;
}

const num = (v: string | number | null | undefined): number => toNumber(v);

const GAME_LABELS: Record<string, string> = {
  aviator: 'Aviator',
  jetx: 'JetX',
  'fast-keno': 'Fast Keno',
  'multi-hot-5': 'Multi Hot 5',
};

const GAME_FILTER_OPTIONS = ['Aviator', 'JetX', 'Fast Keno', 'Multi Hot 5'];
const GAME_LABEL_TO_ID: Record<string, gameApi.GameActivityQuery['game_id']> = {
  Aviator: 'aviator',
  JetX: 'jetx',
  'Fast Keno': 'fast-keno',
  'Multi Hot 5': 'multi-hot-5',
};

const RESULT_FILTER_OPTIONS = ['Win', 'Loss', 'Pending'];
const RESULT_LABEL_TO_VALUE: Record<string, gameApi.GameActivityQuery['result']> = {
  Win: 'win',
  Loss: 'loss',
  Pending: 'pending',
};

function mapRow(r: gameApi.GameBetRow): GameActivityRow {
  return {
    id: r.id,
    date: r.created_at ? new Date(r.created_at).toLocaleString() : '',
    user: String(r.user_name ?? r.user_email ?? r.user_phone ?? ''),
    phone: String(r.user_phone ?? ''),
    game: GAME_LABELS[r.game_id] ?? r.game_id,
    stake: num(r.amount),
    multiplier: r.multiplier != null ? num(r.multiplier) : null,
    payout: num(r.payout),
    net: num(r.net),
    result: String(r.result ?? ''),
    status: String(r.status ?? ''),
    raw: r,
  };
}

export function GameActivity() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canView = hasPermission('games.activity.view');

  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedGame, setSelectedGame] = useState('');
  const [selectedResult, setSelectedResult] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  const [rows, setRows] = useState<GameActivityRow[]>([]);
  const [summary, setSummary] = useState<gameApi.GameActivitySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuth || !canView) return;
    let cancelled = false;
    setLoading(true);
    gameApi
      .listGameActivity({
        from: toIso(startDate),
        to: toIso(endDate),
        phone: phoneNumber || undefined,
        game_id: GAME_LABEL_TO_ID[selectedGame] ?? undefined,
        result: RESULT_LABEL_TO_VALUE[selectedResult] ?? undefined,
        min_amount: minAmount ? Number(minAmount) : undefined,
        max_amount: maxAmount ? Number(maxAmount) : undefined,
        limit: 500,
        offset: 0,
      })
      .then((res) => {
        if (cancelled) return;
        setRows(res.items.map(mapRow));
        setSummary(res.summary ?? null);
      })
      .catch((err: Error) =>
        toast(`Failed to load game activity: ${err.message}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    isAuth,
    canView,
    startDate,
    endDate,
    phoneNumber,
    selectedGame,
    selectedResult,
    minAmount,
    maxAmount,
  ]);

  const filters = [
    {
      label: 'Phone Number',
      options: [] as string[],
      value: phoneNumber,
      onChange: setPhoneNumber,
      type: 'text' as const,
    },
    {
      label: 'Game',
      options: GAME_FILTER_OPTIONS,
      value: selectedGame,
      onChange: setSelectedGame,
    },
    {
      label: 'Result',
      options: RESULT_FILTER_OPTIONS,
      value: selectedResult,
      onChange: setSelectedResult,
    },
    {
      label: 'Min Stake',
      options: [] as string[],
      value: minAmount,
      onChange: setMinAmount,
      type: 'number' as const,
    },
    {
      label: 'Max Stake',
      options: [] as string[],
      value: maxAmount,
      onChange: setMaxAmount,
      type: 'number' as const,
    },
  ];

  const ResultPill = ({ r }: { r: string }) => {
    const cls =
      r === 'win'
        ? 'bg-green-100 text-green-800'
        : r === 'loss'
        ? 'bg-red-100 text-red-800'
        : 'bg-gray-100 text-gray-700';
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${cls}`}>
        {r || '—'}
      </span>
    );
  };

  const columns = useMemo(
    () => [
      { header: 'Date', accessor: 'date' as const },
      { header: 'Player', accessor: 'user' as const },
      { header: 'Phone', accessor: 'phone' as const },
      { header: 'Game', accessor: 'game' as const },
      {
        header: 'Stake',
        accessor: 'stake' as const,
        render: (v: number) => formatCurrency(v),
      },
      {
        header: 'Multiplier',
        accessor: 'multiplier' as const,
        render: (v: number | null) => (v != null ? `${v.toFixed(2)}x` : '—'),
      },
      {
        header: 'Payout',
        accessor: 'payout' as const,
        render: (v: number) => formatCurrency(v),
      },
      {
        header: 'Net',
        accessor: 'net' as const,
        render: (v: number) => (
          <span className={v >= 0 ? 'text-green-700' : 'text-red-700'}>
            {v >= 0 ? '+' : ''}
            {formatCurrency(v)}
          </span>
        ),
      },
      {
        header: 'Result',
        accessor: 'result' as const,
        render: (v: string) => <ResultPill r={v} />,
      },
      {
        header: 'Status',
        accessor: 'status' as const,
        render: (v: string) => (
          <span className="capitalize">{v.replace(/_/g, ' ')}</span>
        ),
      },
    ],
    []
  );

  const handleExport = () => {
    if (rows.length === 0) {
      toast('No game activity to export.', 'error');
      return;
    }
    downloadCsv(
      [
        { header: 'Date', accessor: 'date' as const },
        { header: 'Player', accessor: 'user' as const },
        { header: 'Phone', accessor: 'phone' as const },
        { header: 'Game', accessor: 'game' as const },
        { header: 'Stake', accessor: 'stake' as const },
        { header: 'Multiplier', accessor: 'multiplier' as const },
        { header: 'Payout', accessor: 'payout' as const },
        { header: 'Net', accessor: 'net' as const },
        { header: 'Result', accessor: 'result' as const },
        { header: 'Status', accessor: 'status' as const },
      ],
      rows,
      `game-activity-${todayStamp()}`
    );
    toast(`Exported ${rows.length} game bets.`);
  };

  if (!canView) {
    return (
      <div className="bg-white p-8 rounded-lg shadow text-center text-gray-600">
        Restricted page — Admin / Super Admin only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Game Activity</h1>
        <button
          onClick={handleExport}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Export Activity
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard
            label="Total Staked"
            value={formatCurrency(summary.total_staked ?? 0)}
            sublabel={`${summary.total_bets ?? rows.length} bets · ${
              summary.player_count ?? 0
            } players`}
          />
          <SummaryCard
            label="Total Payout"
            value={formatCurrency(summary.total_payout ?? 0)}
            tone="negative"
          />
          <SummaryCard
            label="Gross Gaming Revenue"
            value={formatCurrency(summary.ggr ?? 0)}
            tone={num(summary.ggr) >= 0 ? 'positive' : 'negative'}
            sublabel="Stakes − Payouts"
          />
          <SummaryCard
            label="Wins / Losses"
            value={`${summary.win_count ?? 0} / ${summary.loss_count ?? 0}`}
            sublabel={`${summary.pending_count ?? 0} in play`}
          />
        </div>
      )}

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
      />

      <div className="bg-white rounded-lg shadow">
        {loading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
        ) : (
          <DataTable columns={columns} data={rows} />
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'positive' | 'negative';
}) {
  const cls =
    tone === 'positive'
      ? 'text-green-700'
      : tone === 'negative'
      ? 'text-red-700'
      : 'text-gray-900';
  return (
    <div className="bg-white p-4 rounded-lg shadow-sm">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className={`text-2xl font-semibold ${cls}`}>{value}</p>
      {sublabel && <p className="text-xs text-gray-500 mt-1">{sublabel}</p>}
    </div>
  );
}
