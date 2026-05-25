/**
 * /transactions/branch — Section 5 page.
 *
 * Lists every cash transaction that happened at a physical branch
 * (deposits / withdrawals / ticket sells / payouts handled by cashiers).
 * Same shape as Online Transactions plus Branch and Cashier columns.
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

interface BranchTxRow {
  id: string;
  fullName: string;
  phone: string;
  amount: number;
  fee: number;
  type: string;
  reason: string;
  bank: string;
  status: string;
  branch: string;
  cashier: string;
  date: string;
  reference: string;
  comment: string;
  raw: txApi.TxRowGeneric;
}

const num = (v: string | number | null | undefined): number => toNumber(v);

function mapRow(r: txApi.TxRowGeneric): BranchTxRow {
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    fullName: String(r.user_name ?? r.full_name ?? meta.full_name ?? ''),
    phone: String(r.user_phone ?? r.phone ?? meta.phone ?? ''),
    amount: num(r.amount),
    fee: num(r.fee ?? meta.fee),
    type: String(r.type ?? ''),
    reason: String(r.reason ?? meta.reason ?? ''),
    bank: String(
      r.bank ?? r.provider ?? meta.bank ?? meta.provider ?? 'Cash'
    ),
    status: String(r.status ?? ''),
    branch: String(r.branch_name ?? meta.branch_name ?? ''),
    cashier: String(
      r.cashier_name ?? r.cashier_email ?? meta.cashier_name ?? ''
    ),
    date: r.created_at ? new Date(r.created_at).toLocaleString() : '',
    reference: String(r.reference ?? ''),
    comment: String(r.comment ?? r.notes ?? meta.comment ?? ''),
    raw: r,
  };
}

const TYPE_TO_VALUE: Record<string, txApi.BranchTxQuery['type']> = {
  Deposit: 'deposit',
  Withdrawal: 'withdrawal',
  'Ticket Sell': 'ticket_sell',
  'Ticket Payout': 'ticket_payout',
  'Ticket Cancel': 'ticket_cancel',
  'Jackpot Sell': 'jackpot_sell',
  'Jackpot Payout': 'jackpot_payout',
  Adjustment: 'adjustment',
};

const STATUS_TO_VALUE: Record<string, txApi.BranchTxQuery['status']> = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Completed: 'completed',
  Cancelled: 'cancelled',
  Failed: 'failed',
};

export function BranchTransactions() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  const canView = role === 'admin' || role === 'superadmin';

  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedCashier, setSelectedCashier] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  const [rows, setRows] = useState<BranchTxRow[]>([]);
  const [summary, setSummary] = useState<{
    deposits?: string;
    withdrawals?: string;
    payouts?: string;
    count?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuth || !canView) return;
    let cancelled = false;
    setLoading(true);
    txApi
      .listTransactions('branch', {
        from: toIso(startDate),
        to: toIso(endDate),
        type: TYPE_TO_VALUE[selectedType] ?? undefined,
        status: STATUS_TO_VALUE[selectedStatus] ?? undefined,
        phone: phoneNumber || undefined,
        min_amount: minAmount ? Number(minAmount) : undefined,
        max_amount: maxAmount ? Number(maxAmount) : undefined,
        limit: 500,
        offset: 0,
      })
      .then((res) => {
        if (cancelled) return;
        const all = res.items.map(mapRow);
        const filtered = all.filter((r) => {
          if (selectedBranch && r.branch !== selectedBranch) return false;
          if (selectedCashier && r.cashier !== selectedCashier) return false;
          return true;
        });
        setRows(filtered);
        setSummary(
          (res.summary as {
            deposits?: string;
            withdrawals?: string;
            payouts?: string;
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
    startDate,
    endDate,
    selectedBranch,
    selectedCashier,
    selectedType,
    selectedStatus,
    phoneNumber,
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
      label: 'Branch',
      options: Array.from(new Set(rows.map((r) => r.branch).filter(Boolean))),
      value: selectedBranch,
      onChange: setSelectedBranch,
    },
    {
      label: 'Cashier',
      options: Array.from(new Set(rows.map((r) => r.cashier).filter(Boolean))),
      value: selectedCashier,
      onChange: setSelectedCashier,
    },
    {
      label: 'Type',
      options: Object.keys(TYPE_TO_VALUE),
      value: selectedType,
      onChange: setSelectedType,
    },
    {
      label: 'Status',
      options: Object.keys(STATUS_TO_VALUE),
      value: selectedStatus,
      onChange: setSelectedStatus,
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

  const StatusPill = ({ s }: { s: string }) => {
    const cls =
      s === 'completed' || s === 'approved'
        ? 'bg-green-100 text-green-800'
        : s === 'pending'
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-red-100 text-red-800';
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${cls}`}>
        {s}
      </span>
    );
  };

  const columns = useMemo(
    () => [
      { header: 'Full Name', accessor: 'fullName' as const },
      { header: 'Phone', accessor: 'phone' as const },
      {
        header: 'Amount',
        accessor: 'amount' as const,
        render: (v: number, r: BranchTxRow) =>
          formatCurrency(v, r.raw.currency ?? undefined),
      },
      {
        header: 'Fee',
        accessor: 'fee' as const,
        render: (v: number, r: BranchTxRow) =>
          formatCurrency(v, r.raw.currency ?? undefined),
      },
      {
        header: 'Type',
        accessor: 'type' as const,
        render: (v: string) => (
          <span className="capitalize">{v.replace(/_/g, ' ')}</span>
        ),
      },
      { header: 'Reason', accessor: 'reason' as const },
      { header: 'Bank/Provider', accessor: 'bank' as const },
      {
        header: 'Status',
        accessor: 'status' as const,
        render: (v: string) => <StatusPill s={v} />,
      },
      { header: 'Branch', accessor: 'branch' as const },
      { header: 'Cashier', accessor: 'cashier' as const },
      { header: 'Date', accessor: 'date' as const },
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
        { header: 'Full Name', accessor: 'fullName' as const },
        { header: 'Phone', accessor: 'phone' as const },
        { header: 'Amount', accessor: 'amount' as const },
        { header: 'Fee', accessor: 'fee' as const },
        { header: 'Type', accessor: 'type' as const },
        { header: 'Reason', accessor: 'reason' as const },
        { header: 'Bank/Provider', accessor: 'bank' as const },
        { header: 'Status', accessor: 'status' as const },
        { header: 'Branch', accessor: 'branch' as const },
        { header: 'Cashier', accessor: 'cashier' as const },
        { header: 'Date', accessor: 'date' as const },
        { header: 'Reference', accessor: 'reference' as const },
        { header: 'Comment', accessor: 'comment' as const },
      ],
      rows,
      `branch-transactions-${todayStamp()}`
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
        <h1 className="text-2xl font-semibold text-gray-900">Branch Transactions</h1>
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
            label="Branch Deposits"
            value={formatCurrency(summary.deposits ?? 0)}
            tone="positive"
          />
          <SummaryCard
            label="Branch Withdrawals"
            value={formatCurrency(summary.withdrawals ?? 0)}
            tone="negative"
          />
          <SummaryCard
            label="Ticket / Jackpot Payouts"
            value={formatCurrency(summary.payouts ?? 0)}
          />
          <SummaryCard
            label="Total Rows"
            value={String(summary.count ?? rows.length)}
            sublabel="In current view"
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
