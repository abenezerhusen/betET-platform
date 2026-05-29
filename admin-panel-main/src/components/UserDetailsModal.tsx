import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Wallet,
  Activity,
  Gift,
  Users,
  FileDown,
  History,
  DollarSign,
} from 'lucide-react';
import { TabGroup } from './TabGroup';
import { DataTable } from './DataTable';
import { downloadCsv, todayStamp } from '../lib/csv';
import { toast } from '../lib/toast';
import * as usersApi from '../lib/api/users';
import { ApiError } from '../lib/api/client';

interface UserDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
}

interface RecentBetRow {
  id: string;
  source: string;
  stake: number;
  potential: number;
  actual: number;
  status: string;
  placed_at: string;
}

interface RecentTxRow {
  id: string;
  amount: number;
  status: string;
  reference: string;
  created_at: string;
}

const StatCard = ({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string;
  icon: any;
}) => (
  <div className="bg-white p-4 rounded-lg shadow-sm">
    <div className="flex items-center space-x-3">
      <div className="p-2 bg-blue-50 rounded-lg">
        <Icon className="h-5 w-5 text-blue-600" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-xl font-semibold">{value}</p>
      </div>
    </div>
  </div>
);

const num = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const fmtMoney = (v: number) => `$${v.toFixed(2)}`;
const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString() : '—';

export function UserDetailsModal({ isOpen, onClose, user }: UserDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'bets' | 'deposits' | 'withdrawals'>(
    'profile'
  );
  const [details, setDetails] = useState<usersApi.UserDetailsBundle | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !user?.id) return;
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    usersApi
      .getUserDetails(user.id)
      .then((res) => {
        if (cancelled) return;
        setDetails(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError ? err.message : String((err as Error)?.message ?? err);
        toast(`Failed to load user details: ${msg}`, 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, user?.id]);

  const balances = details?.balances ?? [];
  const aggregates = details?.aggregates;
  const userRow = details?.user;
  const md = (userRow?.metadata ?? {}) as Record<string, unknown>;

  const totalBalance = balances.reduce((s, b) => s + num(b.balance), 0);
  const totalBonus = balances.reduce((s, b) => s + num(b.bonus_balance), 0);

  const recentBets = useMemo<RecentBetRow[]>(
    () =>
      (details?.recent_bets ?? []).map((b) => ({
        id: b.id.slice(0, 8),
        source: b.source,
        stake: num(b.stake),
        potential: num(b.potential_payout),
        actual: num(b.actual_payout),
        status: b.status,
        placed_at: fmtDate(b.placed_at),
      })),
    [details]
  );

  const recentDeposits = useMemo<RecentTxRow[]>(
    () =>
      (details?.recent_deposits ?? []).map((t) => ({
        id: t.id.slice(0, 8),
        amount: num(t.amount),
        status: t.status,
        reference: t.reference ?? '—',
        created_at: fmtDate(t.created_at),
      })),
    [details]
  );

  const recentWithdrawals = useMemo<RecentTxRow[]>(
    () =>
      (details?.recent_withdrawals ?? []).map((t) => ({
        id: t.id.slice(0, 8),
        amount: num(t.amount),
        status: t.status,
        reference: t.reference ?? '—',
        created_at: fmtDate(t.created_at),
      })),
    [details]
  );

  if (!isOpen || !user) return null;

  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'bets', label: `Bets (${recentBets.length})` },
    { id: 'deposits', label: `Deposits (${recentDeposits.length})` },
    { id: 'withdrawals', label: `Withdrawals (${recentWithdrawals.length})` },
  ];

  const betColumns = [
    { header: 'Bet ID', accessor: 'id' as const },
    { header: 'Source', accessor: 'source' as const },
    {
      header: 'Stake',
      accessor: 'stake' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      header: 'Potential Win',
      accessor: 'potential' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      header: 'Actual Payout',
      accessor: 'actual' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      header: 'Status',
      accessor: 'status' as const,
      render: (s: string) => (
        <span
          className={`px-2 py-1 text-xs rounded-full font-medium ${
            s === 'won'
              ? 'bg-green-100 text-green-700'
              : s === 'lost'
              ? 'bg-gray-100 text-gray-700'
              : s === 'pending'
              ? 'bg-yellow-100 text-yellow-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {s}
        </span>
      ),
    },
    { header: 'Placed At', accessor: 'placed_at' as const },
  ];

  const txColumns = [
    { header: 'ID', accessor: 'id' as const },
    {
      header: 'Amount',
      accessor: 'amount' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      header: 'Status',
      accessor: 'status' as const,
      render: (s: string) => (
        <span
          className={`px-2 py-1 text-xs rounded-full font-medium ${
            s === 'completed'
              ? 'bg-green-100 text-green-700'
              : s === 'pending'
              ? 'bg-yellow-100 text-yellow-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {s}
        </span>
      ),
    },
    { header: 'Reference', accessor: 'reference' as const },
    { header: 'Date', accessor: 'created_at' as const },
  ];

  const handleExport = () => {
    if (!details) {
      toast('Details not loaded yet.', 'error');
      return;
    }
    const summary = [
      {
        name:
          (md.full_name as string | undefined) ||
          [(md.first_name as string) || '', (md.last_name as string) || '']
            .filter(Boolean)
            .join(' '),
        member_id: userRow?.id ?? '',
        email: userRow?.email ?? '',
        phone: userRow?.phone ?? '',
        status: userRow?.status ?? '',
        member_type: (md.member_type as string | undefined) ?? 'Regular',
        balance: totalBalance,
        bonus_balance: totalBonus,
        total_deposits: num(aggregates?.total_deposits),
        total_withdrawals: num(aggregates?.total_withdrawals),
        total_bets: num(aggregates?.total_bets),
        total_won: num(aggregates?.total_won),
        bet_count: num(aggregates?.bet_count),
        joined: fmtDate(userRow?.created_at),
        last_login: fmtDate(userRow?.last_login_at),
      },
    ];
    downloadCsv(
      [
        { header: 'Name', accessor: 'name' },
        { header: 'Member ID', accessor: 'member_id' },
        { header: 'Email', accessor: 'email' },
        { header: 'Phone', accessor: 'phone' },
        { header: 'Status', accessor: 'status' },
        { header: 'Member Type', accessor: 'member_type' },
        { header: 'Balance', accessor: 'balance' },
        { header: 'Bonus Balance', accessor: 'bonus_balance' },
        { header: 'Total Deposits', accessor: 'total_deposits' },
        { header: 'Total Withdrawals', accessor: 'total_withdrawals' },
        { header: 'Total Stake', accessor: 'total_bets' },
        { header: 'Total Won', accessor: 'total_won' },
        { header: 'Bet Count', accessor: 'bet_count' },
        { header: 'Joined', accessor: 'joined' },
        { header: 'Last Login', accessor: 'last_login' },
      ],
      summary,
      `user-${userRow?.id?.slice(0, 8) ?? 'details'}-${todayStamp()}`
    );
    toast('User details exported.');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center overflow-y-auto py-10">
      <div className="bg-gray-100 rounded-lg w-[90%] max-w-7xl relative">
        <div className="p-6 space-y-6">
          <div className="flex justify-between items-center sticky top-0 z-50 bg-gray-100 rounded-t-lg">
            <h2 className="text-2xl font-semibold text-gray-900">User Details</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 p-2 hover:bg-gray-200 rounded-full transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {loading && !details ? (
            <div className="bg-white p-10 text-center text-sm text-gray-500 rounded-lg shadow-sm">
              Loading user details…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="Total Balance"
                  value={fmtMoney(totalBalance)}
                  icon={Wallet}
                />
                <StatCard
                  title="Bonus Balance"
                  value={fmtMoney(totalBonus)}
                  icon={Gift}
                />
                <StatCard
                  title="Total Won"
                  value={fmtMoney(num(aggregates?.total_won))}
                  icon={Activity}
                />
                <StatCard
                  title="Bets Placed"
                  value={String(num(aggregates?.bet_count))}
                  icon={History}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard
                  title="Total Deposits"
                  value={fmtMoney(num(aggregates?.total_deposits))}
                  icon={DollarSign}
                />
                <StatCard
                  title="Total Withdrawals"
                  value={fmtMoney(num(aggregates?.total_withdrawals))}
                  icon={DollarSign}
                />
                <StatCard
                  title="Total Staked"
                  value={fmtMoney(num(aggregates?.total_bets))}
                  icon={Users}
                />
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">User Information</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <Info
                    label="Name"
                    value={
                      (md.full_name as string | undefined) ||
                      [(md.first_name as string) || '', (md.last_name as string) || '']
                        .filter(Boolean)
                        .join(' ') ||
                      userRow?.email ||
                      userRow?.phone ||
                      '—'
                    }
                  />
                  <Info label="Member ID" value={userRow?.id?.slice(0, 8) ?? '—'} />
                  <Info label="Email" value={userRow?.email ?? '—'} />
                  <Info label="Phone" value={userRow?.phone ?? '—'} />
                  <Info
                    label="Member Type"
                    value={
                      String(md.member_type ?? 'Regular').charAt(0).toUpperCase() +
                      String(md.member_type ?? 'regular').slice(1).toLowerCase()
                    }
                  />
                  <Info label="Status" value={userRow?.status ?? '—'} />
                  <Info label="Join Date" value={fmtDate(userRow?.created_at)} />
                  <Info label="Last Login" value={fmtDate(userRow?.last_login_at)} />
                  <Info label="KYC" value={userRow?.kyc_status ?? '—'} />
                </div>

                {balances.length > 0 && (
                  <div className="mt-6">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      Wallets by Currency
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {balances.map((b) => (
                        <div key={b.currency} className="bg-gray-50 p-3 rounded">
                          <p className="text-xs text-gray-500">{b.currency}</p>
                          <p className="text-sm font-medium">
                            Balance: {fmtMoney(num(b.balance))}
                          </p>
                          <p className="text-xs text-gray-500">
                            Bonus: {fmtMoney(num(b.bonus_balance))}
                          </p>
                          <p className="text-xs text-gray-500">
                            Locked: {fmtMoney(num(b.locked_balance))}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <TabGroup
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={(id) =>
                      setActiveTab(id as 'profile' | 'bets' | 'deposits' | 'withdrawals')
                    }
                  />
                  <button
                    onClick={handleExport}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <FileDown className="h-4 w-4 mr-2" />
                    Export Profile
                  </button>
                </div>

                <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                  {activeTab === 'profile' && (
                    <div className="p-6 text-sm text-gray-600">
                      Use the tabs above to inspect this user&rsquo;s recent betting,
                      deposit, and withdrawal activity. All numbers reflect the live
                      database; the modal refreshes every time it is reopened.
                    </div>
                  )}
                  {activeTab === 'bets' && (
                    <DataTable columns={betColumns} data={recentBets} />
                  )}
                  {activeTab === 'deposits' && (
                    <DataTable columns={txColumns} data={recentDeposits} />
                  )}
                  {activeTab === 'withdrawals' && (
                    <DataTable columns={txColumns} data={recentWithdrawals} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="font-medium break-all">{value}</p>
    </div>
  );
}
