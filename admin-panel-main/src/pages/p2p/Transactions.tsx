import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { Wallet, FileDown } from 'lucide-react';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import {
  listTransactions,
  type UnifiedTransactionRow,
} from '../../lib/api/p2p';

interface TxRow {
  id: string;
  time: string;
  user: string;
  type: string;
  wallet: string;
  amount: string;
  ref: string;
  status: string;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

function toRow(row: UnifiedTransactionRow): TxRow {
  const amt = Number(row.amount);
  const cur = row.currency || 'ETB';
  const amount = Number.isFinite(amt)
    ? `${cur} ${amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : `${cur} ${row.amount}`;
  return {
    id: row.id,
    time: new Date(row.created_at).toLocaleString(),
    user: row.user_phone || row.user_email || row.user_id || '—',
    type: row.kind === 'deposit' ? 'Deposit' : 'Withdrawal',
    wallet: row.agent_name || row.wallet_phone || '—',
    amount,
    ref: row.reference || row.id,
    status: row.status_label,
  };
}

const columns = [
  { header: 'Transaction ID', accessor: 'id' as const },
  { header: 'Time', accessor: 'time' as const },
  { header: 'User', accessor: 'user' as const },
  {
    header: 'Type',
    accessor: 'type' as const,
    render: (value: string) => (
      <span
        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
          value === 'Deposit' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
        }`}
      >
        {value}
      </span>
    ),
  },
  { header: 'Wallet', accessor: 'wallet' as const },
  { header: 'Amount', accessor: 'amount' as const },
  { header: 'Reference', accessor: 'ref' as const },
  {
    header: 'Status',
    accessor: 'status' as const,
    render: (value: string) => (
      <span
        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
          value === 'Success'
            ? 'bg-green-100 text-green-800'
            : value === 'Pending' || value === 'Processing'
              ? 'bg-yellow-100 text-yellow-800'
              : 'bg-red-100 text-red-800'
        }`}
      >
        {value}
      </span>
    ),
  },
];

const tabs = [
  { id: 'all', label: 'All' },
  { id: 'deposit', label: 'Deposits' },
  { id: 'withdrawal', label: 'Withdrawals' },
  { id: 'failed', label: 'Failed' },
];

type Tab = 'all' | 'deposit' | 'withdrawal' | 'failed';

export function P2PTransactions() {
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [endDate, setEndDate] = useState(new Date());
  const [wallet, setWallet] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<UnifiedTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const apiStatus = useMemo(() => {
    switch (status) {
      case 'Success':
        return 'success';
      case 'Pending':
        return 'pending';
      case 'Processing':
        return 'processing';
      case 'Failed':
        return 'failed';
      default:
        return undefined;
    }
  }, [status]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fromIso = (() => {
        const d = new Date(startDate);
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
      })();
      const toIso = (() => {
        const d = new Date(endDate);
        d.setHours(23, 59, 59, 999);
        return d.toISOString();
      })();
      const res = await listTransactions({
        tab: activeTab,
        status: apiStatus,
        from: fromIso,
        to: toIso,
        page: 1,
        limit: 200,
      });
      setRows(res.items ?? []);
    } catch (e) {
      toast(errMsg(e), 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, apiStatus, startDate, endDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const tableRows = useMemo(() => rows.map(toRow), [rows]);

  const walletOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of tableRows) {
      if (r.wallet && r.wallet !== '—') s.add(r.wallet);
    }
    return [...s].sort();
  }, [tableRows]);

  const filters = [
    {
      label: 'Wallet',
      options: walletOptions.length ? walletOptions : ['—'],
      value: wallet,
      onChange: setWallet,
    },
    {
      label: 'Status',
      options: ['Success', 'Pending', 'Processing', 'Failed'],
      value: status,
      onChange: setStatus,
    },
  ];

  const filtered = useMemo(() => {
    if (!wallet) return tableRows;
    return tableRows.filter((r) => r.wallet === wallet);
  }, [tableRows, wallet]);

  const exportColumns = columns.map((c) => ({ header: c.header, accessor: c.accessor }));

  const handleExport = () => {
    if (filtered.length === 0) {
      toast('No transactions to export.', 'error');
      return;
    }
    downloadCsv(exportColumns, filtered, `p2p-transactions-${activeTab}-${todayStamp()}`);
    toast(`Exported ${filtered.length} transactions.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Wallet className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">P2P Transactions</h1>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={loading}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Export
        </button>
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(v) => setActiveTab(v as Tab)}
      />

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
      />

      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading transactions…</div>
        ) : (
          <DataTable columns={columns} data={filtered} />
        )}
      </div>
    </div>
  );
}
