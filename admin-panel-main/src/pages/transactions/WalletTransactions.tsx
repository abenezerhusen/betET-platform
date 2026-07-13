/**
 * /transactions/wallet — Section 5 page.
 *
 * Internal wallet movements: bonus credits, admin adjustments, referral
 * payments, wallet transfers and rollbacks. Powered by `GET /api/admin/
 * transactions?type=wallet`.
 *
 * The spec calls these "internal wallet movements"; the page therefore
 * shows a single row per ledger entry with direction (Credit / Debit),
 * reason and counterparty information when applicable.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { FileDown } from 'lucide-react';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import * as txApi from '../../lib/api/transactions';
import { useAuthStore } from '../../store/auth';
import { formatCurrency, toIso, toNumber } from '../../lib/format';

interface WalletTxRow {
  id: string;
  user: string;
  phone: string;
  type: string;
  reason: string;
  direction: string;
  amount: number;
  beforeBalance: number;
  afterBalance: number;
  status: string;
  date: string;
  reference: string;
  counterparty: string;
  comment: string;
  raw: txApi.TxRowGeneric;
}

const num = (v: string | number | null | undefined): number => toNumber(v);

function mapRow(r: txApi.TxRowGeneric): WalletTxRow {
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  const direction =
    (r.direction as string | null) ??
    (num(r.amount) >= 0 ? 'Credit' : 'Debit');
  return {
    id: r.id,
    user: String(r.user_name ?? r.user_email ?? r.user_phone ?? ''),
    phone: String(r.user_phone ?? meta.phone ?? ''),
    type: String(r.type ?? ''),
    reason: String(r.reason ?? meta.reason ?? ''),
    direction,
    amount: Math.abs(num(r.abs_amount ?? r.amount)),
    beforeBalance: num(r.before_balance),
    afterBalance: num(r.after_balance),
    status: String(r.status ?? ''),
    date: r.created_at ? new Date(r.created_at).toLocaleString() : '',
    reference: String(r.reference ?? ''),
    counterparty: String(
      r.counterparty_name ??
        r.counterparty_phone ??
        meta.counterparty_phone ??
        meta.counterparty_name ??
        ''
    ),
    comment: String(r.comment ?? meta.comment ?? ''),
    raw: r,
  };
}

const REASON_FILTER_OPTIONS = [
  'Bonus Credit',
  'Bonus Conversion',
  'Admin Adjustment',
  'Commission',
  'Wallet Transfer',
  'Bet Refund',
  'Rollback',
  'Game Bet',
  'Game Win',
];

const REASON_TO_VALUE: Record<string, string> = {
  'Bonus Credit': 'bonus_credit',
  'Bonus Conversion': 'bonus_debit',
  'Admin Adjustment': 'adjustment',
  Commission: 'commission',
  'Wallet Transfer': 'transfer_in',
  'Bet Refund': 'bet_refund',
  Rollback: 'rollback',
  'Game Bet': 'bet_stake',
  'Game Win': 'bet_win',
};

export function WalletTransactions() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  const canView = role === 'admin' || role === 'superadmin';

  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedReason, setSelectedReason] = useState('');
  const [direction, setDirection] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  const [rows, setRows] = useState<WalletTxRow[]>([]);
  const [summary, setSummary] = useState<{
    credits?: string;
    debits?: string;
    bonus_total?: string;
    adjustment_total?: string;
    count?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // Normalise to whole-day boundaries so the selected end-day is inclusive
  // (the date picker returns clicked days at midnight, which would otherwise
  // drop the entire end-day and return an empty list).
  const { fromParam, toParam } = useMemo(() => {
    const s = new Date(startDate);
    s.setHours(0, 0, 0, 0);
    const e = new Date(endDate);
    e.setHours(23, 59, 59, 999);
    return { fromParam: toIso(s), toParam: toIso(e) };
  }, [startDate, endDate]);

  useEffect(() => {
    if (!isAuth || !canView) return;
    let cancelled = false;
    setLoading(true);
    txApi
      .listTransactions('wallet', {
        from: fromParam,
        to: toParam,
        phone: phoneNumber || undefined,
        reason: REASON_TO_VALUE[selectedReason] ?? undefined,
        direction:
          direction === 'Credit'
            ? 'credit'
            : direction === 'Debit'
            ? 'debit'
            : undefined,
        min_amount: minAmount ? Number(minAmount) : undefined,
        max_amount: maxAmount ? Number(maxAmount) : undefined,
        limit: 500,
        offset: 0,
      })
      .then((res) => {
        if (cancelled) return;
        setRows(res.items.map(mapRow));
        setSummary(
          (res.summary as {
            credits?: string;
            debits?: string;
            bonus_total?: string;
            adjustment_total?: string;
            count?: string;
          } | null) ?? null
        );
      })
      .catch((err: Error) =>
        toast(`Failed to load transactions: ${err.message}`, 'error')
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
    fromParam,
    toParam,
    phoneNumber,
    selectedReason,
    direction,
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
      label: 'Reason',
      options: REASON_FILTER_OPTIONS,
      value: selectedReason,
      onChange: setSelectedReason,
    },
    {
      label: 'Direction',
      options: ['Credit', 'Debit'],
      value: direction,
      onChange: setDirection,
    },
    {
      label: 'Min Amount',
      options: [] as string[],
      value: minAmount,
      onChange: setMinAmount,
      type: 'number' as const,
    },
    {
      label: 'Max Amount',
      options: [] as string[],
      value: maxAmount,
      onChange: setMaxAmount,
      type: 'number' as const,
    },
  ];

  const DirectionPill = ({ d }: { d: string }) => {
    const cls =
      d === 'Credit'
        ? 'bg-green-100 text-green-800'
        : 'bg-red-100 text-red-800';
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>
        {d}
      </span>
    );
  };

  const columns = useMemo(
    () => [
      { header: 'Date', accessor: 'date' as const },
      { header: 'User', accessor: 'user' as const },
      { header: 'Phone', accessor: 'phone' as const },
      {
        header: 'Direction',
        accessor: 'direction' as const,
        render: (v: string) => <DirectionPill d={v} />,
      },
      {
        header: 'Type',
        accessor: 'type' as const,
        render: (v: string) => (
          <span className="capitalize">{v.replace(/_/g, ' ')}</span>
        ),
      },
      { header: 'Reason', accessor: 'reason' as const },
      {
        header: 'Amount',
        accessor: 'amount' as const,
        render: (v: number, r: WalletTxRow) =>
          formatCurrency(v, r.raw.currency ?? undefined),
      },
      {
        header: 'Before',
        accessor: 'beforeBalance' as const,
        render: (v: number, r: WalletTxRow) =>
          formatCurrency(v, r.raw.currency ?? undefined),
      },
      {
        header: 'After',
        accessor: 'afterBalance' as const,
        render: (v: number, r: WalletTxRow) =>
          formatCurrency(v, r.raw.currency ?? undefined),
      },
      { header: 'Counterparty', accessor: 'counterparty' as const },
      { header: 'Status', accessor: 'status' as const },
      { header: 'Reference', accessor: 'reference' as const },
      { header: 'Comment', accessor: 'comment' as const },
    ],
    []
  );

  const handleExport = () => {
    if (rows.length === 0) {
      toast('No transactions to export.', 'error');
      return;
    }
    downloadCsv(
      [
        { header: 'Date', accessor: 'date' as const },
        { header: 'User', accessor: 'user' as const },
        { header: 'Phone', accessor: 'phone' as const },
        { header: 'Direction', accessor: 'direction' as const },
        { header: 'Type', accessor: 'type' as const },
        { header: 'Reason', accessor: 'reason' as const },
        { header: 'Amount', accessor: 'amount' as const },
        { header: 'Before Balance', accessor: 'beforeBalance' as const },
        { header: 'After Balance', accessor: 'afterBalance' as const },
        { header: 'Counterparty', accessor: 'counterparty' as const },
        { header: 'Status', accessor: 'status' as const },
        { header: 'Reference', accessor: 'reference' as const },
        { header: 'Comment', accessor: 'comment' as const },
      ],
      rows,
      `wallet-transactions-${todayStamp()}`
    );
    toast(`Exported ${rows.length} transactions.`);
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
        <h1 className="text-2xl font-semibold text-gray-900">Wallet Transactions</h1>
        <button
          onClick={handleExport}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Export Transactions
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard
            label="Total Credits"
            value={formatCurrency(summary.credits ?? 0)}
            tone="positive"
          />
          <SummaryCard
            label="Total Debits"
            value={formatCurrency(summary.debits ?? 0)}
            tone="negative"
          />
          <SummaryCard
            label="Net Bonus Movements"
            value={formatCurrency(summary.bonus_total ?? 0)}
          />
          <SummaryCard
            label="Admin Adjustments"
            value={formatCurrency(summary.adjustment_total ?? 0)}
            sublabel={`${summary.count ?? rows.length} rows`}
          />
        </div>
      )}

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
        onClear={() => {
          setPhoneNumber('');
          setSelectedReason('');
          setDirection('');
          setMinAmount('');
          setMaxAmount('');
          setStartDate(() => {
            const d = new Date();
            d.setDate(d.getDate() - 30);
            return d;
          });
          setEndDate(new Date());
        }}
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
