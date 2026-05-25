import React, { useState } from 'react';
import { X, DollarSign, ArrowUpDown, Clock, FileText, Plus, Minus } from 'lucide-react';
import { z } from 'zod';
import { downloadCsv, todayStamp } from '../lib/csv';
import { toast } from '../lib/toast';

interface AgentWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentData?: {
    name: string;
    balance: number;
    branch: string;
  };
}

interface Transaction {
  id: string;
  amount: number;
  reason: string;
  reference: string;
  remark: string;
  paymentMethod: string;
  addedBy: string;
  status: string;
  type: string;
  date: string;
}

const agentWalletOperationSchema = z.object({
  amount: z.number().positive('Amount must be greater than zero').max(1_000_000),
  reason: z.string().trim().min(2, 'Reason is required').max(200),
  remark: z.string().trim().max(300).optional(),
  paymentMethod: z.enum(['bank_transfer', 'cash', 'mobile_money']),
  depositPlan: z.enum(['prepaid', 'postpaid']),
  retailPlan: z.enum(['prepaid', 'postpaid']),
});

export function AgentWalletModal({ isOpen, onClose, agentData }: AgentWalletModalProps) {
  const transactions: Transaction[] = [];
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [remark, setRemark] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [depositPlan, setDepositPlan] = useState('prepaid');
  const [retailPlan, setRetailPlan] = useState('prepaid');
  const [error, setError] = useState('');

  if (!isOpen || !agentData) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = agentWalletOperationSchema.safeParse({
      amount: Number(amount),
      reason,
      remark: remark || undefined,
      paymentMethod,
      depositPlan,
      retailPlan,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid agent wallet operation');
      return;
    }
    setError('');
    console.log('Processing', activeTab, parsed.data);
    setAmount('');
    setReason('');
    setRemark('');
    setPaymentMethod('bank_transfer');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 w-[800px] max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Agent Wallet - {agentData.name}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Balance Overview */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-600">Available Balance</p>
                <p className="text-2xl font-semibold text-blue-900">${agentData.balance}</p>
              </div>
              <DollarSign className="h-8 w-8 text-blue-500" />
            </div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-purple-600">Branch</p>
                <p className="text-2xl font-semibold text-purple-900">{agentData.branch}</p>
              </div>
              <Clock className="h-8 w-8 text-purple-500" />
            </div>
          </div>
        </div>

        {/* Plan Settings */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Deposit Plan</label>
            <select
              value={depositPlan}
              onChange={(e) => setDepositPlan(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            >
              <option value="prepaid">Prepaid</option>
              <option value="postpaid">Postpaid</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Retail Plan</label>
            <select
              value={retailPlan}
              onChange={(e) => setRetailPlan(e.target.value)}
              className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
            >
              <option value="prepaid">Prepaid</option>
              <option value="postpaid">Postpaid</option>
            </select>
          </div>
        </div>

        {/* Transaction Form */}
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
              Add Money
            </button>
            <button
              onClick={() => setActiveTab('withdraw')}
              className={`flex-1 py-2 px-4 rounded-md ${
                activeTab === 'withdraw'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300'
              }`}
            >
              Withdraw Money
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-sm text-red-600">{error}</p>}
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

            <div>
              <label className="block text-sm font-medium text-gray-700">Remark</label>
              <input
                type="text"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
              >
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile Money</option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              {activeTab === 'deposit' ? (
                <Plus className="h-4 w-4 mr-2" />
              ) : (
                <Minus className="h-4 w-4 mr-2" />
              )}
              {activeTab === 'deposit' ? 'Add Money' : 'Withdraw Money'}
            </button>
          </form>
        </div>

        {/* Transaction History */}
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
                  `agent-wallet-transactions-${todayStamp()}`,
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
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reason
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reference
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Payment Method
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Added By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.date}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={transaction.type === 'Deposit' ? 'text-green-600' : 'text-red-600'}>
                        ${transaction.amount}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.reason}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.reference}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.paymentMethod}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.addedBy}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        transaction.status === 'Completed'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {transaction.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.type}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
