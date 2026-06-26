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
  Ban,
} from 'lucide-react';
import { TabGroup } from './TabGroup';
import { DataTable } from './DataTable';
import { downloadCsv, todayStamp } from '../lib/csv';
import { toast } from '../lib/toast';
import * as usersApi from '../lib/api/users';
import * as promotionsApi from '../lib/api/promotions';
import { ApiError } from '../lib/api/client';

interface UserDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
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

const fmtMoney = (v: number) => `${v.toFixed(2)} ETB`;
const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString() : '—';

const StatusPill = ({ s }: { s: string }) => (
  <span
    className={`px-2 py-1 text-xs rounded-full font-medium ${
      s === 'won' || s === 'completed'
        ? 'bg-green-100 text-green-700'
        : s === 'lost' || s === 'cancelled'
          ? 'bg-gray-100 text-gray-700'
          : s === 'pending'
            ? 'bg-yellow-100 text-yellow-700'
            : 'bg-red-100 text-red-700'
    }`}
  >
    {s}
  </span>
);

type TabId =
  | 'transactions'
  | 'deposits'
  | 'wins'
  | 'bonus'
  | 'referrals'
  | 'tickets'
  | 'branch';

interface TxRow {
  id: string;
  date: string;
  type: string;
  amount: number;
  direction: 'in' | 'out';
  status: string;
  description: string;
}

export function UserDetailsModal({ isOpen, onClose, user }: UserDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('transactions');
  const [details, setDetails] = useState<usersApi.UserDetailsBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [referralRows, setReferralRows] = useState<promotionsApi.AdminReferralRow[]>([]);

  // ── All-transactions state (for Transactions tab) ────────────────────────
  const [allTxRows, setAllTxRows] = useState<TxRow[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !user?.id) return;
    let cancelled = false;
    setLoading(true);
    setDetails(null);
    setActiveTab('transactions');
    setReferralRows([]);
    setAllTxRows([]);

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

    // Load referrals in parallel
    promotionsApi
      .getUserReferrals(user.id)
      .then((res) => {
        if (!cancelled) setReferralRows(res.data ?? []);
      })
      .catch(() => { /* non-critical */ });

    return () => { cancelled = true; };
  }, [isOpen, user?.id]);

  // ── Load all transactions for the Transactions tab ───────────────────────
  useEffect(() => {
    if (!isOpen || !user?.id) return;
    let cancelled = false;
    setTxLoading(true);

    usersApi
      .userActivity(user.id, { type: 'transactions', limit: 200, page: 1 })
      .then((res) => {
        if (cancelled) return;
        const OUT_TYPES = new Set([
          'withdrawal', 'debit', 'bet_placement', 'cashout_debit',
          'bonus_debit', 'p2p_send', 'adjustment_debit',
        ]);
        setAllTxRows(
          res.items.map((t) => {
            const det = (t.details ?? {}) as Record<string, unknown>;
            const meta = (det.metadata ?? {}) as Record<string, unknown>;
            const txType = String(det.tx_type ?? t.type ?? '');
            const isOut = OUT_TYPES.has(txType) || Number(t.amount) < 0;
            const description =
              (meta.reason as string | undefined) ??
              (meta.note as string | undefined) ??
              (det.reference as string | undefined) ??
              txType;
            return {
              id: t.id.slice(0, 10),
              date: fmtDate(t.created_at),
              type: txType || t.type,
              amount: Math.abs(Number(t.amount)),
              direction: isOut ? 'out' : 'in',
              status: t.status,
              description,
            };
          })
        );
      })
      .catch(() => { /* non-critical */ })
      .finally(() => { if (!cancelled) setTxLoading(false); });

    return () => { cancelled = true; };
  }, [isOpen, user?.id]);

  const balances = details?.balances ?? [];
  const aggregates = details?.aggregates;
  const userRow = details?.user;
  const md = (userRow?.metadata ?? {}) as Record<string, unknown>;

  const totalBalance = balances.reduce((s, b) => s + num(b.balance), 0);
  const totalWithdrawable = balances.reduce((s, b) => s + num(b.withdrawable_balance), 0);
  const totalPayable = balances.reduce((s, b) => s + num(b.payable_balance), 0);
  const totalBonus = balances.reduce((s, b) => s + num(b.bonus_balance), 0);

  // ---- Wins / Losses (sportsbook + casino bets) --------------------------
  const winsRows = useMemo(
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

  // ---- Sports Bets (sportsbook tickets only) ----------------------------
  const ticketRows = useMemo(
    () =>
      (details?.recent_bets ?? [])
        .filter((b) => b.source === 'sportsbook')
        .map((b) => ({
          couponCode: b.coupon_code || b.id.slice(0, 12).toUpperCase(),
          selections: b.legs_count ?? '—',
          stake: fmtMoney(num(b.stake)),
          possibleWin: fmtMoney(num(b.potential_payout)),
          paidOut: fmtMoney(num(b.actual_payout)),
          paidStatus: b.status,
          createdDate: fmtDate(b.placed_at),
        })),
    [details]
  );

  const txTypeLabel = (type: string, meta: Record<string, unknown>) => {
    if (type === 'adjustment') {
      const action = meta?.['admin_action'];
      return action === 'credit' ? 'Admin Deposit' : action === 'debit' ? 'Admin Withdrawal' : 'Adjustment';
    }
    const map: Record<string, string> = {
      deposit: 'Online Deposit', telebirr_deposit: 'Telebirr', p2p_deposit: 'P2P',
      manual_deposit: 'Manual Deposit', withdrawal: 'Withdrawal', manual_withdrawal: 'Manual Withdrawal',
    };
    return map[type] ?? type;
  };

  // ---- Deposits / Withdrawals (dedicated tab) ---------------------------
  const depositRows = useMemo(
    () =>
      (details?.recent_deposits ?? []).map((t) => ({
        id: t.id.slice(0, 8),
        type: txTypeLabel(t.type, t.metadata),
        amount: num(t.amount),
        status: t.status,
        reference: t.reference ?? (t.metadata?.['reason'] as string | undefined) ?? '—',
        created_at: fmtDate(t.created_at),
      })),
    [details]
  );

  const withdrawalRows = useMemo(
    () =>
      (details?.recent_withdrawals ?? []).map((t) => ({
        id: t.id.slice(0, 8),
        type: txTypeLabel(t.type, t.metadata),
        amount: num(t.amount),
        status: t.status,
        reference: t.reference ?? (t.metadata?.['reason'] as string | undefined) ?? '—',
        created_at: fmtDate(t.created_at),
      })),
    [details]
  );

  if (!isOpen || !user) return null;

  const tabs = [
    { id: 'transactions', label: 'Transactions' },
    { id: 'deposits', label: 'Deposits/Withdrawals' },
    { id: 'wins', label: 'Wins/Losses' },
    { id: 'bonus', label: 'Bonus History' },
    { id: 'referrals', label: 'Referrals' },
    { id: 'tickets', label: 'Sports Bets' },
    { id: 'branch', label: 'Branch Transactions' },
  ];

  const txColumns = [
    { header: 'ID', accessor: 'id' as const },
    { header: 'Type', accessor: 'type' as const },
    {
      header: 'Amount',
      accessor: 'amount' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      header: 'Status',
      accessor: 'status' as const,
      render: (s: string) => <StatusPill s={s} />,
    },
    { header: 'Reference / Reason', accessor: 'reference' as const },
    { header: 'Date', accessor: 'created_at' as const },
  ];

  const winsColumns = [
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
      render: (s: string) => <StatusPill s={s} />,
    },
    { header: 'Placed At', accessor: 'placed_at' as const },
  ];

  const bonusColumns = [
    { header: 'Date', accessor: 'date' as const },
    { header: 'Amount', accessor: 'amount' as const },
    { header: 'Type', accessor: 'type' as const },
    { header: 'Description', accessor: 'description' as const },
  ];

  const referralColumns = [
    { header: 'Referred User', accessor: 'name' as const },
    { header: 'Phone', accessor: 'phone' as const },
    { header: 'Joined Date', accessor: 'joinedDate' as const },
    { header: 'Bonus Earned', accessor: 'bonusEarned' as const },
    { header: 'Status', accessor: 'bonusStatus' as const },
  ];

  const ticketColumns = [
    { header: 'Coupon Code', accessor: 'couponCode' as const },
    { header: 'Selections', accessor: 'selections' as const },
    { header: 'Stake', accessor: 'stake' as const },
    { header: 'Possible Win', accessor: 'possibleWin' as const },
    { header: 'Paid Out', accessor: 'paidOut' as const },
    {
      header: 'Status',
      accessor: 'paidStatus' as const,
      render: (s: string) => <StatusPill s={s} />,
    },
    { header: 'Placed At', accessor: 'createdDate' as const },
  ];

  const branchColumns = [
    { header: 'Branch', accessor: 'branchName' as const },
    { header: 'Cashier', accessor: 'salesPerson' as const },
    { header: 'Date', accessor: 'date' as const },
    { header: 'Amount', accessor: 'amount' as const },
    { header: 'Reference', accessor: 'phoneNumber' as const },
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-100 rounded-lg w-full max-w-7xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Fixed header */}
        <div className="flex justify-between items-center px-6 py-4 bg-gray-100 border-b border-gray-200 shrink-0">
          <h2 className="text-2xl font-semibold text-gray-900">User Details</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-2 hover:bg-gray-200 rounded-full transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {loading && !details ? (
            <div className="bg-white p-10 text-center text-sm text-gray-500 rounded-lg shadow-sm">
              Loading user details…
            </div>
          ) : (
            <>
              {/* Summary stat cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title="Deductable Balance" value={fmtMoney(totalBalance)} icon={Wallet} />
                <StatCard title="Withdrawable Balance" value={fmtMoney(totalWithdrawable)} icon={DollarSign} />
                <StatCard title="Payable Balance" value={fmtMoney(totalPayable)} icon={History} />
                <StatCard title="Bonus Balance" value={fmtMoney(totalBonus)} icon={Gift} />
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

              {/* User profile info */}
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
                          <p className="text-xs text-gray-500 font-medium uppercase">{b.currency}</p>
                          <p className="text-sm font-medium text-blue-700 mt-1">
                            Deductable: {fmtMoney(num(b.balance))}
                          </p>
                          <p className="text-xs text-emerald-700">
                            Withdrawable: {fmtMoney(num(b.withdrawable_balance))}
                          </p>
                          <p className="text-xs text-amber-700">
                            Payable: {fmtMoney(num(b.payable_balance))}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            Bonus: {fmtMoney(num(b.bonus_balance))} &nbsp;|&nbsp; Locked: {fmtMoney(num(b.locked_balance))}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                  <div className="overflow-x-auto">
                    <TabGroup
                      tabs={tabs}
                      activeTab={activeTab}
                      onTabChange={(id) => setActiveTab(id as TabId)}
                    />
                  </div>
                  <button
                    onClick={handleExport}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 shrink-0"
                  >
                    <FileDown className="h-4 w-4 mr-2" />
                    Export Data
                  </button>
                </div>

                <div className="bg-white rounded-lg shadow-sm overflow-hidden">

                  {/* ── TRANSACTIONS TAB — all wallet movements ────────────── */}
                  {activeTab === 'transactions' && (
                    <div>
                      {txLoading ? (
                        <p className="p-6 text-center text-sm text-gray-400">Loading transactions…</p>
                      ) : allTxRows.length === 0 ? (
                        <p className="p-6 text-center text-sm text-gray-400">No transactions found.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                {['Date', 'Type', 'Amount', 'Description', 'Status'].map((h) => (
                                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {allTxRows.map((tx) => (
                                <tr key={tx.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">{tx.date}</td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">
                                      {tx.type}
                                    </span>
                                  </td>
                                  <td className={`px-4 py-3 whitespace-nowrap font-semibold ${tx.direction === 'in' ? 'text-green-600' : 'text-red-500'}`}>
                                    {tx.direction === 'in' ? '+' : '-'}{tx.amount.toFixed(2)} ETB
                                  </td>
                                  <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate text-xs">{tx.description}</td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <StatusPill s={tx.status} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── DEPOSITS / WITHDRAWALS TAB ────────────────────────── */}
                  {activeTab === 'deposits' && (
                    <div className="p-6 space-y-6">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                          Deposits ({depositRows.length})
                        </h3>
                        {depositRows.length === 0 ? (
                          <p className="text-sm text-gray-400 py-4 text-center">No deposits found.</p>
                        ) : (
                          <DataTable columns={txColumns} data={depositRows} />
                        )}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                          Withdrawals ({withdrawalRows.length})
                        </h3>
                        {withdrawalRows.length === 0 ? (
                          <p className="text-sm text-gray-400 py-4 text-center">No withdrawals found.</p>
                        ) : (
                          <DataTable columns={txColumns} data={withdrawalRows} />
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── WINS / LOSSES TAB ─────────────────────────────────── */}
                  {activeTab === 'wins' && (
                    winsRows.length === 0 ? (
                      <p className="p-6 text-center text-sm text-gray-400">No bets found for this user.</p>
                    ) : (
                      <DataTable columns={winsColumns} data={winsRows} />
                    )
                  )}

                  {/* ── BONUS HISTORY TAB ─────────────────────────────────── */}
                  {activeTab === 'bonus' && (
                    <div className="p-6 space-y-4">
                      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 flex items-center gap-3">
                        <Gift className="h-5 w-5 text-blue-400 flex-shrink-0" />
                        <div className="text-sm text-blue-700">
                          Current bonus balance:{' '}
                          <span className="font-semibold">{fmtMoney(totalBonus)}</span>
                        </div>
                      </div>
                      {(details?.bonus_history ?? []).length === 0 ? (
                        <p className="text-sm text-gray-400 py-4 text-center">No bonus history found.</p>
                      ) : (
                        <DataTable
                          columns={bonusColumns}
                          data={(details?.bonus_history ?? []).map((b) => ({
                            date: fmtDate(b.awarded_at),
                            amount: fmtMoney(num(b.amount)),
                            type: b.type,
                            description: b.description,
                          }))}
                        />
                      )}
                    </div>
                  )}

                  {/* ── REFERRALS TAB ─────────────────────────────────────── */}
                  {activeTab === 'referrals' && (
                    <div className="p-6 space-y-4">
                      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 flex items-start gap-3">
                        <Users className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-blue-700">
                          <p className="font-semibold text-blue-800 mb-1">Referral Summary</p>
                          <p>Total Referrals: <strong>{referralRows.length}</strong></p>
                          <p>
                            Rewarded: <strong>{referralRows.filter(r => r.bonus_status === 'paid' || r.bonus_status === 'rewarded').length}</strong>
                            &nbsp;|&nbsp;
                            Pending: <strong>{referralRows.filter(r => r.bonus_status !== 'paid' && r.bonus_status !== 'rewarded').length}</strong>
                          </p>
                        </div>
                      </div>
                      {referralRows.length === 0 ? (
                        <p className="text-sm text-gray-400 py-4 text-center">No referrals found for this user.</p>
                      ) : (
                        <DataTable
                          columns={referralColumns}
                          data={referralRows.map(r => ({
                            name: r.referred_user ?? '—',
                            phone: r.referred_phone ?? '—',
                            joinedDate: r.date_joined ? new Date(r.date_joined).toLocaleDateString() : '—',
                            bonusEarned: `${Number(r.reward ?? 0).toFixed(2)} ETB`,
                            bonusStatus: r.bonus_status ?? 'pending',
                          }))}
                        />
                      )}
                    </div>
                  )}

                  {/* ── SPORTS BETS TAB ───────────────────────────────────── */}
                  {activeTab === 'tickets' && (
                    ticketRows.length === 0 ? (
                      <p className="p-6 text-center text-sm text-gray-400">No sports bets found for this user.</p>
                    ) : (
                      <DataTable columns={ticketColumns} data={ticketRows} />
                    )
                  )}

                  {/* ── BRANCH TRANSACTIONS TAB ───────────────────────────── */}
                  {activeTab === 'branch' && (
                    <div className="p-6 space-y-4">
                      {(details?.branch_transactions ?? []).length === 0 ? (
                        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 flex items-center gap-3">
                          <Ban className="h-5 w-5 text-amber-400 flex-shrink-0" />
                          <div className="text-sm text-amber-700">
                            No branch (cashier) transactions found for this user.
                          </div>
                        </div>
                      ) : (
                        <DataTable
                          columns={branchColumns}
                          data={(details?.branch_transactions ?? []).map((t) => ({
                            branchName: t.branch_id ? t.branch_id.slice(0, 8) : '—',
                            salesPerson: t.cashier_name ?? '—',
                            date: fmtDate(t.created_at),
                            amount: fmtMoney(num(t.amount)),
                            phoneNumber: t.reference ?? t.notes ?? '—',
                          }))}
                        />
                      )}
                    </div>
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
