import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { toast } from '../../lib/toast';
import { 
  Users, 
  DollarSign, 
  Gift, 
  Settings,
  FileDown,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  AlertTriangle,
  Plus,
  X
} from 'lucide-react';
import * as promotionsApi from '../../lib/api/promotions';
import { useAuthStore } from '../../store/auth';

interface ReferralData {
  id: string;
  referrer: string;
  referredUser: string;
  phone: string;
  dateJoined: string;
  depositMade: number;
  qualified: boolean;
  bonusStatus: string;
  reward: number;
}

interface PendingRewardData {
  id: string;
  referrer: string;
  referredUser: string;
  phone: string;
  qualifyingAction: string;
  amount: number;
  status: string;
  dueDate: string;
  notes: string;
}

interface PaidRewardData {
  id: string;
  referrer: string;
  referredUser: string;
  phone: string;
  amount: number;
  paidDate: string;
  paymentMethod: string;
  reference: string;
  processedBy: string;
}

interface ReferralConfig {
  is_enabled?: boolean;
  reward_amount: number;
  min_deposit_to_qualify: number;
  reward_type: 'cash' | 'free_bet';
}

const mapReferral = (row: Record<string, unknown>): ReferralData => {
  const rewardAmount = Number(row.reward ?? row.reward_amount ?? 0);
  const status = String(row.bonus_status ?? row.status ?? 'pending');
  return {
    id: String(row.id ?? ''),
    referrer: String(row.referrer ?? row.referrer_id ?? '—'),
    referredUser: String(row.referred_user ?? row.referred_user_id ?? '—'),
    phone: String(row.referred_phone ?? row.phone ?? '—'),
    dateJoined: row.date_joined ? new Date(String(row.date_joined)).toLocaleDateString() : row.created_at ? new Date(String(row.created_at)).toLocaleDateString() : '—',
    depositMade: Number(row.deposit_made ?? row.deposit_amount ?? 0),
    qualified: status !== 'cancelled' && status !== 'expired',
    bonusStatus: status,
    reward: rewardAmount,
  };
};

const toPendingReward = (r: ReferralData): PendingRewardData => ({
  id: r.id,
  referrer: r.referrer,
  referredUser: r.referredUser,
  phone: r.phone,
  qualifyingAction: 'Referral qualified',
  amount: r.reward,
  status: r.bonusStatus,
  dueDate: r.dateJoined,
  notes: 'Awaiting reward action',
});

const toPaidReward = (r: ReferralData): PaidRewardData => ({
  id: r.id,
  referrer: r.referrer,
  referredUser: r.referredUser,
  phone: r.phone,
  amount: r.reward,
  paidDate: r.dateJoined,
  paymentMethod: 'Wallet Credit',
  reference: `REF-${r.id.slice(0, 8)}`,
  processedBy: 'System',
});

const StatCard = ({ icon: Icon, title, value, trend }: { icon: any; title: string; value: string; trend?: string }) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <div className="p-2 bg-blue-50 rounded-lg">
        <Icon className="h-6 w-6 text-blue-600" />
      </div>
    </div>
    <h3 className="text-lg font-semibold text-gray-900">{value}</h3>
    <p className="text-sm text-gray-500 mt-1">{title}</p>
    {trend && (
      <p className="text-sm text-blue-600 mt-2">{trend}</p>
    )}
  </div>
);

const ConfigurationModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [config, setConfig] = useState<ReferralConfig>({
    is_enabled: true,
    reward_amount: 10,
    min_deposit_to_qualify: 20,
    reward_type: 'cash',
  });
  const [saving, setSaving] = useState(false);

  // Hooks must come before any conditional return (React rules).
  useEffect(() => {
    if (!isOpen) return;
    promotionsApi
      .getReferralConfig()
      .then((cfg) => setConfig({ is_enabled: true, ...cfg }))
      .catch((err: Error) => toast(`Failed to load config: ${err.message ?? err}`, 'error'));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    promotionsApi
      .updateReferralConfig(config)
      .then(() => {
        toast('Referral configuration saved.');
        onClose();
      })
      .catch((err: Error) => toast(`Failed to save config: ${err.message ?? err}`, 'error'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Referral Program Configuration</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">×</button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Enable / Disable toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div>
                <p className="text-sm font-medium text-gray-900">Program Status</p>
                <p className="text-xs text-gray-500 mt-0.5">Enable or disable the referral program for all users</p>
              </div>
              <button
                type="button"
                onClick={() => setConfig({ ...config, is_enabled: !config.is_enabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  config.is_enabled ? 'bg-green-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    config.is_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Minimum Deposit (ETB)</label>
                <input
                  type="number"
                  min={0}
                  value={config.min_deposit_to_qualify}
                  onChange={(e) => setConfig({ ...config, min_deposit_to_qualify: Number(e.target.value) })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Reward Amount (ETB)</label>
                <input
                  type="number"
                  min={0}
                  value={config.reward_amount}
                  onChange={(e) => setConfig({ ...config, reward_amount: Number(e.target.value) })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Reward Type</label>
              <select
                value={config.reward_type}
                onChange={(e) => setConfig({ ...config, reward_type: e.target.value as 'cash' | 'free_bet' })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
              >
                <option value="cash">Cash (credited to wallet automatically)</option>
                <option value="free_bet">Free Bet</option>
              </select>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save Configuration'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

const ProcessRewardModal = ({ isOpen, onClose, reward, onProcessed }: { isOpen: boolean; onClose: () => void; reward: PendingRewardData | null; onProcessed?: () => void }) => {
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('wallet');
  const [processing, setProcessing] = useState(false);

  // Hooks before conditional return (React rules of hooks).
  if (!isOpen || !reward) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (processing) return;
    setProcessing(true);
    promotionsApi
      .payAdminAffiliateReferral(reward.id)
      .then(() => {
        toast('Reward processed.');
        onProcessed?.();
        onClose();
      })
      .catch((err: Error) => toast(`Failed to process reward: ${err.message ?? err}`, 'error'))
      .finally(() => setProcessing(false));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Process Reward</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-500">Referrer</label>
                <p className="mt-1 text-lg font-medium">{reward.referrer}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Amount</label>
                <p className="mt-1 text-lg font-medium">${reward.amount}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Qualifying Action</label>
                <p className="mt-1 text-lg font-medium">{reward.qualifyingAction}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Due Date</label>
                <p className="mt-1 text-lg font-medium">{reward.dueDate}</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="wallet">Wallet Credit</option>
                <option value="bonus">Bonus Credit</option>
                <option value="freebet">Free Bet</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Processing Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="Add any relevant notes about this reward processing"
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={processing}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {processing ? 'Processing…' : 'Process Reward'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export function Referrals() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('activity');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedReward, setSelectedReward] = useState<PendingRewardData | null>(null);
  const [isProcessModalOpen, setIsProcessModalOpen] = useState(false);
  const [rows, setRows] = useState<ReferralData[]>([]);
  const [settings, setSettings] = useState<ReferralConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const reloadReferrals = async () => {
    setLoading(true);
    try {
      const res = await promotionsApi.listAdminAffiliateReferrals({
        status: 'all',
        page: 1,
        limit: 200,
      });
      setRows((res.data ?? []).map((i) => mapReferral(i as Record<string, unknown>)));
    } catch (err) {
      toast(`Failed to load referrals: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuth) return;
    void reloadReferrals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuth]);

  useEffect(() => {
    if (!isAuth) return;
    promotionsApi
      .getReferralConfig()
      .then((cfg) => setSettings(cfg))
      .catch((err: Error) => toast(`Failed to load referral config: ${err.message ?? err}`, 'error'));
  }, [isAuth]);

  const tabs = [
    { id: 'activity', label: 'Referral Activity' },
    { id: 'pending', label: 'Pending Rewards' },
    { id: 'paid', label: 'Paid Rewards' },
    { id: 'settings', label: 'Program Settings' },
  ];

  const filters = [
    {
      label: 'Phone Number',
      options: [],
      value: phoneNumber,
      onChange: setPhoneNumber,
      type: 'text',
    },
    {
      label: 'Status',
      options: ['pending', 'paid'],
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
  ];

  const activityColumns = [
    { header: 'Referrer', accessor: 'referrer' as const },
    { header: 'Referred User', accessor: 'referredUser' as const },
    { header: 'Phone', accessor: 'phone' as const },
    { header: 'Date Joined', accessor: 'dateJoined' as const },
    { header: 'Deposit Made', accessor: 'depositMade' as const },
    { 
      header: 'Qualified', 
      accessor: 'qualified' as const,
      render: (value: boolean) => (
        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
          value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {value ? <CheckCircle className="h-4 w-4 mr-1" /> : <XCircle className="h-4 w-4 mr-1" />}
          {value ? 'Yes' : 'No'}
        </span>
      ),
    },
    { header: 'Bonus Status', accessor: 'bonusStatus' as const },
    { header: 'Reward', accessor: 'reward' as const },
  ];

  const pendingColumns = [
    { header: 'Referrer', accessor: 'referrer' as const },
    { header: 'Referred User', accessor: 'referredUser' as const },
    { header: 'Phone', accessor: 'phone' as const },
    { header: 'Qualifying Action', accessor: 'qualifyingAction' as const },
    { header: 'Amount', accessor: 'amount' as const },
    { header: 'Status', accessor: 'status' as const },
    { header: 'Due Date', accessor: 'dueDate' as const },
    { header: 'Notes', accessor: 'notes' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (value: string) => {
        const reward = pendingRows.find(r => r.id === value);
        return (
          <button
            onClick={() => {
              setSelectedReward(reward || null);
              setIsProcessModalOpen(true);
            }}
            className="text-blue-600 hover:text-blue-800"
          >
            Process
          </button>
        );
      },
    },
  ];

  const paidColumns = [
    { header: 'Referrer', accessor: 'referrer' as const },
    { header: 'Referred User', accessor: 'referredUser' as const },
    { header: 'Phone', accessor: 'phone' as const },
    { header: 'Amount', accessor: 'amount' as const },
    { header: 'Paid Date', accessor: 'paidDate' as const },
    { header: 'Payment Method', accessor: 'paymentMethod' as const },
    { header: 'Reference', accessor: 'reference' as const },
    { header: 'Processed By', accessor: 'processedBy' as const },
  ];

  const getData = () => {
    switch (activeTab) {
      case 'pending':
        return pendingRows;
      case 'paid':
        return paidRows;
      default:
        return filteredRows;
    }
  };

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!selectedStatus || r.bonusStatus === selectedStatus) &&
          (!phoneNumber || r.phone.includes(phoneNumber) || r.referrer.toLowerCase().includes(phoneNumber.toLowerCase()))
      ),
    [rows, selectedStatus, phoneNumber]
  );

  const pendingRows = useMemo(
    () => filteredRows.filter((r) => r.bonusStatus === 'pending').map(toPendingReward),
    [filteredRows]
  );

  const paidRows = useMemo(
    () =>
      filteredRows
        .filter((r) => r.bonusStatus === 'paid' || r.bonusStatus === 'rewarded')
        .map(toPaidReward),
    [filteredRows]
  );

  const getColumns = () => {
    switch (activeTab) {
      case 'pending':
        return pendingColumns;
      case 'paid':
        return paidColumns;
      default:
        return activityColumns;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Users className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Referral Program</h1>
        </div>
        <div className="space-x-4">
          <button
            onClick={() => toast('Referral report exported.')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Report
          </button>
          <button
            onClick={() => setIsConfigModalOpen(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <Settings className="h-4 w-4 mr-2" />
            Configure Program
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={Users}
          title="Total Referrers"
          value={loading ? '—' : String(new Set(rows.map((r) => r.referrer)).size)}
          trend="from API"
        />
        <StatCard
          icon={TrendingUp}
          title="Conversion Rate"
          value={
            loading
              ? '—'
              : `${Math.round((rows.filter((r) => r.qualified).length * 100) / Math.max(rows.length, 1))}%`
          }
          trend="qualified referrals"
        />
        <StatCard
          icon={DollarSign}
          title="Total Rewards"
          value={loading ? '—' : `$${rows.reduce((acc, r) => acc + r.reward, 0).toLocaleString()}`}
          trend="reward_amount aggregate"
        />
        <StatCard
          icon={Clock}
          title="Pending Rewards"
          value={loading ? '—' : String(pendingRows.length)}
          trend="status = pending"
        />
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === 'settings' ? (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900">Program Settings</h2>
            <button
              onClick={() => setIsConfigModalOpen(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Settings className="h-4 w-4 mr-2" />
              Edit Settings
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700">Basic Settings</h3>
              <dl className="mt-2 space-y-2">
                <div className="flex justify-between items-center">
                  <dt className="text-sm text-gray-500">Program Status</dt>
                  <dd className={`text-sm font-medium ${settings?.is_enabled !== false ? 'text-green-600' : 'text-red-500'}`}>
                    {settings?.is_enabled !== false ? 'Active' : 'Disabled'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700">Reward Settings</h3>
              <dl className="mt-2 space-y-2">
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Reward Amount</dt>
                  <dd className="text-sm font-medium">{settings?.reward_amount ?? 0} ETB</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Reward Type</dt>
                  <dd className="text-sm font-medium">{settings?.reward_type ?? 'cash'}</dd>
                </div>
              </dl>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700">Requirements</h3>
              <dl className="mt-2 space-y-2">
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Minimum Deposit</dt>
                  <dd className="text-sm font-medium">{settings?.min_deposit_to_qualify ?? 0} ETB</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
            <div className="flex">
              <AlertTriangle className="h-5 w-5 text-blue-400" />
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">Program Statistics</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>Total referrals loaded: {rows.length}</p>
                  <p>Pending rewards: {pendingRows.length}</p>
                  <p>Total rewards paid: {paidRows.length}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <FilterBar
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            filters={filters}
            onClear={() => {
              setSelectedStatus('');
              setPhoneNumber('');
              setStartDate(new Date());
              setEndDate(new Date());
            }}
          />

          <div className="bg-white rounded-lg shadow">
            <DataTable columns={getColumns()} data={getData()} />
          </div>
        </>
      )}

      <ConfigurationModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
      />

      <ProcessRewardModal
        isOpen={isProcessModalOpen}
        onClose={() => setIsProcessModalOpen(false)}
        reward={selectedReward}
        onProcessed={() => void reloadReferrals()}
      />
    </div>
  );
}
