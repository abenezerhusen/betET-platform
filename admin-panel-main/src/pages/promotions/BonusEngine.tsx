import React, { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { toast } from '../../lib/toast';
import { Gift, Plus, RefreshCw, Users, DollarSign, Target, X, Save, Ticket } from 'lucide-react';
import * as bonusesApi from '../../lib/api/bonuses';
import { useAuthStore } from '../../store/auth';
import {
  LossCashbackEditor,
  DEFAULT_PER_TICKET_CASHBACK,
} from './LossCashbackEditor';

interface RuleFormState {
  name: string;
  type: bonusesApi.BonusRuleType;
  status: bonusesApi.BonusRuleStatus;
  valid_from: string;
  valid_to: string;
  priority: number;
  min_deposit: number;
  match_pct: number;
  max_bonus: number;
  free_bet_amount: number;
  cashback_pct: number;
  wagering_req: number;
  expires_in_days: number;
}

interface BonusRow {
  id: string;
  name: string;
  type: string;
  status: string;
  active: string;
  validFrom: string;
  validTo: string;
  estimatedAmount: string;
  claims: number;
}

interface ClaimRow {
  id: string;
  user: string;
  amount: string;
  status: string;
  wagering: string;
  progress: string;
  awardedAt: string;
  expiresAt: string;
}

const bonusRuleSchema = z.object({
  name: z.string().trim().min(2, 'Bonus name is required'),
  type: z.enum(['deposit', 'free_bet', 'cashback', 'signup', 'referral']),
  match_pct: z.number().optional(),
  free_bet_amount: z.number().optional(),
  cashback_pct: z.number().optional(),
});

const defaultRuleForm: RuleFormState = {
  name: '',
  type: 'deposit',
  status: 'active',
  valid_from: '',
  valid_to: '',
  priority: 0,
  min_deposit: 0,
  match_pct: 100,
  max_bonus: 500,
  free_bet_amount: 50,
  cashback_pct: 10,
  wagering_req: 5,
  expires_in_days: 7,
};

function amountFromConfig(config: Record<string, unknown>): number {
  const explicit = typeof config.amount === 'number' ? config.amount : null;
  const maxBonus =
    typeof config.max_bonus === 'number'
      ? config.max_bonus
      : typeof config.max_amount === 'number'
        ? config.max_amount
        : null;
  if (explicit !== null) return explicit;
  if (maxBonus !== null) return maxBonus;
  return 0;
}

function buildConfig(form: RuleFormState): Record<string, unknown> {
  const base: Record<string, unknown> = {
    wagering_req: form.wagering_req,
    wagering_multiplier: form.wagering_req,
    expires_in_days: form.expires_in_days,
  };
  if (form.type === 'deposit') {
    base.min_deposit = form.min_deposit;
    base.match_pct = form.match_pct;
    base.percentage = form.match_pct;
    base.max_bonus = form.max_bonus;
    base.max_amount = form.max_bonus;
  } else if (form.type === 'free_bet') {
    base.free_bet_amount = form.free_bet_amount;
    base.amount = form.free_bet_amount;
  } else if (form.type === 'cashback') {
    base.cashback_pct = form.cashback_pct;
    base.percentage = form.cashback_pct;
  } else {
    base.amount = form.free_bet_amount;
  }
  return base;
}

function CreateBonusModal({
  isOpen,
  saving,
  form,
  onChange,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  saving: boolean;
  form: RuleFormState;
  onChange: (patch: Partial<RuleFormState>) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-40">
      <div className="bg-white rounded-lg w-full max-w-2xl">
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Create Bonus Rule</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input
                value={form.name}
                onChange={(e) => onChange({ name: e.target.value })}
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Type</label>
              <select
                value={form.type}
                onChange={(e) =>
                  onChange({ type: e.target.value as bonusesApi.BonusRuleType })
                }
                className="mt-1 w-full rounded-md border-gray-300"
              >
                <option value="deposit">deposit_match</option>
                <option value="free_bet">free_bet</option>
                <option value="cashback">cashback</option>
                <option value="signup">no_deposit</option>
                <option value="referral">referral_bonus</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Status</label>
              <select
                value={form.status}
                onChange={(e) =>
                  onChange({ status: e.target.value as bonusesApi.BonusRuleStatus })
                }
                className="mt-1 w-full rounded-md border-gray-300"
              >
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="expired">expired</option>
                <option value="disabled">disabled</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Priority</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => onChange({ priority: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Valid From</label>
              <input
                type="datetime-local"
                value={form.valid_from}
                onChange={(e) => onChange({ valid_from: e.target.value })}
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Valid To</label>
              <input
                type="datetime-local"
                value={form.valid_to}
                onChange={(e) => onChange({ valid_to: e.target.value })}
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
          </div>

          {form.type === 'deposit' && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Min Deposit</label>
                <input
                  type="number"
                  value={form.min_deposit}
                  onChange={(e) => onChange({ min_deposit: Number(e.target.value) })}
                  className="mt-1 w-full rounded-md border-gray-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Match %</label>
                <input
                  type="number"
                  value={form.match_pct}
                  onChange={(e) => onChange({ match_pct: Number(e.target.value) })}
                  className="mt-1 w-full rounded-md border-gray-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Max Bonus</label>
                <input
                  type="number"
                  value={form.max_bonus}
                  onChange={(e) => onChange({ max_bonus: Number(e.target.value) })}
                  className="mt-1 w-full rounded-md border-gray-300"
                />
              </div>
            </div>
          )}

          {form.type === 'free_bet' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Free Bet Amount</label>
              <input
                type="number"
                value={form.free_bet_amount}
                onChange={(e) => onChange({ free_bet_amount: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
          )}

          {form.type === 'cashback' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Cashback %</label>
              <input
                type="number"
                value={form.cashback_pct}
                onChange={(e) => onChange({ cashback_pct: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Wagering Req (x)</label>
              <input
                type="number"
                value={form.wagering_req}
                onChange={(e) => onChange({ wagering_req: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Expires In Days</label>
              <input
                type="number"
                value={form.expires_in_days}
                onChange={(e) => onChange({ expires_in_days: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !form.name.trim()}
              onClick={onSubmit}
              className="px-4 py-2 bg-purple-600 text-white rounded-md disabled:bg-gray-300"
            >
              {saving ? 'Creating...' : 'Create Bonus'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const StatCard = ({
  icon: Icon,
  title,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
}) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <div className="p-2 bg-purple-50 rounded-lg">
        <Icon className="h-6 w-6 text-purple-600" />
      </div>
    </div>
    <h3 className="text-lg font-semibold text-gray-900">{value}</h3>
    <p className="text-sm text-gray-500 mt-1">{title}</p>
  </div>
);

const DEFAULT_BONUS_SETTINGS: bonusesApi.BonusSettings = {
  global_enabled: true,
  default_wagering_multiplier: 5,
  default_expiry_days: 7,
  default_min_odds: 1.5,
  cashback: {
    schedule: 'weekly',
    payout_as: 'bonus',
    min_loss: 100,
    pct: 10,
    per_ticket: DEFAULT_PER_TICKET_CASHBACK,
  },
  deposit_match: { stack_with_promo: false },
};

const TABS = [
  { id: 'active', label: 'Active Bonuses' },
  { id: 'settings', label: 'Bonus Settings' },
  { id: 'freebets', label: 'Free Bets' },
];

export function BonusEngine() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState<'active' | 'settings' | 'freebets'>('active');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedType, setSelectedType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [search, setSearch] = useState('');
  const [rules, setRules] = useState<bonusesApi.BonusRule[]>([]);
  const [claims, setClaims] = useState<Record<string, bonusesApi.BonusAssignment[]>>({});
  const [loading, setLoading] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RuleFormState>(defaultRuleForm);
  const [manualAwardUser, setManualAwardUser] = useState('');
  const [settings, setSettings] = useState<bonusesApi.BonusSettings>(DEFAULT_BONUS_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [freebets, setFreebets] = useState<bonusesApi.FreeBetRow[]>([]);
  const [freebetsLoading, setFreebetsLoading] = useState(false);
  const [freebetForm, setFreebetForm] = useState({
    user_id: '',
    amount: 100,
    min_odds: 1.5,
    expires_in_days: 7,
    name: 'Manual Free Bet',
  });
  const [freebetSaving, setFreebetSaving] = useState(false);

  const load = async () => {
    if (!isAuth) return;
    setLoading(true);
    try {
      const result = await bonusesApi.listBonuses({
        page: 1,
        limit: 100,
        type: (selectedType || undefined) as bonusesApi.BonusRuleType | undefined,
        status:
          (selectedStatus || undefined) as bonusesApi.BonusRuleStatus | undefined,
        search: search || undefined,
      });
      setRules(result.items ?? []);
    } catch (err) {
      toast(`Failed to load bonuses: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [isAuth, selectedType, selectedStatus]);

  // Load settings when entering the Bonus Settings tab.
  useEffect(() => {
    if (!isAuth || activeTab !== 'settings') return;
    let cancelled = false;
    setSettingsLoading(true);
    bonusesApi
      .getBonusSettings()
      .then((res) => {
        if (cancelled) return;
        setSettings({ ...DEFAULT_BONUS_SETTINGS, ...res });
      })
      .catch((err) => toast(`Failed to load settings: ${(err as Error).message}`, 'error'))
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, activeTab]);

  // Load freebets when entering the Free Bets tab.
  const loadFreebets = async () => {
    setFreebetsLoading(true);
    try {
      const res = await bonusesApi.listFreeBets({ limit: 200 });
      setFreebets(res.items ?? []);
    } catch (err) {
      toast(`Failed to load free bets: ${(err as Error).message}`, 'error');
    } finally {
      setFreebetsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuth || activeTab !== 'freebets') return;
    void loadFreebets();
  }, [isAuth, activeTab]);

  const saveSettings = async () => {
    setSettingsSaving(true);
    try {
      const saved = await bonusesApi.updateBonusSettings(settings);
      setSettings({ ...DEFAULT_BONUS_SETTINGS, ...saved });
      toast('Bonus settings saved.');
    } catch (err) {
      toast(`Failed to save settings: ${(err as Error).message}`, 'error');
    } finally {
      setSettingsSaving(false);
    }
  };

  const awardFreebet = async () => {
    if (!freebetForm.user_id.trim()) {
      toast('Enter a user UUID to award a free bet.', 'error');
      return;
    }
    setFreebetSaving(true);
    try {
      await bonusesApi.awardFreeBets({
        user_id: freebetForm.user_id.trim(),
        amount: Number(freebetForm.amount),
        min_odds: Number(freebetForm.min_odds),
        expires_in_days: Number(freebetForm.expires_in_days),
        name: freebetForm.name,
      });
      toast('Free bet awarded.');
      setFreebetForm((s) => ({ ...s, user_id: '' }));
      await loadFreebets();
    } catch (err) {
      toast(`Failed to award free bet: ${(err as Error).message}`, 'error');
    } finally {
      setFreebetSaving(false);
    }
  };

  const bonusRows = useMemo<BonusRow[]>(
    () =>
      rules
        .filter((r) =>
          search
            ? r.name.toLowerCase().includes(search.toLowerCase())
            : true
        )
        .map((r) => {
          const cfg = r.config ?? {};
          return {
            id: r.id,
            name: r.name,
            type: r.type,
            status: r.status,
            active: r.is_active ? 'yes' : 'no',
            validFrom: r.valid_from ? new Date(r.valid_from).toLocaleString() : '—',
            validTo: r.valid_to ? new Date(r.valid_to).toLocaleString() : '—',
            estimatedAmount: amountFromConfig(cfg).toFixed(2),
            claims: claims[r.id]?.length ?? 0,
          };
        }),
    [rules, claims, search]
  );

  const claimRows = useMemo<ClaimRow[]>(
    () =>
      Object.values(claims)
        .flat()
        .map((c) => ({
          id: c.id,
          user: c.user_email ?? c.user_phone ?? c.user_id,
          amount: Number(c.awarded_amount).toFixed(2),
          status: c.status,
          wagering: Number(c.wagering_required).toFixed(2),
          progress: Number(c.wagering_progress).toFixed(2),
          awardedAt: new Date(c.awarded_at).toLocaleString(),
          expiresAt: c.expires_at ? new Date(c.expires_at).toLocaleString() : '—',
        })),
    [claims]
  );

  const fetchClaims = async (bonusId: string) => {
    try {
      const out = await bonusesApi.listBonusClaims(bonusId, { page: 1, limit: 200 });
      setClaims((prev) => ({ ...prev, [bonusId]: out.items ?? [] }));
      toast('Claims loaded.');
    } catch (err) {
      toast(`Failed to load claims: ${(err as Error).message}`, 'error');
    }
  };

  const patchStatus = async (
    bonusId: string,
    next: bonusesApi.BonusRuleStatus
  ) => {
    try {
      await bonusesApi.patchBonusStatus(bonusId, {
        status: next,
        is_active: next === 'active',
      });
      toast('Bonus status updated.');
      await load();
    } catch (err) {
      toast(`Status update failed: ${(err as Error).message}`, 'error');
    }
  };

  const createRule = async () => {
    const parsed = bonusRuleSchema.safeParse({
      name: form.name,
      type: form.type,
      match_pct: form.match_pct,
      free_bet_amount: form.free_bet_amount,
      cashback_pct: form.cashback_pct,
    });
    if (!parsed.success) {
      toast(parsed.error.issues[0]?.message ?? 'Invalid bonus form', 'error');
      return;
    }
    if (parsed.data.type === 'deposit' && (parsed.data.match_pct ?? 0) <= 0) {
      toast('Match percentage must be greater than 0.', 'error');
      return;
    }
    if (parsed.data.type === 'free_bet' && (parsed.data.free_bet_amount ?? 0) <= 0) {
      toast('Free bet amount must be greater than 0.', 'error');
      return;
    }
    if (parsed.data.type === 'cashback' && (parsed.data.cashback_pct ?? 0) <= 0) {
      toast('Cashback percentage must be greater than 0.', 'error');
      return;
    }

    setSaving(true);
    try {
      await bonusesApi.createBonus({
        name: form.name.trim(),
        type: form.type,
        status: form.status,
        is_active: form.status === 'active',
        valid_from: form.valid_from
          ? new Date(form.valid_from).toISOString()
          : null,
        valid_to: form.valid_to ? new Date(form.valid_to).toISOString() : null,
        priority: form.priority,
        config: buildConfig(form),
      });
      toast('Bonus created.');
      setIsCreateModalOpen(false);
      setForm(defaultRuleForm);
      await load();
    } catch (err) {
      toast(`Failed to create bonus: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const awardManual = async (bonusId: string) => {
    const userId = manualAwardUser.trim();
    if (!userId) {
      toast('Enter user UUID first.', 'error');
      return;
    }
    try {
      await bonusesApi.awardBonus(bonusId, { user_id: userId });
      toast('Bonus awarded manually.');
      await fetchClaims(bonusId);
    } catch (err) {
      toast(`Manual award failed: ${(err as Error).message}`, 'error');
    }
  };

  const bonusColumns = [
    { header: 'Name', accessor: 'name' as const },
    { header: 'Type', accessor: 'type' as const },
    { header: 'Status', accessor: 'status' as const },
    { header: 'Active', accessor: 'active' as const },
    { header: 'Valid From', accessor: 'validFrom' as const },
    { header: 'Valid To', accessor: 'validTo' as const },
    { header: 'Est. Amount', accessor: 'estimatedAmount' as const },
    { header: 'Claims', accessor: 'claims' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (id: string) => (
        <div className="flex gap-2">
          <button
            onClick={() => void fetchClaims(id)}
            className="text-blue-600 hover:text-blue-800"
          >
            claims
          </button>
          <button
            onClick={() => void patchStatus(id, 'active')}
            className="text-green-600 hover:text-green-800"
          >
            activate
          </button>
          <button
            onClick={() => void patchStatus(id, 'paused')}
            className="text-yellow-600 hover:text-yellow-800"
          >
            pause
          </button>
          <button
            onClick={() => void patchStatus(id, 'expired')}
            className="text-red-600 hover:text-red-800"
          >
            expire
          </button>
          <button
            onClick={() => void awardManual(id)}
            className="text-purple-600 hover:text-purple-800"
          >
            award
          </button>
        </div>
      ),
    },
  ];

  const claimColumns = [
    { header: 'User', accessor: 'user' as const },
    { header: 'Amount', accessor: 'amount' as const },
    { header: 'Status', accessor: 'status' as const },
    { header: 'Wagering', accessor: 'wagering' as const },
    { header: 'Progress', accessor: 'progress' as const },
    { header: 'Awarded At', accessor: 'awardedAt' as const },
    { header: 'Expires At', accessor: 'expiresAt' as const },
  ];

  const filters = [
    {
      label: 'Search',
      options: [],
      value: search,
      onChange: setSearch,
      type: 'text',
    },
    {
      label: 'Type',
      options: ['deposit', 'free_bet', 'cashback', 'signup', 'referral'],
      value: selectedType,
      onChange: setSelectedType,
    },
    {
      label: 'Status',
      options: ['active', 'paused', 'expired', 'disabled'],
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Gift className="h-8 w-8 text-purple-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Bonus Engine</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-purple-600 hover:bg-purple-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Bonus
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          icon={Gift}
          title="Total Bonus Rules"
          value={String(rules.length)}
        />
        <StatCard
          icon={Users}
          title="Total Claims Loaded"
          value={String(claimRows.length)}
        />
        <StatCard
          icon={DollarSign}
          title="Claimed Amount (loaded)"
          value={claimRows
            .reduce((acc, row) => acc + Number(row.amount), 0)
            .toFixed(2)}
        />
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-900 flex items-start">
        <Target className="h-4 w-4 mt-0.5 mr-2" />
        Enter a target user UUID below, then use an individual row&apos;s
        <span className="mx-1 font-semibold">award</span>
        action for manual bonus assignment.
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Manual Award User UUID</label>
        <input
          value={manualAwardUser}
          onChange={(e) => setManualAwardUser(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="mt-1 block w-full rounded-md border-gray-300"
        />
      </div>

      <TabGroup
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(t) => setActiveTab(t as 'active' | 'settings' | 'freebets')}
      />

      {activeTab === 'active' && (
        <>
          <FilterBar
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            filters={filters}
          />

          <div className="bg-white rounded-lg shadow">
            <DataTable columns={bonusColumns} data={bonusRows} />
            {loading && <div className="px-6 pb-6 text-sm text-gray-500">Loading bonuses…</div>}
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Bonus Claims</h2>
            </div>
            <DataTable columns={claimColumns} data={claimRows} />
          </div>
        </>
      )}

      {activeTab === 'settings' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <h2 className="text-lg font-medium text-gray-900">Bonus Settings</h2>
          {settingsLoading && (
            <div className="text-sm text-gray-500">Loading settings…</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.global_enabled}
                onChange={(e) => setSettings({ ...settings, global_enabled: e.target.checked })}
              />
              <span className="text-sm text-gray-700">Bonus engine globally enabled</span>
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700">Default Wagering Multiplier</label>
              <input
                type="number"
                value={settings.default_wagering_multiplier}
                onChange={(e) => setSettings({ ...settings, default_wagering_multiplier: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Default Expiry (days)</label>
              <input
                type="number"
                value={settings.default_expiry_days}
                onChange={(e) => setSettings({ ...settings, default_expiry_days: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Default Min Odds</label>
              <input
                type="number"
                step="0.05"
                value={settings.default_min_odds}
                onChange={(e) => setSettings({ ...settings, default_min_odds: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Cashback Schedule</label>
              <select
                value={settings.cashback.schedule}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    cashback: { ...settings.cashback, schedule: e.target.value as 'weekly' | 'monthly' },
                  })
                }
                className="mt-1 w-full rounded-md border-gray-300"
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Cashback Payout</label>
              <select
                value={settings.cashback.payout_as}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    cashback: { ...settings.cashback, payout_as: e.target.value as 'bonus' | 'cash' },
                  })
                }
                className="mt-1 w-full rounded-md border-gray-300"
              >
                <option value="bonus">Bonus (with wagering)</option>
                <option value="cash">Real Cash</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Cashback Min Loss (ETB)</label>
              <input
                type="number"
                value={settings.cashback.min_loss ?? 0}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    cashback: { ...settings.cashback, min_loss: Number(e.target.value) },
                  })
                }
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Cashback %</label>
              <input
                type="number"
                value={settings.cashback.pct ?? 0}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    cashback: { ...settings.cashback, pct: Number(e.target.value) },
                  })
                }
                className="mt-1 w-full rounded-md border-gray-300"
              />
            </div>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.deposit_match.stack_with_promo}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    deposit_match: { stack_with_promo: e.target.checked },
                  })
                }
              />
              <span className="text-sm text-gray-700">Allow deposit match to stack with other promos</span>
            </label>
          </div>

          <LossCashbackEditor
            value={settings.cashback.per_ticket ?? DEFAULT_PER_TICKET_CASHBACK}
            onChange={(next) =>
              setSettings({
                ...settings,
                cashback: { ...settings.cashback, per_ticket: next },
              })
            }
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={settingsSaving}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300"
            >
              <Save className="h-4 w-4 mr-2" />
              {settingsSaving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'freebets' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <h2 className="text-lg font-medium text-gray-900 flex items-center gap-2">
              <Ticket className="h-5 w-5 text-purple-600" />
              Award Free Bet
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">User UUID</label>
                <input
                  value={freebetForm.user_id}
                  onChange={(e) => setFreebetForm({ ...freebetForm, user_id: e.target.value })}
                  className="mt-1 w-full rounded-md border-gray-300"
                  placeholder="00000000-0000-0000-0000-000000000000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Amount (ETB)</label>
                <input
                  type="number"
                  value={freebetForm.amount}
                  onChange={(e) => setFreebetForm({ ...freebetForm, amount: Number(e.target.value) })}
                  className="mt-1 w-full rounded-md border-gray-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Min Odds</label>
                <input
                  type="number"
                  step="0.05"
                  value={freebetForm.min_odds}
                  onChange={(e) => setFreebetForm({ ...freebetForm, min_odds: Number(e.target.value) })}
                  className="mt-1 w-full rounded-md border-gray-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Expires In (days)</label>
                <input
                  type="number"
                  value={freebetForm.expires_in_days}
                  onChange={(e) => setFreebetForm({ ...freebetForm, expires_in_days: Number(e.target.value) })}
                  className="mt-1 w-full rounded-md border-gray-300"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Campaign Name</label>
                <input
                  value={freebetForm.name}
                  onChange={(e) => setFreebetForm({ ...freebetForm, name: e.target.value })}
                  className="mt-1 w-full rounded-md border-gray-300"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void awardFreebet()}
                  disabled={freebetSaving}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {freebetSaving ? 'Awarding…' : 'Award Free Bet'}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Free Bet Awards</h2>
              <button
                onClick={() => void loadFreebets()}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </button>
            </div>
            <DataTable
              columns={[
                { header: 'User', accessor: 'user' as const },
                { header: 'Bonus', accessor: 'bonus' as const },
                { header: 'Amount', accessor: 'amount' as const },
                { header: 'Status', accessor: 'status' as const },
                { header: 'Awarded', accessor: 'awarded' as const },
                { header: 'Expires', accessor: 'expires' as const },
              ]}
              data={freebets.map((f) => ({
                id: f.id,
                user: f.user_email ?? f.user_phone ?? f.user_id,
                bonus: f.bonus_name,
                amount: Number(f.awarded_amount).toFixed(2),
                status: f.status,
                awarded: new Date(f.awarded_at).toLocaleString(),
                expires: f.expires_at ? new Date(f.expires_at).toLocaleString() : '—',
              }))}
            />
            {freebetsLoading && (
              <div className="px-6 pb-6 text-sm text-gray-500">Loading free bets…</div>
            )}
          </div>
        </div>
      )}

      <CreateBonusModal
        isOpen={isCreateModalOpen}
        saving={saving}
        form={form}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={() => void createRule()}
      />
    </div>
  );
}
