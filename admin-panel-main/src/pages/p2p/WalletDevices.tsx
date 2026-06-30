import React, { useCallback, useEffect, useState } from 'react';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import {
  addSubAccount as apiAddSubAccount,
  confirmSwap as apiConfirmSwap,
  failSwap as apiFailSwap,
  getWalletDevice,
  listCommissions,
  listWalletDevices,
  registerWalletDevice as apiRegisterWalletDevice,
  removeSubAccount as apiRemoveLinkedAccount,
  toggleSubAccount as apiToggleLinkedAccount,
  topUpWalletDevice,
  updateWalletDevice,
  updateWalletUssdPin,
  withdrawalSwap as apiWithdrawalSwap,
  type WalletAgentRow,
} from '../../lib/api/p2p';
import {
  Smartphone,
  Wifi,
  WifiOff,
  Edit2,
  FileText,
  Lock,
  X,
  Key,
  Copy,
  Check,
  Plus,
  ArrowLeftRight,
  Wallet,
  AlertTriangle,
  PlusCircle,
  History,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowUpCircle,
  Zap,
  Phone,
  Trash2,
  UserPlus,
} from 'lucide-react';

type SwapSource = 'Manual' | 'Withdrawal';

interface SwapEntry {
  id: string;
  date: string; // ISO yyyy-mm-dd
  time: string; // HH:mm
  amount: number;
  status: 'Added' | 'Pending' | 'Failed';
  source: SwapSource;
  operator: string;
  note?: string;
  refUser?: string; // user whose withdrawal triggered the auto-swap
}

interface SubAccount {
  id: string;
  phone: string;
  label?: string;
  enabled: boolean;
  addedAt: string; // ISO yyyy-mm-dd
}

interface Device {
  id: string;
  name: string;
  phone: string;
  status: 'Online' | 'Offline';
  balance: string;
  preDeposit: number;
  availableCapacity: number;
  dailyLimit: string;
  usedToday: string;
  lastSeen: string;
  enabled: boolean;
  token: string;
  commissionRate: number;
  swaps: SwapEntry[];
  /**
   * Additional phone numbers / accounts linked to the SAME wallet device.
   * Lets agents expand transaction capacity & daily commission without
   * registering a brand new wallet. Purely additive — primary phone untouched.
   */
  subAccounts: SubAccount[];
}

const today = new Date().toISOString().slice(0, 10);

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

const calcTotalCapacity = (preDeposit: number, commissionRate: number) =>
  Math.round(preDeposit * (1 + commissionRate / 100));

const formatETB = (n: number) => `ETB ${n.toLocaleString()}`;

const todaysSwapTotals = (swaps: SwapEntry[]) => {
  const t = swaps.filter((s) => s.date === today);
  const added = t.filter((s) => s.status === 'Added');
  return {
    added: added.reduce((a, b) => a + b.amount, 0),
    addedManual: added.filter((s) => s.source === 'Manual').reduce((a, b) => a + b.amount, 0),
    addedWithdrawal: added.filter((s) => s.source === 'Withdrawal').reduce((a, b) => a + b.amount, 0),
    withdrawalCount: added.filter((s) => s.source === 'Withdrawal').length,
    pending: t.filter((s) => s.status === 'Pending').reduce((a, b) => a + b.amount, 0),
    failed: t.filter((s) => s.status === 'Failed').reduce((a, b) => a + b.amount, 0),
    count: t.length,
  };
};

function agentToDevice(agent: WalletAgentRow, depositPct: number): Device {
  const bal = parseFloat(String(agent.balance ?? '0')) || 0;
  // Pre-deposit (agent float/collateral) is the net sum of confirmed swaps,
  // surfaced by the wallets list. Top-ups are booked as swaps, so this — not
  // `balance` — is what reflects them. Fall back to balance for older payloads.
  const preDeposit = Math.round(
    parseFloat(String(agent.pre_deposit ?? agent.balance ?? '0')) || 0
  );
  const online = agent.status === 'online' || agent.status === 'active';
  const pct = Number.isFinite(depositPct) ? depositPct : 2.5;
  const totalCap = calcTotalCapacity(preDeposit, pct);
  return {
    id: agent.id,
    name: agent.agent_name || agent.device_name || agent.device_id || agent.id.slice(0, 8),
    phone: agent.telebirr_number || '—',
    status: online ? 'Online' : 'Offline',
    balance: formatETB(bal),
    preDeposit,
    availableCapacity: totalCap,
    dailyLimit: '—',
    usedToday: '—',
    lastSeen: agent.last_seen_at ? new Date(agent.last_seen_at).toLocaleString() : 'Never',
    enabled: agent.status !== 'suspended',
    token: agent.device_id,
    commissionRate: pct,
    swaps: [],
    subAccounts: [],
  };
}

function mapSubAccountRows(rows: Array<Record<string, unknown>>): SubAccount[] {
  return rows.map((r) => ({
    id: String(r.id),
    phone: String(r.phone ?? ''),
    label: r.label != null ? String(r.label) : undefined,
    enabled: Boolean(r.enabled),
    addedAt: r.created_at ? String(r.created_at).slice(0, 10) : today,
  }));
}

export function WalletDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [pinDevice, setPinDevice] = useState<Device | null>(null);
  const [pinCurrent, setPinCurrent] = useState('');
  const [pinNew, setPinNew] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const emptyRegister = {
    name: '',
    phone: '',
    preDeposit: '',
    commissionRate: '2.5',
    dailyLimit: '100000',
    pin: '',
  };
  const [registerForm, setRegisterForm] = useState(emptyRegister);

  const refreshDevices = useCallback(async () => {
    setListLoading(true);
    try {
      const pctMap: Record<string, number> = {};
      try {
        const c = await listCommissions();
        const ws = (c.wallets as Array<{ agent_id: string; deposit_pct: string }>) ?? [];
        for (const w of ws) {
          const p = parseFloat(w.deposit_pct);
          if (Number.isFinite(p)) pctMap[w.agent_id] = p;
        }
      } catch {
        /* ignore optional commissions snapshot */
      }
      const res = await listWalletDevices({ limit: 200, page: 1 });
      setDevices((res.items ?? []).map((a) => agentToDevice(a, pctMap[a.id] ?? 2.5)));
    } catch (e) {
      toast(errMsg(e), 'error');
      setDevices([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const handleRegister = async () => {
    const preDepositNum = parseFloat(registerForm.preDeposit) || 0;
    const commission = parseFloat(registerForm.commissionRate) || 2.5;
    const dailyLimit = parseFloat(registerForm.dailyLimit) || 100000;
    if (!registerForm.name.trim() || !registerForm.phone.trim() || preDepositNum <= 0) return;
    try {
      await apiRegisterWalletDevice({
        name: registerForm.name.trim(),
        telebirr_number: registerForm.phone.trim(),
        pre_deposit: preDepositNum,
        commission_rate: commission,
        daily_limit: dailyLimit,
        ussd_pin: registerForm.pin.trim() || undefined,
      });
      toast('Wallet registered.');
      setRegisterForm(emptyRegister);
      setShowRegister(false);
      await refreshDevices();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const toggleDevice = async (id: string) => {
    const d = devices.find((x) => x.id === id);
    if (!d) return;
    try {
      await updateWalletDevice(id, { enabled: !d.enabled });
      toast(!d.enabled ? 'Wallet enabled.' : 'Wallet disabled.');
      await refreshDevices();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  // Top Up Pre-Deposit (used when an agent's pre-deposit is exhausted)
  const [topUpDevice, setTopUpDevice] = useState<Device | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpReauto, setTopUpReauto] = useState(true);
  const [topUpAutoConfirm, setTopUpAutoConfirm] = useState(true);

  // Swap History viewer
  const [swapHistoryFor, setSwapHistoryFor] = useState<Device | null>(null);

  // Withdrawal Auto-Swap (withdrawals automatically restore available capacity)
  const [autoWithdrawalSwap, setAutoWithdrawalSwap] = useState(true);
  const [withdrawalSwapFor, setWithdrawalSwapFor] = useState<Device | null>(null);
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalUser, setWithdrawalUser] = useState('');

  const recordWithdrawalAutoSwap = async () => {
    const amount = parseFloat(withdrawalAmount);
    if (!withdrawalSwapFor || !amount || amount <= 0) return;
    const uid = withdrawalUser.trim();
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    try {
      await apiWithdrawalSwap(withdrawalSwapFor.id, {
        amount,
        ref_user_id: uuidRe.test(uid) ? uid : undefined,
        note: autoWithdrawalSwap ? 'Withdrawal swap (admin UI)' : 'Withdrawal swap recorded',
      });
      toast('Withdrawal swap queued.');
      setWithdrawalSwapFor(null);
      setWithdrawalAmount('');
      setWithdrawalUser('');
      await refreshDevices();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (!topUpDevice || !amount || amount <= 0) return;
    try {
      await topUpWalletDevice(topUpDevice.id, {
        amount,
        note: topUpAutoConfirm ? 'Admin top-up (auto-confirmed)' : 'Admin top-up (pending)',
        re_enable_wallet: topUpReauto,
      });
      toast('Top-up submitted.');
      setTopUpDevice(null);
      setTopUpAmount('');
      await refreshDevices();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const confirmPendingSwap = async (
    deviceId: string,
    swapId: string,
    newStatus: 'Added' | 'Failed'
  ) => {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRe.test(swapId)) {
      try {
        if (newStatus === 'Added') await apiConfirmSwap(swapId);
        else await apiFailSwap(swapId, { reason: 'Marked failed by operator' });
        toast(newStatus === 'Added' ? 'Swap confirmed.' : 'Swap marked failed.');
        await refreshDevices();
      } catch (e) {
        toast(errMsg(e), 'error');
      }
      return;
    }
    setDevices((prev) =>
      prev.map((d) => {
        if (d.id !== deviceId) return d;
        const target = d.swaps.find((s) => s.id === swapId);
        if (!target || target.status !== 'Pending') {
          return {
            ...d,
            swaps: d.swaps.map((s) => (s.id === swapId ? { ...s, status: newStatus } : s)),
          };
        }
        if (newStatus === 'Added') {
          const addedCapacity = Math.round(target.amount * (1 + d.commissionRate / 100));
          const newBalance = (parseFloat(d.balance.replace(/[^\d.]/g, '')) || 0) + target.amount;
          return {
            ...d,
            preDeposit: d.preDeposit + target.amount,
            availableCapacity: d.availableCapacity + addedCapacity,
            balance: formatETB(newBalance),
            swaps: d.swaps.map((s) =>
              s.id === swapId ? { ...s, status: 'Added', note: 'Manually confirmed' } : s
            ),
          };
        }
        return {
          ...d,
          swaps: d.swaps.map((s) =>
            s.id === swapId ? { ...s, status: 'Failed', note: 'Marked failed by operator' } : s
          ),
        };
      })
    );
    setSwapHistoryFor((prev) =>
      prev && prev.id === deviceId
        ? {
            ...prev,
            swaps: prev.swaps.map((s) => (s.id === swapId ? { ...s, status: newStatus } : s)),
          }
        : prev
    );
  };

  const isExhausted = (device: Device) => {
    const total = calcTotalCapacity(device.preDeposit, device.commissionRate) || 1;
    return device.availableCapacity / total < 0.05;
  };

  const copyToken = (token: string) => {
    navigator.clipboard?.writeText(token);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  const usedPct = (device: Device) => {
    const used = parseFloat(device.usedToday.replace(/[^\d.]/g, '')) || 0;
    const limit = parseFloat(device.dailyLimit.replace(/[^\d.]/g, '')) || 1;
    return Math.min(100, Math.round((used / limit) * 100));
  };

  /* ---------------------------------------------------------------------- */
  /*  Add Account (linked sub-account) — purely additive enhancement.       */
  /*  Lets an operator attach an extra phone number to an existing wallet   */
  /*  without registering a brand-new wallet, expanding daily transaction   */
  /*  capacity & commission. Existing primary phone is never touched.       */
  /* ---------------------------------------------------------------------- */
  const [addAccountFor, setAddAccountFor] = useState<Device | null>(null);
  const [newAccountPhone, setNewAccountPhone] = useState('');
  const [newAccountLabel, setNewAccountLabel] = useState('');

  const isPhoneAlreadyUsed = (deviceId: string, phone: string) => {
    const trimmed = phone.trim();
    if (!trimmed) return false;
    const target = devices.find((d) => d.id === deviceId);
    if (!target) return false;
    if (target.phone.replace(/\s/g, '') === trimmed.replace(/\s/g, '')) return true;
    return target.subAccounts.some(
      (a) => a.phone.replace(/\s/g, '') === trimmed.replace(/\s/g, '')
    );
  };

  const handleAddSubAccount = async () => {
    if (!addAccountFor) return;
    const phone = newAccountPhone.trim();
    if (!phone) {
      toast('Phone number is required.', 'error');
      return;
    }
    if (isPhoneAlreadyUsed(addAccountFor.id, phone)) {
      toast('This phone number is already linked to this wallet.', 'error');
      return;
    }
    try {
      await apiAddSubAccount(addAccountFor.id, {
        phone,
        label: newAccountLabel.trim() || undefined,
      });
      toast(`Linked ${phone} to ${addAccountFor.name}.`);
      const detail = await getWalletDevice(addAccountFor.id);
      const mapped = mapSubAccountRows((detail.sub_accounts as Array<Record<string, unknown>>) ?? []);
      setDevices((prev) =>
        prev.map((d) => (d.id === addAccountFor.id ? { ...d, subAccounts: mapped } : d))
      );
      setAddAccountFor(null);
      setNewAccountPhone('');
      setNewAccountLabel('');
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const removeSubAccount = async (deviceId: string, accountId: string) => {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRe.test(accountId)) {
      try {
        await apiRemoveLinkedAccount(accountId);
        toast('Linked account removed.', 'info');
        await refreshDevices();
      } catch (e) {
        toast(errMsg(e), 'error');
      }
      return;
    }
    setDevices((prev) =>
      prev.map((d) =>
        d.id === deviceId ? { ...d, subAccounts: d.subAccounts.filter((a) => a.id !== accountId) } : d
      )
    );
    toast('Linked account removed.', 'info');
  };

  const toggleSubAccount = async (deviceId: string, accountId: string, nextEnabled: boolean) => {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRe.test(accountId)) {
      try {
        await apiToggleLinkedAccount(accountId, { enabled: nextEnabled });
        await refreshDevices();
      } catch (e) {
        toast(errMsg(e), 'error');
      }
      return;
    }
    setDevices((prev) =>
      prev.map((d) =>
        d.id === deviceId
          ? {
              ...d,
              subAccounts: d.subAccounts.map((a) =>
                a.id === accountId ? { ...a, enabled: nextEnabled } : a
              ),
            }
          : d
      )
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Smartphone className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Wallet Devices</h1>
          {listLoading && <span className="text-xs text-gray-500">Loading…</span>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void refreshDevices()}
            disabled={listLoading}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowRegister(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Register Device
          </button>
        </div>
      </div>

      <div className="bg-white border-l-4 border-blue-500 rounded-lg shadow-sm p-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start space-x-3">
          <div className="p-2 bg-blue-50 rounded-lg flex-shrink-0">
            <Zap className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Withdrawal Auto-Swap {autoWithdrawalSwap ? 'Active' : 'Disabled'}
            </p>
            <p className="text-xs text-gray-600 mt-0.5 max-w-2xl">
              When a user withdraws from a wallet device, the withdrawn amount is automatically
              added back to that device&apos;s Available Capacity — no manual top-up needed. Manual
              Top-Up and manual Swap remain available for pre-deposit exhaustion.
            </p>
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={autoWithdrawalSwap}
            onChange={(e) => setAutoWithdrawalSwap(e.target.checked)}
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          <span className="ml-2 text-xs font-medium text-gray-700">
            Auto-swap on withdrawal
          </span>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.map((device) => (
          <div key={device.id} className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg ${device.status === 'Online' ? 'bg-green-50' : 'bg-red-50'}`}>
                  {device.status === 'Online' ? (
                    <Wifi className="h-5 w-5 text-green-600" />
                  ) : (
                    <WifiOff className="h-5 w-5 text-red-600" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{device.name}</h3>
                  <p className="text-xs text-gray-500">{device.phone}</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={device.enabled}
                  onChange={() => toggleDevice(device.id)}
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Status</span>
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                    device.status === 'Online' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}
                >
                  {device.status}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Balance</span>
                <span className="font-medium text-gray-900">{device.balance}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Commission Rate</span>
                <span className="font-medium text-blue-600">{device.commissionRate}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Pre-Deposit</span>
                <span className="font-medium text-gray-900">{formatETB(device.preDeposit)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total Capacity</span>
                <span className="font-medium text-gray-900">
                  {formatETB(calcTotalCapacity(device.preDeposit, device.commissionRate))}
                </span>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500 inline-flex items-center">
                    <ArrowLeftRight size={12} className="mr-1 text-blue-600" />
                    Available Capacity
                    {isExhausted(device) && (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">
                        <AlertTriangle size={10} className="mr-0.5" />
                        Exhausted
                      </span>
                    )}
                  </span>
                  <span className="font-medium text-gray-900">
                    {formatETB(device.availableCapacity)}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  {(() => {
                    const total = calcTotalCapacity(device.preDeposit, device.commissionRate) || 1;
                    const pct = Math.min(100, Math.round((device.availableCapacity / total) * 100));
                    return (
                      <div
                        className={`h-1.5 rounded-full ${
                          pct < 20 ? 'bg-red-500' : pct < 50 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      ></div>
                    );
                  })()}
                </div>
              </div>
              {(() => {
                const t = todaysSwapTotals(device.swaps);
                return (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        <History size={12} className="mr-1.5 text-blue-600" />
                        Today&apos;s Swap
                      </span>
                      <button
                        onClick={() => setSwapHistoryFor(device)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800"
                      >
                        View All
                      </button>
                    </div>
                    {t.count === 0 ? (
                      <p className="text-xs text-gray-500">No swap recorded today.</p>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="inline-flex items-center text-gray-700">
                            <PlusCircle size={12} className="mr-1 text-blue-600" /> Top-Up (manual)
                          </span>
                          <span className="font-semibold text-gray-900">
                            {formatETB(t.addedManual)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="inline-flex items-center text-gray-700">
                            <Zap size={12} className="mr-1 text-blue-600" />
                            Withdrawal (auto){' '}
                            {t.withdrawalCount > 0 && (
                              <span className="ml-1 text-[10px] text-gray-500">
                                ×{t.withdrawalCount}
                              </span>
                            )}
                          </span>
                          <span className="font-semibold text-gray-900">
                            {formatETB(t.addedWithdrawal)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs border-t border-gray-200 pt-1 mt-1">
                          <span className="inline-flex items-center text-green-700 font-semibold">
                            <CheckCircle2 size={12} className="mr-1" /> Added today
                          </span>
                          <span className="font-bold text-green-700">
                            {formatETB(t.added)}
                          </span>
                        </div>
                        {t.pending > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="inline-flex items-center text-yellow-700">
                              <Clock size={12} className="mr-1" /> Pending
                            </span>
                            <span className="font-semibold text-yellow-700">
                              {formatETB(t.pending)}
                            </span>
                          </div>
                        )}
                        {t.failed > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="inline-flex items-center text-red-700">
                              <XCircle size={12} className="mr-1" /> Failed
                            </span>
                            <span className="font-semibold text-red-700">
                              {formatETB(t.failed)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">Daily Usage</span>
                  <span className="font-medium text-gray-900">
                    {device.usedToday} / {device.dailyLimit}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${
                      usedPct(device) > 80 ? 'bg-red-500' : usedPct(device) > 50 ? 'bg-yellow-500' : 'bg-blue-600'
                    }`}
                    style={{ width: `${usedPct(device)}%` }}
                  ></div>
                </div>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Last seen</span>
                <span>{device.lastSeen}</span>
              </div>
              <div className="pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Device Token</span>
                  <button
                    onClick={() => copyToken(device.token)}
                    className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {copied === device.token ? (
                      <>
                        <Check size={12} className="mr-1" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={12} className="mr-1" /> Copy
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs font-mono text-gray-700 mt-1 truncate">{device.token}</p>
              </div>
              {device.subAccounts.length > 0 && (
                <div className="pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="inline-flex items-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      <UserPlus size={12} className="mr-1.5 text-blue-600" />
                      Linked Accounts ({device.subAccounts.length})
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {device.subAccounts.map((acc) => (
                      <li
                        key={acc.id}
                        className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center text-xs">
                            <Phone size={12} className="mr-1.5 text-gray-500 flex-shrink-0" />
                            <span className="font-medium text-gray-900 truncate">
                              {acc.phone}
                            </span>
                            {!acc.enabled && (
                              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-200 text-gray-700 flex-shrink-0">
                                Disabled
                              </span>
                            )}
                          </div>
                          {acc.label && (
                            <p className="text-[11px] text-gray-500 mt-0.5 ml-[18px] truncate">
                              {acc.label}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                          <label
                            className="relative inline-flex items-center cursor-pointer"
                            title={acc.enabled ? 'Disable account' : 'Enable account'}
                          >
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={acc.enabled}
                              onChange={() => toggleSubAccount(device.id, acc.id, !acc.enabled)}
                            />
                            <div className="w-7 h-4 bg-gray-300 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                          </label>
                          <button
                            type="button"
                            aria-label={`Remove ${acc.phone}`}
                            title="Remove linked account"
                            onClick={() => removeSubAccount(device.id, acc.id)}
                            className="text-gray-400 hover:text-red-600"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => {
                    setTopUpDevice(device);
                    setTopUpAmount('');
                    setTopUpReauto(true);
                  }}
                  className={`inline-flex items-center text-xs font-semibold ${
                    isExhausted(device)
                      ? 'text-orange-700 hover:text-orange-900'
                      : 'text-blue-600 hover:text-blue-800'
                  }`}
                >
                  <PlusCircle size={12} className="mr-1" /> Top Up Pre-Deposit
                </button>
                <button
                  onClick={() => {
                    setWithdrawalSwapFor(device);
                    setWithdrawalAmount('');
                    setWithdrawalUser('');
                  }}
                  className="inline-flex items-center text-xs font-semibold text-green-700 hover:text-green-900"
                  title="Record a withdrawal — amount is auto-added to Available Capacity"
                >
                  <ArrowUpCircle size={12} className="mr-1" /> Withdrawal Swap
                </button>
                <button
                  onClick={() => {
                    setAddAccountFor(device);
                    setNewAccountPhone('');
                    setNewAccountLabel('');
                  }}
                  className="inline-flex items-center text-xs font-semibold text-purple-700 hover:text-purple-900"
                  title="Link an additional phone number / account to this wallet"
                >
                  <UserPlus size={12} className="mr-1" /> Add Account
                </button>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => {
                    setPinCurrent('');
                    setPinNew('');
                    setPinConfirm('');
                    setPinDevice(device);
                  }}
                  className="inline-flex items-center text-xs font-medium text-gray-600 hover:text-gray-900"
                >
                  <Lock size={12} className="mr-1" /> PIN
                </button>
                <button
                  onClick={() => toast(`Opening edit form for ${device.name}…`)}
                  className="inline-flex items-center text-xs font-medium text-gray-600 hover:text-gray-900"
                >
                  <Edit2 size={12} className="mr-1" /> Edit
                </button>
                <button
                  onClick={() => toast(`Opening logs for ${device.name}…`)}
                  className="inline-flex items-center text-xs font-medium text-gray-600 hover:text-gray-900"
                >
                  <FileText size={12} className="mr-1" /> Logs
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {swapHistoryFor && (() => {
        const t = todaysSwapTotals(swapHistoryFor.swaps);
        const sorted = [...swapHistoryFor.swaps].sort((a, b) =>
          `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
        );
        return (
          <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <div className="flex items-center space-x-2">
                  <History className="h-5 w-5 text-blue-600" />
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">
                      Swap History — {swapHistoryFor.name}
                    </h3>
                    <p className="text-xs text-gray-500">
                      Pre-deposit top-ups for this wallet device
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSwapHistoryFor(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="px-6 py-4 border-b border-gray-200 grid grid-cols-4 gap-3 text-center bg-gray-50">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Added Today</p>
                  <p className="text-sm font-semibold text-green-700 mt-0.5">{formatETB(t.added)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Pending</p>
                  <p className="text-sm font-semibold text-yellow-700 mt-0.5">{formatETB(t.pending)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Failed</p>
                  <p className="text-sm font-semibold text-red-700 mt-0.5">{formatETB(t.failed)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500">Entries</p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{swapHistoryFor.swaps.length}</p>
                </div>
              </div>

              <div className="overflow-y-auto flex-1">
                {sorted.length === 0 ? (
                  <div className="p-10 text-center text-sm text-gray-500">
                    No swaps recorded for this wallet yet.
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Operator</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {sorted.map((s) => {
                        const isToday = s.date === today;
                        return (
                          <tr key={s.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-700">
                              {isToday ? (
                                <span className="inline-flex items-center">
                                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 mr-1.5"></span>
                                  Today
                                </span>
                              ) : (
                                s.date
                              )}
                            </td>
                            <td className="px-4 py-2 text-gray-700">{s.time}</td>
                            <td className="px-4 py-2">
                              {s.source === 'Withdrawal' ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  <Zap size={11} className="mr-1" /> Withdrawal (auto)
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                  <PlusCircle size={11} className="mr-1" /> Top-Up
                                </span>
                              )}
                              {s.refUser && (
                                <p className="text-[11px] text-gray-500 mt-0.5">
                                  user: {s.refUser}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-2 font-semibold text-gray-900">
                              {formatETB(s.amount)}
                            </td>
                            <td className="px-4 py-2">
                              {s.status === 'Added' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                  <CheckCircle2 size={12} className="mr-1" /> Added
                                </span>
                              )}
                              {s.status === 'Pending' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                  <Clock size={12} className="mr-1" /> Pending
                                </span>
                              )}
                              {s.status === 'Failed' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                  <XCircle size={12} className="mr-1" /> Failed
                                </span>
                              )}
                              {s.note && (
                                <p className="text-[11px] text-gray-500 mt-0.5">{s.note}</p>
                              )}
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-600">{s.operator}</td>
                            <td className="px-4 py-2 text-right">
                              {s.status === 'Pending' ? (
                                <div className="inline-flex items-center space-x-2">
                                  <button
                                    onClick={() => confirmPendingSwap(swapHistoryFor.id, s.id, 'Added')}
                                    className="text-xs font-medium text-green-700 hover:text-green-900"
                                  >
                                    Confirm
                                  </button>
                                  <span className="text-gray-300">·</span>
                                  <button
                                    onClick={() => confirmPendingSwap(swapHistoryFor.id, s.id, 'Failed')}
                                    className="text-xs font-medium text-red-600 hover:text-red-800"
                                  >
                                    Fail
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex justify-end px-6 py-3 border-t border-gray-200 bg-gray-50">
                <button
                  onClick={() => {
                    setSwapHistoryFor(null);
                    setTopUpDevice(swapHistoryFor);
                    setTopUpAmount('');
                    setTopUpAutoConfirm(true);
                    setTopUpReauto(true);
                  }}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700"
                >
                  <PlusCircle size={14} className="mr-1.5" />
                  New Swap (Top Up)
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {withdrawalSwapFor && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <ArrowUpCircle className="h-5 w-5 text-green-600" />
                <h3 className="text-lg font-medium text-gray-900">
                  Withdrawal Swap — {withdrawalSwapFor.name}
                </h3>
              </div>
              <button
                onClick={() => setWithdrawalSwapFor(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div
                className={`rounded-lg p-3 flex items-start space-x-2 border ${
                  autoWithdrawalSwap
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-yellow-50 border-yellow-200'
                }`}
              >
                <Zap
                  size={16}
                  className={`mt-0.5 flex-shrink-0 ${
                    autoWithdrawalSwap ? 'text-blue-600' : 'text-yellow-600'
                  }`}
                />
                <div className="text-xs">
                  {autoWithdrawalSwap ? (
                    <>
                      <p className="font-semibold text-blue-900">Auto-Swap is ON</p>
                      <p className="text-blue-800 mt-0.5">
                        The withdrawn amount will be added to this wallet&apos;s Available Capacity
                        automatically. No manual top-up is needed.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-yellow-900">Auto-Swap is OFF</p>
                      <p className="text-yellow-800 mt-0.5">
                        Withdrawal will be recorded for reporting only — Available Capacity will
                        NOT change. Enable auto-swap above to restore capacity automatically.
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Pre-Deposit</p>
                  <p className="font-medium text-gray-900">
                    {formatETB(withdrawalSwapFor.preDeposit)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Available Capacity</p>
                  <p className="font-medium text-gray-900">
                    {formatETB(withdrawalSwapFor.availableCapacity)}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Withdrawal Amount (ETB) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={withdrawalAmount}
                  onChange={(e) => setWithdrawalAmount(e.target.value)}
                  placeholder="e.g. 1500"
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <div className="flex items-center space-x-2 mt-2">
                  {[500, 1000, 2500, 5000].map((quick) => (
                    <button
                      key={quick}
                      type="button"
                      onClick={() => setWithdrawalAmount(String(quick))}
                      className="px-2.5 py-1 text-xs font-medium border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50"
                    >
                      {formatETB(quick)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  User (optional)
                </label>
                <input
                  type="text"
                  value={withdrawalUser}
                  onChange={(e) => setWithdrawalUser(e.target.value)}
                  placeholder="username or phone (for audit log)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              {autoWithdrawalSwap && withdrawalAmount && parseFloat(withdrawalAmount) > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-green-900">Current Available</span>
                    <span className="font-semibold text-green-900">
                      {formatETB(withdrawalSwapFor.availableCapacity)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-green-900">+ Auto-Swap (withdrawal)</span>
                    <span className="font-semibold text-green-900">
                      +{formatETB(parseFloat(withdrawalAmount))}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-green-200 pt-1 mt-1">
                    <span className="text-green-900 font-semibold">New Available Capacity</span>
                    <span className="font-bold text-green-900">
                      {formatETB(
                        withdrawalSwapFor.availableCapacity + parseFloat(withdrawalAmount)
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setWithdrawalSwapFor(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void recordWithdrawalAutoSwap()}
                disabled={!withdrawalAmount || parseFloat(withdrawalAmount) <= 0}
                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {autoWithdrawalSwap ? 'Record & Auto-Swap' : 'Record Only'}
              </button>
            </div>
          </div>
        </div>
      )}

      {topUpDevice && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center space-x-2">
                <Wallet className="h-5 w-5 text-orange-600" />
                <h3 className="text-lg font-medium text-gray-900">
                  Top Up Pre-Deposit — {topUpDevice.name}
                </h3>
              </div>
              <button
                onClick={() => setTopUpDevice(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {isExhausted(topUpDevice) && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-start space-x-2">
                  <AlertTriangle size={16} className="text-orange-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-orange-900">
                    <p className="font-semibold">This wallet is exhausted</p>
                    <p className="mt-0.5">
                      Auto-switch moved traffic to the next priority wallet. Top up now to bring
                      this wallet back into rotation.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Current Pre-Deposit</p>
                  <p className="font-medium text-gray-900">{formatETB(topUpDevice.preDeposit)}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Available Capacity</p>
                  <p className="font-medium text-gray-900">
                    {formatETB(topUpDevice.availableCapacity)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Commission Rate</p>
                  <p className="font-medium text-blue-600">{topUpDevice.commissionRate}%</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Total Capacity</p>
                  <p className="font-medium text-gray-900">
                    {formatETB(
                      calcTotalCapacity(topUpDevice.preDeposit, topUpDevice.commissionRate)
                    )}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Top Up Amount (ETB) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  placeholder="e.g. 50000"
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <div className="flex items-center space-x-2 mt-2">
                  {[10000, 50000, 100000].map((quick) => (
                    <button
                      key={quick}
                      type="button"
                      onClick={() => setTopUpAmount(String(quick))}
                      className="px-2.5 py-1 text-xs font-medium border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50"
                    >
                      +{formatETB(quick)}
                    </button>
                  ))}
                </div>
              </div>

              {topUpAmount && parseFloat(topUpAmount) > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-green-900">New Pre-Deposit</span>
                    <span className="font-semibold text-green-900">
                      {formatETB(topUpDevice.preDeposit + parseFloat(topUpAmount))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-green-900">New Total Capacity</span>
                    <span className="font-semibold text-green-900">
                      {formatETB(
                        calcTotalCapacity(
                          topUpDevice.preDeposit + parseFloat(topUpAmount),
                          topUpDevice.commissionRate
                        )
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-green-900">Available After Top-Up</span>
                    <span className="font-semibold text-green-900">
                      {formatETB(
                        topUpDevice.availableCapacity +
                          Math.round(
                            parseFloat(topUpAmount) * (1 + topUpDevice.commissionRate / 100)
                          )
                      )}
                    </span>
                  </div>
                </div>
              )}

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={topUpAutoConfirm}
                  onChange={(e) => setTopUpAutoConfirm(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">
                  Mark swap as <span className="font-semibold text-green-700">Added</span> now (uncheck to record as{' '}
                  <span className="font-semibold text-yellow-700">Pending</span> until SMS confirmation)
                </span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={topUpReauto}
                  onChange={(e) => setTopUpReauto(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">
                  Re-enable wallet and rejoin auto-switch rotation after top-up
                </span>
              </label>
            </div>

            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg flex-shrink-0">
              <button
                onClick={() => setTopUpDevice(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleTopUp}
                disabled={!topUpAmount || parseFloat(topUpAmount) <= 0}
                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Confirm Top-Up
              </button>
            </div>
          </div>
        </div>
      )}

      {showRegister && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
              <div className="flex items-center space-x-2">
                <Plus className="h-5 w-5 text-blue-600" />
                <h3 className="text-lg font-medium text-gray-900">Register Agent Wallet</h3>
              </div>
              <button
                onClick={() => {
                  setShowRegister(false);
                  setRegisterForm(emptyRegister);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800 flex items-start space-x-2">
                <ArrowLeftRight size={14} className="mt-0.5 flex-shrink-0" />
                <p>
                  Agent provides a phone number and a pre-deposit. Total Capacity ={' '}
                  <span className="font-mono">pre_deposit × (1 + commission%)</span>. Deposits
                  reduce capacity; withdrawals restore it (swap logic).
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Wallet Label <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={registerForm.name}
                    onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                    placeholder="e.g. Telebirr-06"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Telebirr Phone <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={registerForm.phone}
                    onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
                    placeholder="+2519XXXXXXXX"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Pre-Deposit (ETB) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={registerForm.preDeposit}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, preDeposit: e.target.value })
                    }
                    placeholder="100000"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Commission Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={registerForm.commissionRate}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, commissionRate: e.target.value })
                    }
                    placeholder="2.5"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {registerForm.preDeposit && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Computed Total Capacity</span>
                    <span className="font-semibold text-gray-900">
                      {formatETB(
                        calcTotalCapacity(
                          parseFloat(registerForm.preDeposit) || 0,
                          parseFloat(registerForm.commissionRate) || 0
                        )
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {registerForm.preDeposit} × (1 + {registerForm.commissionRate || 0}% / 100)
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Daily Limit (ETB)
                  </label>
                  <input
                    type="number"
                    value={registerForm.dailyLimit}
                    onChange={(e) =>
                      setRegisterForm({ ...registerForm, dailyLimit: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">USSD PIN</label>
                  <input
                    type="password"
                    value={registerForm.pin}
                    onChange={(e) => setRegisterForm({ ...registerForm, pin: e.target.value })}
                    placeholder="Stored encrypted"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg sticky bottom-0">
              <button
                onClick={() => {
                  setShowRegister(false);
                  setRegisterForm(emptyRegister);
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleRegister()}
                disabled={
                  !registerForm.name.trim() ||
                  !registerForm.phone.trim() ||
                  !registerForm.preDeposit
                }
                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Register Wallet
              </button>
            </div>
          </div>
        </div>
      )}

      {pinDevice && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <Key className="h-5 w-5 text-blue-600" />
                <h3 className="text-lg font-medium text-gray-900">Update USSD PIN</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPinDevice(null);
                  setPinCurrent('');
                  setPinNew('');
                  setPinConfirm('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                <strong>Security:</strong> PIN is stored encrypted and never displayed again. Make sure this matches the SIM PIN.
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Device</label>
                <input
                  type="text"
                  readOnly
                  value={`${pinDevice.name} (${pinDevice.phone})`}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current USSD PIN</label>
                <input
                  type="password"
                  value={pinCurrent}
                  onChange={(e) => setPinCurrent(e.target.value)}
                  autoComplete="off"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New USSD PIN</label>
                <input
                  type="password"
                  value={pinNew}
                  onChange={(e) => setPinNew(e.target.value)}
                  placeholder="Enter new PIN"
                  autoComplete="new-password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New PIN</label>
                <input
                  type="password"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value)}
                  placeholder="Re-enter new PIN"
                  autoComplete="new-password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                type="button"
                onClick={() => {
                  setPinDevice(null);
                  setPinCurrent('');
                  setPinNew('');
                  setPinConfirm('');
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void (async () => {
                  if (!pinDevice) return;
                  if (!pinCurrent.trim() || !pinNew.trim()) {
                    toast('Current and new PIN are required.', 'error');
                    return;
                  }
                  if (pinNew !== pinConfirm) {
                    toast('New PIN confirmation does not match.', 'error');
                    return;
                  }
                  try {
                    await updateWalletUssdPin(pinDevice.id, {
                      current_pin: pinCurrent.trim(),
                      new_pin: pinNew.trim(),
                    });
                    toast(`PIN updated for ${pinDevice.name}.`);
                    setPinDevice(null);
                    setPinCurrent('');
                    setPinNew('');
                    setPinConfirm('');
                  } catch (e) {
                    toast(errMsg(e), 'error');
                  }
                })()}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                <Lock size={16} className="mr-2" />
                Update PIN
              </button>
            </div>
          </div>
        </div>
      )}

      {addAccountFor && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <UserPlus className="h-5 w-5 text-purple-600" />
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Add Linked Account</h3>
                  <p className="text-xs text-gray-500">
                    Attach an additional phone number to {addAccountFor.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setAddAccountFor(null);
                  setNewAccountPhone('');
                  setNewAccountLabel('');
                }}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="rounded-md border border-purple-100 bg-purple-50 px-3 py-2 text-xs text-purple-900">
                Adding an account links a new phone number to{' '}
                <span className="font-semibold">{addAccountFor.name}</span> ({addAccountFor.phone}).
                The wallet itself is not duplicated — capacity and daily commission expand on the
                same wallet.
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Wallet Device
                </label>
                <input
                  type="text"
                  readOnly
                  value={`${addAccountFor.name} (${addAccountFor.phone})`}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="+2519XX000000"
                  value={newAccountPhone}
                  onChange={(e) => setNewAccountPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Label (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Backup SIM, Branch SIM"
                  value={newAccountLabel}
                  onChange={(e) => setNewAccountLabel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
              {addAccountFor.subAccounts.length > 0 && (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-xs font-semibold text-gray-700 mb-1">
                    Already linked ({addAccountFor.subAccounts.length})
                  </p>
                  <ul className="space-y-0.5">
                    {addAccountFor.subAccounts.map((acc) => (
                      <li
                        key={acc.id}
                        className="text-xs text-gray-600 inline-flex items-center mr-2"
                      >
                        <Phone size={10} className="mr-1" /> {acc.phone}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => {
                  setAddAccountFor(null);
                  setNewAccountPhone('');
                  setNewAccountLabel('');
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSubAccount}
                disabled={!newAccountPhone.trim()}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UserPlus size={16} className="mr-2" />
                Add Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
