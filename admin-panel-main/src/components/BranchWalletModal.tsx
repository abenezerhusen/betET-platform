import React, { useState } from 'react';
import { X, DollarSign, Clock, FileText, Plus, Minus, Settings, Percent } from 'lucide-react';
import { z } from 'zod';
import { toast } from '../lib/toast';

interface BranchWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
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
      minimumStake: number;
    };
    status: string;
  };
}

interface CashbackRule {
  id: string;
  name: string;
  description: string;
  percentage: number;
  condition: string;
  status: string;
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

const cashbackRuleSchema = z.object({
  name: z.string().trim().min(2, 'Rule name is required'),
  description: z.string().trim().min(2, 'Description is required'),
  percentage: z.number().min(0).max(100),
  condition: z.string().trim().min(2, 'Condition is required'),
});

export function BranchWalletModal({ isOpen, onClose, branchData }: BranchWalletModalProps) {
  const cashbackRules: CashbackRule[] = [];
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [activeTab, setActiveTab] = useState<'deposit' | 'settings' | 'cashback'>('deposit');
  const [operatingHours, setOperatingHours] = useState(branchData?.operatingHours || { start: '09:00', end: '17:00' });
  const [limits, setLimits] = useState(branchData?.limits || {
    duplicateBetStake: 1000,
    deposit: 5000,
    offlineBet: 2000,
    minimumStake: 10,
  });
  const [branchStatus, setBranchStatus] = useState(branchData?.status || 'Active');
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [newRule, setNewRule] = useState({
    name: '',
    description: '',
    percentage: 0,
    condition: '',
  });
  const [error, setError] = useState('');

  if (!isOpen || !branchData) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = branchWalletOpSchema.safeParse({
      amount: Number(amount),
      reason,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid branch wallet operation');
      return;
    }
    setError('');
    console.log('Processing deposit:', parsed.data);
    toast(amount ? `Deposit of ${amount} processed.` : 'Deposit processed.');
    setAmount('');
    setReason('');
  };

  const handleSaveSettings = () => {
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
    console.log('Saving settings:', {
      operatingHours,
      limits,
      branchStatus,
    });
    toast('Branch settings saved.');
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = cashbackRuleSchema.safeParse(newRule);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid cashback rule';
      setError(msg);
      return;
    }
    setError('');
    console.log('Adding new cashback rule:', parsed.data);
    toast('Cashback rule added.');
    setIsAddingRule(false);
    setNewRule({
      name: '',
      description: '',
      percentage: 0,
      condition: '',
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 w-[800px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Branch Management - {branchData.name}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
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

        {/* Wallet Tab */}
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

            <form onSubmit={handleSubmit} className="space-y-4">
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
                  className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Money
                </button>
                <button
                  type="button"
                  className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
                >
                  <Minus className="h-4 w-4 mr-2" />
                  Withdraw
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
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
                    onClick={handleSaveSettings}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Save Settings
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cashback Rules Tab */}
        {activeTab === 'cashback' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-medium text-gray-900">Cashback Rules</h3>
              <button
                onClick={() => setIsAddingRule(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Rule
              </button>
            </div>

            {isAddingRule ? (
              <form onSubmit={handleAddRule} className="bg-gray-50 p-4 rounded-lg space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Rule Name</label>
                  <input
                    type="text"
                    value={newRule.name}
                    onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Description</label>
                  <input
                    type="text"
                    value={newRule.description}
                    onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Percentage</label>
                  <input
                    type="number"
                    value={newRule.percentage}
                    onChange={(e) => setNewRule({ ...newRule, percentage: Number(e.target.value) })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Condition</label>
                  <input
                    type="text"
                    value={newRule.condition}
                    onChange={(e) => setNewRule({ ...newRule, condition: e.target.value })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setIsAddingRule(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Add Rule
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                {cashbackRules.map((rule) => (
                  <div key={rule.id} className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 bg-purple-100 rounded-lg">
                          <Percent className="h-5 w-5 text-purple-600" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">{rule.name}</h4>
                          <p className="text-sm text-gray-500">{rule.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <span className="text-sm font-medium text-purple-600">{rule.percentage}%</span>
                        <button
                          type="button"
                          aria-label={`Configure ${rule.name}`}
                          title={`Configure ${rule.name}`}
                          onClick={() => toast(`Opening settings for ${rule.name}…`, 'info')}
                          className="text-gray-400 hover:text-gray-500"
                        >
                          <Settings className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-gray-500">{rule.condition}</span>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        rule.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {rule.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
