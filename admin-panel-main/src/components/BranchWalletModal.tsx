import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  DollarSign,
  Clock,
  Plus,
  Minus,
  Settings,
  Percent,
} from 'lucide-react';
import { z } from 'zod';
import { toast } from '../lib/toast';
import * as walletsApi from '../lib/api/wallets';
import * as usersApi from '../lib/api/users';

interface BranchWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  branchId?: string;
  branchData?: {
    name: string;
    balance: number;
    operatingHours: {
      start: string;
      end: string;
    };
    limits: {
      duplicateBetStake: number;
      deposit: number;
      offlineBet: number;
      minimumStake?: number;
    };
    status: string;
  };
  onSuccess?: () => void;
}

const branchWalletOpSchema = z.object({
  amount: z.number().positive('Amount must be greater than zero').max(1_000_000),
  reason: z.string().trim().min(2, 'Reason is required').max(200),
});

const branchSettingsSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid start time'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid end time'),
  minimumStake: z.number().min(0),
  duplicateBetStake: z.number().min(0),
  deposit: z.number().min(0),
  offlineBet: z.number().min(0),
});

export function BranchWalletModal({
  isOpen,
  onClose,
  branchId,
  branchData,
  onSuccess,
}: BranchWalletModalProps) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [activeTab, setActiveTab] = useState<'deposit' | 'settings' | 'cashback'>('deposit');
  const initialHours = useMemo(
    () => branchData?.operatingHours ?? { start: '09:00', end: '17:00' },
    [branchData?.operatingHours]
  );
  const initialLimits = useMemo(
    () => ({
      duplicateBetStake: branchData?.limits?.duplicateBetStake ?? 1000,
      deposit: branchData?.limits?.deposit ?? 5000,
      offlineBet: branchData?.limits?.offlineBet ?? 2000,
      minimumStake: branchData?.limits?.minimumStake ?? 10,
    }),
    [branchData?.limits]
  );
  const [operatingHours, setOperatingHours] = useState(initialHours);
  const [limits, setLimits] = useState(initialLimits);
  const [branchStatus, setBranchStatus] = useState(branchData?.status || 'Active');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setOperatingHours(initialHours);
      setLimits(initialLimits);
      setBranchStatus(branchData?.status || 'Active');
      setError('');
      setAmount('');
      setReason('');
    }
  }, [isOpen, initialHours, initialLimits, branchData?.status]);

  if (!isOpen || !branchData) return null;

  const requireBranchId = (): string | null => {
    if (!branchId) {
      setError('Branch identifier is missing.');
      return null;
    }
    return branchId;
  };

  const submitWalletOp = async (op: 'credit' | 'debit') => {
    const id = requireBranchId();
    if (!id) return;
    const parsed = branchWalletOpSchema.safeParse({
      amount: Number(amount),
      reason,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid branch wallet operation';
      setError(msg);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const payload: walletsApi.AdjustWalletInput = {
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        metadata: {
          source: 'branch_wallet_modal',
          branch_id: branchData.name,
          target: 'branch_prepaid_wallet',
        },
      };
      if (op === 'credit') {
        await walletsApi.creditWallet(id, payload);
        toast(`Branch credited with ${parsed.data.amount}.`);
      } else {
        await walletsApi.debitWallet(id, payload);
        toast(`Branch debited by ${parsed.data.amount}.`);
      }
      setAmount('');
      setReason('');
      onSuccess?.();
    } catch (err) {
      toast(`Failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitWalletOp('credit');
  };

  const handleWithdraw = () => {
    void submitWalletOp('debit');
  };

  const handleSaveSettings = async () => {
    const id = requireBranchId();
    if (!id) return;
    const parsed = branchSettingsSchema.safeParse({
      start: operatingHours.start,
      end: operatingHours.end,
      minimumStake: limits.minimumStake,
      duplicateBetStake: limits.duplicateBetStake,
      deposit: limits.deposit,
      offlineBet: limits.offlineBet,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid branch settings';
      setError(msg);
      toast(msg, 'error');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await usersApi.updateUser(id, {
        status: branchStatus.toLowerCase() === 'active' ? 'active' : 'suspended',
        metadata: {
          operating_hours: {
            start: parsed.data.start,
            end: parsed.data.end,
          },
          limits: {
            offline_bet: parsed.data.offlineBet,
            deposit: parsed.data.deposit,
            duplicate_bet: parsed.data.duplicateBetStake,
          },
          min_stake: parsed.data.minimumStake,
        },
      } as usersApi.UpdateUserInput);
      toast('Branch settings saved.');
      onSuccess?.();
    } catch (err) {
      toast(`Failed to save settings: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-[800px] mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Branch Management - {branchData.name}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex space-x-4 mb-6">
          <button
            onClick={() => setActiveTab('deposit')}
            className={`px-4 py-2 rounded-md ${
              activeTab === 'deposit'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            Wallet
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 rounded-md ${
              activeTab === 'settings'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            Settings
          </button>
          <button
            onClick={() => setActiveTab('cashback')}
            className={`px-4 py-2 rounded-md ${
              activeTab === 'cashback'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            Cashback Rules
          </button>
        </div>

        {activeTab === 'deposit' && (
          <div className="space-y-6">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-blue-600">Available Balance</p>
                    <p className="text-2xl font-semibold text-blue-900">${branchData.balance}</p>
                  </div>
                  <DollarSign className="h-8 w-8 text-blue-500" />
                </div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-green-600">Operating Hours</p>
                    <p className="text-xl font-semibold text-green-900">
                      {branchData.operatingHours.start} - {branchData.operatingHours.end}
                    </p>
                  </div>
                  <Clock className="h-8 w-8 text-green-500" />
                </div>
              </div>
            </div>

            <form onSubmit={handleDeposit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Amount</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-gray-500 sm:text-sm">$</span>
                  </div>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="focus:ring-blue-500 focus:border-blue-500 block w-full pl-7 pr-12 sm:text-sm border-gray-300 rounded-md"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Reason</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                  required
                />
              </div>

              <div className="flex space-x-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {submitting ? 'Processing…' : 'Add Money'}
                </button>
                <button
                  type="button"
                  onClick={handleWithdraw}
                  disabled={submitting}
                  className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                >
                  <Minus className="h-4 w-4 mr-2" />
                  {submitting ? 'Processing…' : 'Withdraw'}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Branch Settings</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Operating Hours</label>
                  <div className="grid grid-cols-2 gap-4 mt-1">
                    <div>
                      <label className="block text-xs text-gray-500">Start Time</label>
                      <input
                        type="time"
                        value={operatingHours.start}
                        onChange={(e) => setOperatingHours({ ...operatingHours, start: e.target.value })}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500">End Time</label>
                      <input
                        type="time"
                        value={operatingHours.end}
                        onChange={(e) => setOperatingHours({ ...operatingHours, end: e.target.value })}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Branch Status</label>
                  <div className="mt-1">
                    <label className="inline-flex items-center">
                      <input
                        type="checkbox"
                        checked={branchStatus === 'Active'}
                        onChange={(e) => setBranchStatus(e.target.checked ? 'Active' : 'Inactive')}
                        className="form-checkbox h-4 w-4 text-blue-600"
                      />
                      <span className="ml-2 text-sm text-gray-700">Branch is active</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Betting Limits</label>
                  <div className="space-y-3 mt-2">
                    <div>
                      <label className="block text-xs text-gray-500">Minimum Stake</label>
                      <input
                        type="number"
                        value={limits.minimumStake}
                        onChange={(e) => setLimits({ ...limits, minimumStake: Number(e.target.value) })}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500">Duplicate Bet Stake Limit</label>
                      <input
                        type="number"
                        value={limits.duplicateBetStake}
                        onChange={(e) => setLimits({ ...limits, duplicateBetStake: Number(e.target.value) })}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500">Deposit Limit</label>
                      <input
                        type="number"
                        value={limits.deposit}
                        onChange={(e) => setLimits({ ...limits, deposit: Number(e.target.value) })}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500">Offline Bet Limit</label>
                      <input
                        type="number"
                        value={limits.offlineBet}
                        onChange={(e) => setLimits({ ...limits, offlineBet: Number(e.target.value) })}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => void handleSaveSettings()}
                    disabled={submitting}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    {submitting ? 'Saving…' : 'Save Settings'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'cashback' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Percent className="h-5 w-5 text-purple-600" />
              <h3 className="text-lg font-medium text-gray-900">Cashback Rules</h3>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-800">
              Cashback rules are now managed globally under{' '}
              <span className="font-medium">Settings → Bonus Settings → Cashback</span>.
              Configure schedule (weekly/monthly), payout type and minimum loss
              there; the cashback worker will apply them to every branch's
              eligible users automatically.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
