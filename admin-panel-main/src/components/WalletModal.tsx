import { useEffect, useMemo, useState } from 'react';
import { X, DollarSign, ArrowUpDown, Clock, FileText } from 'lucide-react';
import { z } from 'zod';
import { downloadCsv, todayStamp } from '../lib/csv';
import { toast } from '../lib/toast';
import * as walletsApi from '../lib/api/wallets';
import * as usersApi from '../lib/api/users';
import { ApiError } from '../lib/api/client';
import type { Wallet as WalletRow } from '../lib/api/types';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  memberData?: {
    userId: string;
    name: string;
    balance: number;
    bonus: number;
    won: number;
  };
  /** Called whenever a credit/debit succeeds so the parent can reload. */
  onSuccess?: () => void;
}

interface TransactionRow {
  id: string;
  type: string;
  amount: number;
  status: string;
  date: string;
  description: string;
}

const walletOperationSchema = z.object({
  amount: z.number().positive('Amount must be greater than zero').max(1_000_000),
  description: z.string().trim().min(2, 'Description is required').max(200),
});

export function WalletModal({ isOpen, onClose, memberData, onSuccess }: WalletModalProps) {
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const loadWalletAndTx = async () => {
    if (!memberData?.userId) return;
    setWalletLoading(true);
    try {
      const [walletList, activity] = await Promise.all([
        walletsApi.listWallets({ user_id: memberData.userId, limit: 1 }),
        usersApi.userActivity(memberData.userId, {
          type: 'transactions',
          limit: 50,
          page: 1,
        }),
      ]);
      const w = walletList.items[0] ?? null;
      setWallet(w);

      setTransactions(
        activity.items.map((t) => {
          const details = (t.details ?? {}) as Record<string, unknown>;
          const meta = (details.metadata ?? {}) as Record<string, unknown>;
          return {
            id: t.id,
            type: String(details.tx_type ?? t.type),
            amount: Number(t.amount),
            status: t.status,
            date: new Date(t.created_at).toLocaleString(),
            description:
              (meta.reason as string | undefined) ??
              (details.reference as string | null | undefined) ??
              String(details.tx_type ?? t.type),
          };
        })
      );
    } catch (err) {
      setTransactions([]);
      setWallet(null);
      const msg =
        err instanceof ApiError ? err.message : String((err as Error)?.message ?? err);
      toast(`Failed to load wallet: ${msg}`, 'error');
    } finally {
      setWalletLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !memberData) return;
    void loadWalletAndTx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, memberData?.userId, refreshTick]);

  const balance = useMemo(
    () => Number(wallet?.balance ?? memberData?.balance ?? 0),
    [wallet?.balance, memberData?.balance]
  );
  const bonus = useMemo(
    () => Number(wallet?.bonus_balance ?? memberData?.bonus ?? 0),
    [wallet?.bonus_balance, memberData?.bonus]
  );
  const won = memberData?.won ?? 0;

  if (!isOpen || !memberData) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!wallet) {
      setError('No wallet found for this user. Please contact support.');
      return;
    }

    const parsed = walletOperationSchema.safeParse({
      amount: Number(amount),
      description,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid wallet operation');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        amount: parsed.data.amount.toFixed(2),
        reason: parsed.data.description,
      };
      if (activeTab === 'deposit') {
        await walletsApi.creditWallet(wallet.id, payload);
        toast(`Deposited $${parsed.data.amount.toFixed(2)} to ${memberData.name}.`);
      } else {
        await walletsApi.debitWallet(wallet.id, payload);
        toast(`Withdrew $${parsed.data.amount.toFixed(2)} from ${memberData.name}.`);
      }
      setAmount('');
      setDescription('');
      setRefreshTick((n) => n + 1);
      onSuccess?.();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : String((err as Error)?.message ?? err);
      setError(msg);
      toast(`Wallet operation failed: ${msg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 w-[800px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Wallet Management - {memberData.name}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-600">Available Balance</p>
                <p className="text-2xl font-semibold text-blue-900">${balance.toFixed(2)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-blue-500" />
            </div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-green-600">Bonus Balance</p>
                <p className="text-2xl font-semibold text-green-900">${bonus.toFixed(2)}</p>
              </div>
              <ArrowUpDown className="h-8 w-8 text-green-500" />
            </div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-purple-600">Total Won</p>
                <p className="text-2xl font-semibold text-purple-900">${won.toFixed(2)}</p>
              </div>
              <Clock className="h-8 w-8 text-purple-500" />
            </div>
          </div>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg mb-6">
          <div className="flex space-x-4 mb-4">
            <button
              onClick={() => setActiveTab('deposit')}
              className={`flex-1 py-2 px-4 rounded-md ${
                activeTab === 'deposit'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300'
              }`}
            >
              Deposit
            </button>
            <button
              onClick={() => setActiveTab('withdraw')}
              className={`flex-1 py-2 px-4 rounded-md ${
                activeTab === 'withdraw'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300'
              }`}
            >
              Withdraw
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!wallet && !walletLoading && (
              <p className="text-sm text-amber-700 bg-amber-50 p-2 rounded">
                No wallet exists yet for this member.
              </p>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700">Amount</label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-500 sm:text-sm">$</span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="focus:ring-blue-500 focus:border-blue-500 block w-full pl-7 pr-12 sm:text-sm border-gray-300 rounded-md"
                  placeholder="0.00"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting || walletLoading || !wallet}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-60"
            >
              {submitting
                ? 'Processing…'
                : `Process ${activeTab === 'deposit' ? 'Deposit' : 'Withdrawal'}`}
            </button>
          </form>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">Transaction History</h3>
            <button
              type="button"
              onClick={() => {
                if (!transactions || transactions.length === 0) {
                  toast('No transactions to export.', 'error');
                  return;
                }
                downloadCsv(
                  [
                    { header: 'ID', accessor: 'id' as const },
                    { header: 'Date', accessor: 'date' as const },
                    { header: 'Type', accessor: 'type' as const },
                    { header: 'Amount', accessor: 'amount' as const },
                    { header: 'Status', accessor: 'status' as const },
                  ],
                  transactions,
                  `wallet-transactions-${todayStamp()}`,
                );
                toast(`Exported ${transactions.length} transactions.`);
              }}
              className="flex items-center text-sm text-blue-600 hover:text-blue-800"
            >
              <FileText className="h-4 w-4 mr-1" />
              Export
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-6 text-center text-sm text-gray-500">
                      {walletLoading ? 'Loading transactions…' : 'No transactions yet.'}
                    </td>
                  </tr>
                ) : (
                  transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {transaction.date}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {transaction.type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span
                          className={
                            transaction.amount >= 0 ? 'text-green-600' : 'text-red-600'
                          }
                        >
                          ${Math.abs(transaction.amount).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {transaction.description}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            transaction.status === 'completed' ||
                            transaction.status === 'Completed'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {transaction.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
