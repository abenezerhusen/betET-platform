import React, { useEffect, useMemo, useState } from 'react';
import {
  Trophy,
  Save,
  AlertTriangle,
  Trash2,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { z } from 'zod';
import { toast } from '../../lib/toast';
import { DataTable } from '../../components/DataTable';
import { useAuthStore } from '../../store/auth';
import * as tournamentsApi from '../../lib/api/tournaments';

type RewardType = 'free_bet' | 'cash' | 'multiplier';

interface TierForm {
  enabled: boolean;
  streak_days: number;
  reward_type: RewardType;
  reward_amount: number;
  min_bet_daily: number;
}

const defaultTierForm: TierForm = {
  enabled: true,
  streak_days: 7,
  reward_type: 'free_bet',
  reward_amount: 100,
  min_bet_daily: 10,
};

const tierSchema = z.object({
  enabled: z.boolean(),
  streak_days: z.number().int().positive('Streak days must be greater than 0'),
  reward_type: z.enum(['free_bet', 'cash', 'multiplier']),
  reward_amount: z.number().min(0, 'Reward amount must be non-negative'),
  min_bet_daily: z.number().min(0, 'Minimum daily bet must be non-negative'),
});

interface GlobalForm {
  enabled: boolean;
  min_bet_amount: number;
  required_wins: number;
  reset_on_loss: boolean;
  reset_on_cancel: boolean;
  auto_notify: boolean;
}

const defaultGlobalForm: GlobalForm = {
  enabled: true,
  min_bet_amount: 50,
  required_wins: 0,
  reset_on_loss: false,
  reset_on_cancel: true,
  auto_notify: true,
};

export function StreakSettings() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [tiers, setTiers] = useState<tournamentsApi.StreakTier[]>([]);
  const [leaderboard, setLeaderboard] = useState<
    tournamentsApi.StreakLeaderboardRow[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [savingTier, setSavingTier] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [formError, setFormError] = useState('');
  const [tierForm, setTierForm] = useState<TierForm>(defaultTierForm);
  const [globalForm, setGlobalForm] = useState<GlobalForm>(defaultGlobalForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    if (!isAuth) return;
    setLoading(true);
    try {
      const [cfg, lb] = await Promise.all([
        tournamentsApi.getStreakConfig(),
        tournamentsApi.getStreakLeaderboard(),
      ]);
      setTiers(cfg.tiers ?? []);
      setGlobalForm({
        enabled: cfg.enabled ?? true,
        min_bet_amount: Number(cfg.min_bet_amount ?? 50),
        required_wins: Number(cfg.required_wins ?? 0),
        reset_on_loss: cfg.reset_on_loss ?? false,
        reset_on_cancel: cfg.reset_on_cancel ?? true,
        auto_notify: cfg.auto_notify ?? true,
      });
      setLeaderboard(lb.items ?? []);
    } catch (err) {
      toast(`Failed to load streak settings: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [isAuth]);

  const saveGlobal = async () => {
    if (savingGlobal) return;
    setSavingGlobal(true);
    try {
      await tournamentsApi.updateStreakConfig({
        enabled: globalForm.enabled,
        min_bet_amount: globalForm.min_bet_amount,
        required_wins: globalForm.required_wins,
        reset_on_loss: globalForm.reset_on_loss,
        reset_on_cancel: globalForm.reset_on_cancel,
        auto_notify: globalForm.auto_notify,
      });
      toast('Global streak settings saved.');
      await load();
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`, 'error');
    } finally {
      setSavingGlobal(false);
    }
  };

  const submitTier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingTier) return;
    const parsed = tierSchema.safeParse(tierForm);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid streak tier';
      setFormError(msg);
      toast(msg, 'error');
      return;
    }
    setFormError('');
    setSavingTier(true);
    try {
      const payload = parsed.data;
      if (editingId) {
        await tournamentsApi.updateStreakTier(editingId, payload);
        toast('Streak tier updated.');
      } else {
        await tournamentsApi.createStreakTier(payload);
        toast('Streak tier created.');
      }
      setTierForm(defaultTierForm);
      setEditingId(null);
      await load();
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`, 'error');
    } finally {
      setSavingTier(false);
    }
  };

  const removeTier = async (id: string) => {
    if (!window.confirm('Delete this streak tier?')) return;
    try {
      await tournamentsApi.deleteStreakTier(id);
      toast('Streak tier removed.');
      if (editingId === id) {
        setEditingId(null);
        setTierForm(defaultTierForm);
      }
      await load();
    } catch (err) {
      toast(`Delete failed: ${(err as Error).message}`, 'error');
    }
  };

  const startEdit = (tier: tournamentsApi.StreakTier) => {
    if (!tier.id) return;
    setEditingId(tier.id);
    setTierForm({
      enabled: tier.enabled,
      streak_days: tier.streak_days,
      reward_type: tier.reward_type,
      reward_amount: Number(tier.reward_amount),
      min_bet_daily: Number(tier.min_bet_daily),
    });
  };

  const tierRows = useMemo(
    () =>
      tiers.map((t) => ({
        id: t.id ?? '',
        enabled: t.enabled ? 'yes' : 'no',
        streakDays: t.streak_days,
        rewardType: t.reward_type,
        rewardAmount: Number(t.reward_amount).toFixed(2),
        minBetDaily: Number(t.min_bet_daily).toFixed(2),
      })),
    [tiers]
  );

  const leaderboardRows = useMemo(
    () =>
      leaderboard.map((r) => ({
        user: r.user_email ?? r.user_phone ?? r.user_id,
        currentStreak: r.current_streak,
        longestStreak: r.longest_streak,
        bonusEarned: Number(r.streak_bonus_earned).toFixed(2),
        lastBet: r.last_bet_date ?? '—',
      })),
    [leaderboard]
  );

  const tierColumns = [
    { header: 'Enabled', accessor: 'enabled' as const },
    { header: 'Days', accessor: 'streakDays' as const },
    { header: 'Reward Type', accessor: 'rewardType' as const },
    { header: 'Reward Amount', accessor: 'rewardAmount' as const },
    { header: 'Min Bet Daily', accessor: 'minBetDaily' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (id: string) => {
        const tier = tiers.find((t) => t.id === id);
        if (!tier) return null;
        return (
          <div className="flex items-center gap-3">
            <button
              onClick={() => startEdit(tier)}
              className="text-blue-600 hover:text-blue-800"
            >
              edit
            </button>
            <button
              onClick={() => void removeTier(id)}
              className="text-red-600 hover:text-red-800"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      },
    },
  ];

  const leaderboardColumns = [
    { header: 'User', accessor: 'user' as const },
    { header: 'Current Streak', accessor: 'currentStreak' as const },
    { header: 'Longest Streak', accessor: 'longestStreak' as const },
    { header: 'Bonus Earned', accessor: 'bonusEarned' as const },
    { header: 'Last Bet', accessor: 'lastBet' as const },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Trophy className="h-8 w-8 text-yellow-500" />
          <h1 className="text-2xl font-semibold text-gray-900">Streak Settings</h1>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </button>
      </div>

      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
        <div className="flex">
          <AlertTriangle className="h-5 w-5 text-yellow-400" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-yellow-800">How streaks work</h3>
            <div className="mt-2 text-sm text-yellow-700">
              <p>
                Each day a user places a qualifying bet (≥ Min Bet Amount), their
                streak grows by 1. Tiers below auto-award the matching reward when
                the user hits the streak length. Reset rules apply on loss / cancel
                if you enable them.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Global streak settings (Section 12 spec) ------------------------- */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Global Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Enabled</label>
            <select
              value={String(globalForm.enabled)}
              onChange={(e) =>
                setGlobalForm((p) => ({ ...p, enabled: e.target.value === 'true' }))
              }
              className="mt-1 block w-full rounded-md border-gray-300"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Min Bet Amount per day (ETB)
            </label>
            <input
              type="number"
              value={globalForm.min_bet_amount}
              onChange={(e) =>
                setGlobalForm((p) => ({ ...p, min_bet_amount: Number(e.target.value) }))
              }
              className="mt-1 block w-full rounded-md border-gray-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Required Wins (0 = placing is enough)
            </label>
            <input
              type="number"
              value={globalForm.required_wins}
              onChange={(e) =>
                setGlobalForm((p) => ({ ...p, required_wins: Number(e.target.value) }))
              }
              className="mt-1 block w-full rounded-md border-gray-300"
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              checked={globalForm.reset_on_loss}
              onChange={(e) =>
                setGlobalForm((p) => ({ ...p, reset_on_loss: e.target.checked }))
              }
              id="reset_on_loss"
            />
            <label htmlFor="reset_on_loss" className="text-sm">
              Reset streak on bet loss
            </label>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              checked={globalForm.reset_on_cancel}
              onChange={(e) =>
                setGlobalForm((p) => ({ ...p, reset_on_cancel: e.target.checked }))
              }
              id="reset_on_cancel"
            />
            <label htmlFor="reset_on_cancel" className="text-sm">
              Reset streak on bet cancel
            </label>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              checked={globalForm.auto_notify}
              onChange={(e) =>
                setGlobalForm((p) => ({ ...p, auto_notify: e.target.checked }))
              }
              id="auto_notify"
            />
            <label htmlFor="auto_notify" className="text-sm">
              Auto-notify on milestone reached
            </label>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={() => void saveGlobal()}
            disabled={savingGlobal}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300"
          >
            <Save className="h-4 w-4 mr-2" />
            {savingGlobal ? 'Saving…' : 'Save Global Settings'}
          </button>
        </div>
      </div>

      {/* Tier editor ------------------------------------------------------- */}
      <form onSubmit={submitTier} className="space-y-4 bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-medium text-gray-900">
          {editingId ? 'Edit Tier' : 'Add Reward Tier'}
        </h2>
        {formError && (
          <div className="p-2 text-sm rounded border border-red-200 bg-red-50 text-red-700">
            {formError}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Enabled</label>
            <select
              value={String(tierForm.enabled)}
              onChange={(e) =>
                setTierForm((p) => ({ ...p, enabled: e.target.value === 'true' }))
              }
              className="mt-1 block w-full rounded-md border-gray-300"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Streak Days</label>
            <input
              type="number"
              value={tierForm.streak_days}
              onChange={(e) =>
                setTierForm((p) => ({ ...p, streak_days: Number(e.target.value) }))
              }
              className="mt-1 block w-full rounded-md border-gray-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Reward Type</label>
            <select
              value={tierForm.reward_type}
              onChange={(e) =>
                setTierForm((p) => ({ ...p, reward_type: e.target.value as RewardType }))
              }
              className="mt-1 block w-full rounded-md border-gray-300"
            >
              <option value="free_bet">free_bet</option>
              <option value="cash">cash</option>
              <option value="multiplier">multiplier</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Reward Amount</label>
            <input
              type="number"
              value={tierForm.reward_amount}
              onChange={(e) =>
                setTierForm((p) => ({ ...p, reward_amount: Number(e.target.value) }))
              }
              className="mt-1 block w-full rounded-md border-gray-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Min Bet Daily</label>
            <input
              type="number"
              value={tierForm.min_bet_daily}
              onChange={(e) =>
                setTierForm((p) => ({ ...p, min_bet_daily: Number(e.target.value) }))
              }
              className="mt-1 block w-full rounded-md border-gray-300"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setTierForm(defaultTierForm);
              }}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm"
            >
              Cancel Edit
            </button>
          )}
          <button
            type="submit"
            disabled={savingTier}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300"
          >
            {editingId ? <Save className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            {savingTier ? 'Saving...' : editingId ? 'Update Tier' : 'Create Tier'}
          </button>
        </div>
      </form>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Streak Reward Tiers</h2>
        </div>
        <DataTable columns={tierColumns} data={tierRows} />
        {loading && <div className="px-6 pb-6 text-sm text-gray-500">Loading streak tiers…</div>}
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Streak Leaderboard</h2>
        </div>
        <DataTable columns={leaderboardColumns} data={leaderboardRows} />
      </div>
    </div>
  );
}
