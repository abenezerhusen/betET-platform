import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import type { AdminRaffle } from '../lib/api/promotions';

interface PrizeInput {
  rank: number;
  name: string;
  amount: number;
}

export interface RaffleFormData {
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  min_deposit: number;
  prize_pool: number;
  currency: string;
  max_tickets: number | null;
  draw_mode: 'auto' | 'manual';
  notify_winners: boolean;
  prizes: PrizeInput[];
  status: AdminRaffle['status'];
}

interface CreateRaffleModalProps {
  isOpen: boolean;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (data: RaffleFormData) => void;
}

const raffleSchema = z.object({
  name: z.string().trim().min(1, 'Raffle name is required').max(160),
  end_date: z.string().trim().min(1, 'End date (draw date) is required'),
  prize_pool: z.number().nonnegative('Prize pool must be 0 or more'),
  min_deposit: z.number().nonnegative(),
});

function defaultForm(): RaffleFormData {
  const now = new Date();
  const draw = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const toLocal = (d: Date) => {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60 * 1000).toISOString().slice(0, 16);
  };
  return {
    name: '',
    description: '',
    start_date: toLocal(now),
    end_date: toLocal(draw),
    min_deposit: 0,
    prize_pool: 0,
    currency: 'ETB',
    max_tickets: null,
    draw_mode: 'auto',
    notify_winners: true,
    prizes: [],
    status: 'Active',
  };
}

export function CreateRaffleModal({ isOpen, saving, onClose, onSubmit }: CreateRaffleModalProps) {
  const [form, setForm] = useState<RaffleFormData>(defaultForm);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const patch = (p: Partial<RaffleFormData>) => setForm((prev) => ({ ...prev, ...p }));

  const addPrize = () =>
    setForm((prev) => ({
      ...prev,
      prizes: [...prev.prizes, { rank: prev.prizes.length + 1, name: '', amount: 0 }],
    }));

  const updatePrize = (idx: number, p: Partial<PrizeInput>) =>
    setForm((prev) => ({
      ...prev,
      prizes: prev.prizes.map((row, i) => (i === idx ? { ...row, ...p } : row)),
    }));

  const removePrize = (idx: number) =>
    setForm((prev) => ({
      ...prev,
      prizes: prev.prizes.filter((_, i) => i !== idx),
    }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = raffleSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid raffle data');
      return;
    }
    if (form.prizes.some((p) => !p.name.trim())) {
      setError('Each prize must have a name.');
      return;
    }
    setError('');
    onSubmit({
      ...form,
      // Normalize prizes: drop empty rows, re-number ranks sequentially.
      prizes: form.prizes
        .filter((p) => p.name.trim())
        .map((p, i) => ({ rank: i + 1, name: p.name.trim(), amount: Number(p.amount) || 0 })),
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl">
        <div className="flex justify-between items-center p-6 pb-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold">Create Raffle</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto p-6 space-y-5 flex-1">
            {error && (
              <div className="p-2 text-sm rounded border border-red-200 bg-red-50 text-red-700">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700">Raffle Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500"
                placeholder="e.g. Weekend Mega Draw"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Description</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700">Start Date</label>
                <input
                  type="datetime-local"
                  value={form.start_date}
                  onChange={(e) => patch({ start_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">End / Draw Date</label>
                <input
                  type="datetime-local"
                  value={form.end_date}
                  onChange={(e) => patch({ end_date: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700">Min Deposit to Qualify</label>
                <input
                  type="number"
                  min={0}
                  value={form.min_deposit}
                  onChange={(e) => patch({ min_deposit: Number(e.target.value) })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Prize Pool</label>
                <input
                  type="number"
                  min={0}
                  value={form.prize_pool}
                  onChange={(e) => patch({ prize_pool: Number(e.target.value) })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700">Currency</label>
                <input
                  type="text"
                  value={form.currency}
                  onChange={(e) => patch({ currency: e.target.value.toUpperCase() })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500"
                  maxLength={8}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Max Tickets</label>
                <input
                  type="number"
                  min={1}
                  value={form.max_tickets ?? ''}
                  onChange={(e) =>
                    patch({ max_tickets: e.target.value ? Number(e.target.value) : null })
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500"
                  placeholder="Unlimited"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Draw Mode</label>
                <select
                  value={form.draw_mode}
                  onChange={(e) => patch({ draw_mode: e.target.value as 'auto' | 'manual' })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500"
                >
                  <option value="auto">Auto</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => patch({ status: e.target.value as AdminRaffle['status'] })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500"
                >
                  <option value="Active">Active</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>
              <label className="flex items-center gap-3 mt-6">
                <input
                  type="checkbox"
                  checked={form.notify_winners}
                  onChange={(e) => patch({ notify_winners: e.target.checked })}
                />
                <span className="text-sm text-gray-700">Notify winners automatically</span>
              </label>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Prizes (optional)</label>
                <button
                  type="button"
                  onClick={addPrize}
                  className="inline-flex items-center text-sm text-red-600 hover:text-red-800"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add prize
                </button>
              </div>
              {form.prizes.length === 0 && (
                <p className="text-xs text-gray-400">
                  No prize tiers set — the full prize pool goes to the drawn winner.
                </p>
              )}
              <div className="space-y-2">
                {form.prizes.map((prize, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-10">#{idx + 1}</span>
                    <input
                      type="text"
                      value={prize.name}
                      onChange={(e) => updatePrize(idx, { name: e.target.value })}
                      placeholder="Prize name"
                      className="flex-1 rounded-md border-gray-300 text-sm focus:border-red-500 focus:ring-red-500"
                    />
                    <input
                      type="number"
                      min={0}
                      value={prize.amount}
                      onChange={(e) => updatePrize(idx, { amount: Number(e.target.value) })}
                      placeholder="Amount"
                      className="w-28 rounded-md border-gray-300 text-sm focus:border-red-500 focus:ring-red-500"
                    />
                    <button
                      type="button"
                      onClick={() => removePrize(idx)}
                      aria-label="Remove prize"
                      className="text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3 p-6 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-300"
            >
              {saving ? 'Creating…' : 'Create Raffle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
