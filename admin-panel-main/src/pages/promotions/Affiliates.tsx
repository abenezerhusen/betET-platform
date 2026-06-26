import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { CommissionConfigModal } from '../../components/CommissionConfigModal';
import { CreateAffiliateModal } from '../../components/CreateAffiliateModal';
import { toast } from '../../lib/toast';
import { 
  Users,
  DollarSign,
  TrendingUp,
  FileDown,
  Plus,
  Upload,
  Clock,
  CheckCircle,
  XCircle
} from 'lucide-react';
import * as promotionsApi from '../../lib/api/promotions';
import { useAuthStore } from '../../store/auth';

interface AffiliateData {
  id: string;
  phoneNumber: string;
  name: string;
  referralCode: string;
  totalReferrals: number;
  activeUsers: number;
  revenue: number;
  commission: number;
  status: string;
  lastActive: string;
}

interface PaymentData {
  id: string;
  affiliate: string;
  amount: number;
  method: string;
  status: string;
  reference: string;
  date: string;
  proof: string;
}

interface CommissionConfigRow {
  id: string;
  type: string;
  rate: number;
  product: string;
  threshold: number;
  holdPeriod: number;
  status: string;
}

const StatCard = ({ icon: Icon, title, value, trend }: { icon: any; title: string; value: string; trend?: string }) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <div className="p-2 bg-green-50 rounded-lg">
        <Icon className="h-6 w-6 text-green-600" />
      </div>
    </div>
    <h3 className="text-lg font-semibold text-gray-900">{value}</h3>
    <p className="text-sm text-gray-500 mt-1">{title}</p>
    {trend && (
      <p className="text-sm text-green-600 mt-2">{trend}</p>
    )}
  </div>
);

export function Affiliates() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('affiliates');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCommissionModalOpen, setIsCommissionModalOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [affiliates, setAffiliates] = useState<AffiliateData[]>([]);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentData[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [commissionConfig, setCommissionConfig] = useState<promotionsApi.CommissionConfig | null>(null);
  const [commissionLoading, setCommissionLoading] = useState(false);

  const mapAffiliates = (items: Array<promotionsApi.Affiliate & {
    phone?: string;
    total_referrals?: number;
    active_users?: number;
    revenue_generated?: string | number;
  }>) =>
    items.map((a) => ({
      id: a.id,
      phoneNumber: a.phone ?? '—',
      name: a.name,
      referralCode: a.code,
      totalReferrals: Number(a.total_referrals ?? 0),
      activeUsers: Number(a.active_users ?? 0),
      revenue: Number(a.revenue_generated ?? 0),
      commission: Number(a.earnings_total ?? 0),
      status: a.status,
      lastActive: a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '—',
    }));

  const reloadAffiliates = async () => {
    setLoading(true);
    try {
      const res = await promotionsApi.listAffiliates({ limit: 200 });
      setAffiliates(mapAffiliates(res.items ?? []));
    } catch (err) {
      toast(`Failed to load affiliates: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuth) return;
    void reloadAffiliates();
  }, [isAuth]);

  useEffect(() => {
    if (!isAuth || activeTab !== 'payments') return;
    let cancelled = false;
    setPaymentsLoading(true);
    promotionsApi
      .listAffiliatePayments({ limit: 200 })
      .then((res) => {
        if (cancelled) return;
        setPayments(
          (res.items ?? []).map((p) => ({
            id: p.id,
            affiliate: p.affiliate ?? p.affiliate_id ?? '',
            amount: Number(p.amount ?? 0),
            method: p.method ?? '—',
            status: p.status,
            reference: p.reference || '—',
            date: p.date ? new Date(p.date).toLocaleString() : '—',
            proof: p.note ?? '',
          }))
        );
      })
      .catch((err: Error) => toast(`Failed to load payments: ${err.message}`, 'error'))
      .finally(() => {
        if (!cancelled) setPaymentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, activeTab]);

  useEffect(() => {
    if (!isAuth || activeTab !== 'commission') return;
    let cancelled = false;
    setCommissionLoading(true);
    promotionsApi
      .getCommissionConfig()
      .then((res) => {
        if (cancelled) return;
        setCommissionConfig(res);
      })
      .catch((err: Error) => toast(`Failed to load commission config: ${err.message}`, 'error'))
      .finally(() => {
        if (!cancelled) setCommissionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, activeTab]);

  const tabs = [
    { id: 'affiliates', label: 'Affiliate Records' },
    { id: 'payments', label: 'Affiliate Payments' },
    { id: 'commission', label: 'Commission Config' },
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
      options: ['active', 'paused', 'terminated'],
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
  ];

  const filteredAffiliates = useMemo(
    () =>
      affiliates.filter(
        (a) =>
          (!selectedStatus || a.status === selectedStatus) &&
          (!phoneNumber || a.phoneNumber.includes(phoneNumber) || a.name.toLowerCase().includes(phoneNumber.toLowerCase()))
      ),
    [affiliates, selectedStatus, phoneNumber]
  );

  const affiliateColumns = [
    { header: 'Name', accessor: 'name' as const },
    { header: 'Phone', accessor: 'phoneNumber' as const },
    { header: 'Referral Code', accessor: 'referralCode' as const },
    { header: 'Total Referrals', accessor: 'totalReferrals' as const },
    { header: 'Active Users', accessor: 'activeUsers' as const },
    { header: 'Revenue', accessor: 'revenue' as const },
    { header: 'Commission', accessor: 'commission' as const },
    { header: 'Status', accessor: 'status' as const },
    { header: 'Last Active', accessor: 'lastActive' as const },
  ];

  const handleProcessPayment = async (row: PaymentData) => {
    const affiliateId = row.id.startsWith('pending-') ? row.id.slice('pending-'.length) : null;
    if (!affiliateId) {
      toast('This payment has already been processed.', 'error');
      return;
    }
    try {
      await promotionsApi.payAffiliate(affiliateId, {
        amount: row.amount,
        method: row.method !== '—' ? row.method : 'wallet',
      });
      toast(`Payment processed for ${row.affiliate}.`);
      const res = await promotionsApi.listAffiliatePayments({ limit: 200 });
      setPayments(
        (res.items ?? []).map((p) => ({
          id: p.id,
          affiliate: p.affiliate ?? p.affiliate_id ?? '',
          amount: Number(p.amount ?? 0),
          method: p.method ?? '—',
          status: p.status,
          reference: p.reference || '—',
          date: p.date ? new Date(p.date).toLocaleString() : '—',
          proof: p.note ?? '',
        }))
      );
      await reloadAffiliates();
    } catch (err) {
      toast(`Failed to process payment: ${(err as Error).message}`, 'error');
    }
  };

  const paymentColumns = [
    { header: 'Affiliate', accessor: 'affiliate' as const },
    { header: 'Amount', accessor: 'amount' as const },
    { header: 'Method', accessor: 'method' as const },
    { header: 'Status', accessor: 'status' as const },
    { header: 'Reference', accessor: 'reference' as const },
    { header: 'Date', accessor: 'date' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (_id: string, row: PaymentData) => (
        <div className="flex space-x-2">
          <button
            type="button"
            aria-label="Upload proof"
            title="Upload proof"
            onClick={() => toast(`Upload proof requested for ${row.id}.`)}
            className="text-blue-600 hover:text-blue-800"
          >
            <Upload className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Process payment"
            title="Process payment"
            disabled={row.status !== 'pending'}
            onClick={() => void handleProcessPayment(row)}
            className="text-green-600 hover:text-green-800 disabled:text-gray-300"
          >
            <CheckCircle className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Cancel payment"
            title="Cancel payment"
            onClick={() => toast(`Payment ${row.id} cancelled.`, 'error')}
            className="text-red-600 hover:text-red-800"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  const commissionColumns = [
    { header: 'Type', accessor: 'type' as const },
    { header: 'Rate', accessor: 'rate' as const },
    { header: 'Product', accessor: 'product' as const },
    { header: 'Threshold', accessor: 'threshold' as const },
    { header: 'Hold Period', accessor: 'holdPeriod' as const },
    { header: 'Status', accessor: 'status' as const },
  ];

  const commissionRows: CommissionConfigRow[] = useMemo(() => {
    if (!commissionConfig) return [];
    const list = commissionConfig.payments_list ?? [];
    if (list.length > 0) {
      return list.map((r, idx) => ({
        id: `row-${idx}`,
        type: r.type,
        rate: r.rate,
        product: r.product,
        threshold: r.threshold,
        holdPeriod: r.hold_days,
        status: r.active ? 'active' : 'inactive',
      }));
    }
    return [
      {
        id: 'sportsbook',
        type: 'revenue_share',
        rate: commissionConfig.sportsbook?.revenue_share_pct ?? 0,
        product: 'sportsbook',
        threshold: commissionConfig.sportsbook?.cpa_amount ?? 0,
        holdPeriod: commissionConfig.sportsbook?.hold_days ?? 0,
        status: 'active',
      },
      {
        id: 'casino',
        type: 'revenue_share',
        rate: commissionConfig.casino?.revenue_share_pct ?? 0,
        product: 'casino',
        threshold: commissionConfig.casino?.cpa_amount ?? 0,
        holdPeriod: commissionConfig.casino?.hold_days ?? 0,
        status: 'active',
      },
    ];
  }, [commissionConfig]);

  const getData = (): any[] => {
    switch (activeTab) {
      case 'payments':
        return payments;
      case 'commission':
        return commissionRows;
      default:
        return filteredAffiliates;
    }
  };

  const getColumns = (): any[] => {
    switch (activeTab) {
      case 'payments':
        return paymentColumns;
      case 'commission':
        return commissionColumns;
      default:
        return affiliateColumns;
    }
  };

  const handleCreateAffiliate = async (data: {
    name: string;
    referralCode: string;
    commission: { type: string; rate: number };
  }) => {
    try {
      await promotionsApi.createAffiliate({
        name: data.name,
        code: data.referralCode,
        plan: (data.commission.type === 'cpa' ? 'cpa' : data.commission.type === 'hybrid' ? 'hybrid' : 'revenue_share') as promotionsApi.Affiliate['plan'],
        commission_pct: data.commission.rate,
        cpa_amount: 0,
        status: 'active',
      });
      toast('Affiliate created.');
      const res = await promotionsApi.listAffiliates({ limit: 200 });
      setAffiliates(
        (res.items ?? []).map((a) => ({
          id: a.id,
          phoneNumber: '—',
          name: a.name,
          referralCode: a.code,
          totalReferrals: 0,
          activeUsers: 0,
          revenue: 0,
          commission: Number(a.earnings_total ?? 0),
          status: a.status,
          lastActive: a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '—',
        }))
      );
      setIsCreateModalOpen(false);
    } catch (err) {
      toast(`Failed to create affiliate: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const handleSaveCommissionConfig = async (config: any) => {
    const current = commissionConfig ?? {
      sportsbook: { revenue_share_pct: 25, cpa_amount: 0, hold_days: 30 },
      casino: { revenue_share_pct: 30, cpa_amount: 0, hold_days: 30 },
    };
    const product = String(config?.product ?? 'sportsbook').toLowerCase() as 'sportsbook' | 'casino';
    const type = String(config?.type ?? 'revenue_share') as 'revenue_share' | 'cpa' | 'hybrid';
    const rate = Number(config?.rate ?? 0);
    const threshold = Number(config?.threshold ?? 0);
    const holdDays = Number(config?.holdPeriod ?? 30);

    const next: promotionsApi.CommissionConfig = {
      sportsbook: { ...current.sportsbook },
      casino: { ...current.casino },
      payments_list: [
        ...(current.payments_list ?? []),
        { type, product, rate, threshold, hold_days: holdDays, active: true },
      ],
    };

    if (product === 'sportsbook') {
      next.sportsbook = {
        revenue_share_pct: type === 'cpa' ? next.sportsbook.revenue_share_pct : rate,
        cpa_amount: type === 'cpa' || type === 'hybrid' ? rate : next.sportsbook.cpa_amount,
        hold_days: holdDays,
      };
    } else {
      next.casino = {
        revenue_share_pct: type === 'cpa' ? next.casino.revenue_share_pct : rate,
        cpa_amount: type === 'cpa' || type === 'hybrid' ? rate : next.casino.cpa_amount,
        hold_days: holdDays,
      };
    }

    try {
      const saved = await promotionsApi.updateCommissionConfig(next);
      setCommissionConfig(saved);
      toast('Commission configuration saved.');
    } catch (err) {
      toast(`Failed to save commission config: ${(err as Error).message}`, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Users className="h-8 w-8 text-green-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Affiliates</h1>
        </div>
        <div className="space-x-4">
          <button
            onClick={() => toast('Affiliate report exported.')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Report
          </button>
          {activeTab === 'commission' && (
            <button
              onClick={() => setIsCommissionModalOpen(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Configure Commission
            </button>
          )}
          {activeTab === 'affiliates' && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Affiliate
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={Users}
          title="Total Affiliates"
          value={loading ? '—' : String(filteredAffiliates.length)}
          trend="from API"
        />
        <StatCard
          icon={TrendingUp}
          title="Conversion Rate"
          value={loading ? '—' : '—'}
          trend="not exposed by current endpoint"
        />
        <StatCard
          icon={DollarSign}
          title="Total Commission"
          value={loading ? '—' : `$${filteredAffiliates.reduce((acc, a) => acc + a.commission, 0).toLocaleString()}`}
          trend="earnings_total aggregate"
        />
        <StatCard
          icon={Clock}
          title="Pending Payouts"
          value={loading ? '—' : String(filteredAffiliates.filter((a) => a.status !== 'active').length)}
          trend="non-active affiliates"
        />
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

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
        {activeTab === 'payments' && paymentsLoading && (
          <div className="px-6 pb-6 text-sm text-gray-500">Loading payments…</div>
        )}
        {activeTab === 'commission' && commissionLoading && (
          <div className="px-6 pb-6 text-sm text-gray-500">Loading commission config…</div>
        )}
        {activeTab === 'affiliates' && loading && (
          <div className="px-6 pb-6 text-sm text-gray-500">Loading affiliates…</div>
        )}
      </div>

      <CreateAffiliateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateAffiliate}
      />

      <CommissionConfigModal
        isOpen={isCommissionModalOpen}
        onClose={() => setIsCommissionModalOpen(false)}
        onSave={handleSaveCommissionConfig}
      />
    </div>
  );
}
