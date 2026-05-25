import React, { useState } from 'react';
import { X, Wallet, Activity, Gift, Users, FileDown, Plus, History, DollarSign, CreditCard, Ban, Minus } from 'lucide-react';
import { TabGroup } from './TabGroup';
import { DataTable } from './DataTable';
import { FilterBar } from './FilterBar';
import { downloadCsv, todayStamp } from '../lib/csv';
import { toast } from '../lib/toast';

interface UserDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
}

interface Transaction {
  date: string;
  amount: number;
  type: string;
  method: string;
  status: string;
  source: string;
}

interface Referral {
  name: string;
  joinedDate: string;
  bonusEarned: number;
  totalBets: number;
  totalTransactions: number;
  totalAmount: number;
  deposits: number;
  withdrawals: number;
  netAmount: number;
}

interface Ticket {
  ticketId: string;
  stake: number;
  possibleWin: number;
  paidStatus: string;
  createdDate: string;
}

interface BranchTransaction {
  branchName: string;
  salesPerson: string;
  date: string;
  amount: number;
  phoneNumber: string;
}

interface WalletBalance {
  type: string;
  amount: number;
  description: string;
  icon: any;
}

const walletBalances: WalletBalance[] = [
  {
    type: 'Deductible',
    amount: 1000,
    description: 'Available for withdrawal',
    icon: Wallet
  },
  {
    type: 'Payable',
    amount: 500,
    description: 'Pending winnings',
    icon: DollarSign
  },
  {
    type: 'Non-withdrawable',
    amount: 200,
    description: 'Bonus balance',
    icon: Ban
  },
  {
    type: 'Freebet',
    amount: 50,
    description: 'Available for betting only',
    icon: Gift
  }
];

const StatCard = ({ title, value, icon: Icon }: { title: string; value: string; icon: any }) => (
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

const WalletCard = ({ balance }: { balance: WalletBalance }) => (
  <div className="bg-white p-4 rounded-lg shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-gray-50 rounded-lg">
          <balance.icon className="h-5 w-5 text-gray-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">{balance.type}</p>
          <p className="text-xs text-gray-500">{balance.description}</p>
        </div>
      </div>
      <p className="text-lg font-semibold text-gray-900">${balance.amount}</p>
    </div>
  </div>
);

const DepositForm = () => {
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('deductible');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Processing deposit:', { amount, type, description });
  };

  return (
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
        <label className="block text-sm font-medium text-gray-700">Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
        >
          <option value="deductible">Deductible</option>
          <option value="payable">Payable</option>
          <option value="non-withdrawable">Non-withdrawable</option>
          <option value="freebet">Freebet</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Deposit
        </button>
      </div>
    </form>
  );
};

export function UserDetailsModal({ isOpen, onClose, user }: UserDetailsModalProps) {
  const transactions: Transaction[] = [];
  const referrals: Referral[] = [];
  const tickets: Ticket[] = [];
  const branchTransactions: BranchTransaction[] = [];
  const [activeTab, setActiveTab] = useState('transactions');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());

  if (!isOpen || !user) return null;

  const tabs = [
    { id: 'transactions', label: 'Transactions' },
    { id: 'deposits', label: 'Deposits/Withdrawals' },
    { id: 'wins', label: 'Wins/Losses' },
    { id: 'bonus', label: 'Bonus History' },
    { id: 'referrals', label: 'Referrals' },
    { id: 'tickets', label: 'Tickets' },
    { id: 'branch', label: 'Branch Transactions' },
  ];

  const transactionColumns = [
    { header: 'Date', accessor: 'date' as const },
    { header: 'Amount', accessor: 'amount' as const },
    { header: 'Type', accessor: 'type' as const },
    { header: 'Method', accessor: 'method' as const },
    { header: 'Status', accessor: 'status' as const },
    { header: 'Source', accessor: 'source' as const },
  ];

  const referralColumns = [
    { header: 'Name', accessor: 'name' as const },
    { header: 'Joined Date', accessor: 'joinedDate' as const },
    { header: 'Bonus Earned', accessor: 'bonusEarned' as const },
    { header: 'Total Bets', accessor: 'totalBets' as const },
    { 
      header: 'Total Transactions', 
      accessor: 'totalTransactions' as const,
      render: (value: number) => value.toLocaleString()
    },
    {
      header: 'Total Amount',
      accessor: 'totalAmount' as const,
      render: (value: number) => `$${value.toLocaleString()}`
    },
    {
      header: 'Deposits',
      accessor: 'deposits' as const,
      render: (value: number) => `$${value.toLocaleString()}`
    },
    {
      header: 'Withdrawals',
      accessor: 'withdrawals' as const,
      render: (value: number) => `$${value.toLocaleString()}`
    },
    {
      header: 'Net Amount',
      accessor: 'netAmount' as const,
      render: (value: number) => {
        const color = value >= 0 ? 'text-green-600' : 'text-red-600';
        const prefix = value >= 0 ? '+' : '';
        return <span className={color}>{prefix}${value.toLocaleString()}</span>;
      }
    }
  ];

  const ticketColumns = [
    { header: 'Ticket ID', accessor: 'ticketId' as const },
    { header: 'Stake', accessor: 'stake' as const },
    { header: 'Possible Win', accessor: 'possibleWin' as const },
    { header: 'Status', accessor: 'paidStatus' as const },
    { header: 'Created Date', accessor: 'createdDate' as const },
  ];

  const branchColumns = [
    { header: 'Branch', accessor: 'branchName' as const },
    { header: 'Sales Person', accessor: 'salesPerson' as const },
    { header: 'Date', accessor: 'date' as const },
    { header: 'Amount', accessor: 'amount' as const },
    { header: 'Phone', accessor: 'phoneNumber' as const },
  ];

  const handleExport = () => {
    // Export whatever tab dataset the user is currently viewing. Falls back
    // to a compact user summary so the button is always meaningful.
    const summary = [
      {
        name: user?.name || '',
        memberId: user?.memberId || '',
        phone: user?.phone || '',
        email: user?.email || '',
        balance: user?.balance ?? '',
        status: user?.status || '',
      },
    ];
    downloadCsv(
      [
        { header: 'Name', accessor: 'name' },
        { header: 'Member ID', accessor: 'memberId' },
        { header: 'Phone', accessor: 'phone' },
        { header: 'Email', accessor: 'email' },
        { header: 'Balance', accessor: 'balance' },
        { header: 'Status', accessor: 'status' },
      ],
      summary,
      `user-${user?.memberId || 'details'}-${todayStamp()}`
    );
    toast('User details exported.');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center overflow-y-auto py-10">
      <div className="bg-gray-100 rounded-lg w-[90%] max-w-7xl relative">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center sticky top-0 z-50 bg-gray-100 rounded-t-lg">
            <h2 className="text-2xl font-semibold text-gray-900">User Details</h2>
            <button 
              onClick={onClose} 
              className="text-gray-500 hover:text-gray-700 p-2 hover:bg-gray-200 rounded-full transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Balance"
              value={`$${user.balance}`}
              icon={Wallet}
            />
            <StatCard
              title="Bonus Balance"
              value={`$${user.bonus}`}
              icon={Gift}
            />
            <StatCard
              title="Total Won"
              value={`$${user.won}`}
              icon={Activity}
            />
            <StatCard
              title="Referrals"
              value="5"
              icon={Users}
            />
          </div>

          {/* User Info Card */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">User Information</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-500">Name</p>
                <p className="font-medium">{user.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Member ID</p>
                <p className="font-medium">{user.memberId}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Email</p>
                <p className="font-medium">{user.email}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Phone</p>
                <p className="font-medium">{user.phone}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Member Type</p>
                <p className="font-medium">{user.memberType}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <p className="font-medium">{user.status}</p>
              </div>
            </div>
          </div>

          {/* Wallet Section */}
          {activeTab === 'deposits' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Wallet Breakdown</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {walletBalances.map((balance) => (
                      <WalletCard key={balance.type} balance={balance} />
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">Recent Transactions</h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('transactions')}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      View All
                    </button>
                  </div>
                  <div className="space-y-4">
                    {transactions.slice(0, 5).map((transaction, index) => (
                      <div key={index} className="flex items-center justify-between py-2 border-b border-gray-200">
                        <div className="flex items-center space-x-3">
                          <div className={`p-2 rounded-full ${
                            transaction.type === 'Deposit' ? 'bg-green-100' : 'bg-red-100'
                          }`}>
                            {transaction.type === 'Deposit' ? (
                              <Plus className="h-4 w-4 text-green-600" />
                            ) : (
                              <Minus className="h-4 w-4 text-red-600" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{transaction.type}</p>
                            <p className="text-sm text-gray-500">{transaction.date}</p>
                          </div>
                        </div>
                        <p className={`font-medium ${
                          transaction.type === 'Deposit' ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {transaction.type === 'Deposit' ? '+' : '-'}${transaction.amount}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Add Deposit</h3>
                <DepositForm />
              </div>
            </div>
          )}

          {/* Tabs and Content */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <TabGroup
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
              <button
                onClick={handleExport}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <FileDown className="h-4 w-4 mr-2" />
                Export Data
              </button>
            </div>

            <FilterBar
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
            />

            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              {activeTab === 'transactions' && (
                <DataTable columns={transactionColumns} data={transactions} />
              )}
              {activeTab === 'referrals' && (
                <div className="space-y-4">
                  <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
                    <div className="flex">
                      <Users className="h-5 w-5 text-blue-400" />
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-blue-800">Referral Summary</h3>
                        <div className="mt-2 text-sm text-blue-700">
                          <p>Total Referrals: {referrals.length}</p>
                          <p>Total Bonus Earned: ${referrals.reduce((sum, ref) => sum + ref.bonusEarned, 0).toLocaleString()}</p>
                          <p>Total Transaction Volume: ${referrals.reduce((sum, ref) => sum + ref.totalTransactions, 0).toLocaleString()}</p>
                          <p>Total Amount: ${referrals.reduce((sum, ref) => sum + ref.totalAmount, 0).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <DataTable columns={referralColumns} data={referrals} />
                </div>
              )}
              {activeTab === 'tickets' && (
                <DataTable columns={ticketColumns} data={tickets} />
              )}
              {activeTab === 'branch' && (
                <DataTable columns={branchColumns} data={branchTransactions} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
