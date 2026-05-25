import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Shield,
  Smartphone,
  Wallet,
  Percent,
  PiggyBank,
  Gauge,
  TrendingUp,
  Repeat,
  LogOut,
  Clock,
  AlertTriangle,
  Check,
  X,
  RefreshCcw,
} from 'lucide-react';
import { http, ApiError } from '../../lib/api/client';

type OperatorDashboardResponse = {
  operator?: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    permissions?: string[];
  } | null;
  session?: {
    expires_at?: string;
    token_tail?: string;
  } | null;
  device?: {
    id: string;
    name: string;
    owner_name: string;
    phone: string;
    status: 'Online' | 'Offline' | string;
    last_seen_at?: string | null;
  } | null;
  metrics?: {
    status: 'Online' | 'Offline' | string;
    balance: string;
    commission_earned: string;
    commission_rate: number;
    pre_deposit: string;
  } | null;
  capacity?: {
    total: string;
    available: string;
    used_today: string;
    daily_limit: string;
  } | null;
  revenue?: {
    today: string;
    last_7d: string;
    last_30d: string;
  } | null;
  swaps?: Array<{
    id: string;
    date: string;
    time: string;
    amount: string;
    source: string;
    status: string;
    note?: string | null;
  }>;
};

const currency = (v: number) =>
  `ETB ${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function num(v: string | number | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return <span className="text-red-600">Session expired</span>;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return <span>{mins} min remaining</span>;
  const h = Math.floor(mins / 60);
  if (h < 24) return <span>{h}h {mins % 60}m remaining</span>;
  const d = Math.floor(h / 24);
  return <span>{d}d {h % 24}h remaining</span>;
}

export function OperatorDashboard() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OperatorDashboardResponse | null>(null);

  const load = async () => {
    if (!token) {
      setError('invalid');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const out = await http.get<OperatorDashboardResponse>(
        `/api/operator/dashboard?token=${encodeURIComponent(token)}`,
        { auth: false }
      );
      setData(out);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setError('invalid');
      } else {
        setError('load');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const perms = useMemo(
    () => new Set(data?.operator?.permissions ?? []),
    [data?.operator?.permissions]
  );
  const can = (p: string) => perms.has(p);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-sm max-w-md w-full p-8 text-center">
          <p className="text-sm text-gray-600">Loading operator dashboard...</p>
        </div>
      </div>
    );
  }

  if (error === 'invalid' || !data?.operator || !data?.session) {
    return (
      <ErrorShell
        icon={<X className="h-8 w-8 text-red-600" />}
        title="Invalid access link"
        description="This link is invalid, expired, or revoked. Please request a new access link from your administrator."
      />
    );
  }

  if (error) {
    return (
      <ErrorShell
        icon={<AlertTriangle className="h-8 w-8 text-yellow-600" />}
        title="Dashboard unavailable"
        description="Could not load the operator dashboard right now. Please retry in a moment."
      />
    );
  }

  if (!can('operator.dashboard.view')) {
    return (
      <ErrorShell
        icon={<Shield className="h-8 w-8 text-gray-500" />}
        title="Dashboard access disabled"
        description="Your administrator has not enabled operator dashboard access for this account."
      />
    );
  }

  const device = data.device;
  const metrics = data.metrics;
  const capacity = data.capacity;
  const revenue = data.revenue;
  const swaps = data.swaps ?? [];
  const expiresAt = data.session.expires_at ?? '';
  const tokenTail = data.session.token_tail ?? '--------';

  const totalCap = num(capacity?.total);
  const availableCap = num(capacity?.available);
  const capacityUsedPct = Math.min(
    100,
    Math.round(((totalCap - availableCap) / Math.max(1, totalCap)) * 100)
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Smartphone className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">
                {device?.name ?? data.operator.name}
              </h1>
              <p className="text-xs text-gray-500">
                {data.operator.name}
                {device?.phone ? ` · ${device.phone}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="hidden md:flex items-center text-xs text-gray-500 space-x-1">
              <Shield size={12} />
              <span>Signed in via secure link</span>
              {expiresAt && (
                <>
                  <span>·</span>
                  <Clock size={12} />
                  <Countdown expiresAt={expiresAt} />
                </>
              )}
            </div>
            <button
              onClick={async () => {
                try {
                  await http.post('/api/operator/sign-out', undefined, {
                    auth: false,
                    query: { token },
                  });
                } catch {
                  // best effort
                } finally {
                  window.location.href = '/operator/dashboard?signedout=1';
                }
              }}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs text-gray-700 bg-white hover:bg-gray-50"
            >
              <LogOut size={12} className="mr-1.5" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start space-x-2">
          <Shield className="h-4 w-4 text-blue-700 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-900">
            You are viewing read-only data for your assigned operator wallet.
            {expiresAt ? (
              <>
                {' '}
                Session expires on <strong>{new Date(expiresAt).toLocaleString()}</strong>.
              </>
            ) : null}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {can('operator.dashboard.status.view') && (
            <MetricCard
              icon={<Check className="h-5 w-5 text-green-600" />}
              bg="bg-green-50"
              label="Status"
              value={
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium ${
                    (metrics?.status ?? device?.status) === 'Online'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full mr-1.5 ${
                      (metrics?.status ?? device?.status) === 'Online' ? 'bg-green-500' : 'bg-gray-400'
                    }`}
                  />
                  {metrics?.status ?? device?.status ?? 'Unknown'}
                </span>
              }
              subtitle={
                (metrics?.status ?? device?.status) === 'Online'
                  ? 'Accepting transactions'
                  : 'Device currently offline'
              }
            />
          )}

          {can('operator.dashboard.balance.view') && (
            <MetricCard
              icon={<Wallet className="h-5 w-5 text-blue-600" />}
              bg="bg-blue-50"
              label="Balance"
              value={currency(num(metrics?.balance))}
              subtitle="Current wallet balance"
            />
          )}

          {can('operator.dashboard.commission.view') && (
            <MetricCard
              icon={<Percent className="h-5 w-5 text-purple-600" />}
              bg="bg-purple-50"
              label="Commission"
              value={currency(num(metrics?.commission_earned))}
              subtitle={`Rate: ${num(metrics?.commission_rate).toFixed(2)}% · Earned today`}
            />
          )}

          {can('operator.dashboard.pre_deposit.view') && (
            <MetricCard
              icon={<PiggyBank className="h-5 w-5 text-indigo-600" />}
              bg="bg-indigo-50"
              label="Pre-Deposit"
              value={currency(num(metrics?.pre_deposit))}
              subtitle="Locked pre-deposit amount"
            />
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {(can('operator.dashboard.total_capacity.view') ||
            can('operator.dashboard.available_capacity.view')) && (
            <div className="bg-white rounded-lg shadow-sm p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <Gauge className="h-4 w-4 text-blue-600" />
                  <h3 className="text-sm font-semibold text-gray-900">Capacity</h3>
                </div>
                <span className="text-xs text-gray-500">{capacityUsedPct}% used</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mb-4">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${capacityUsedPct}%` }}
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {can('operator.dashboard.total_capacity.view') && (
                  <div>
                    <p className="text-xs text-gray-500">Total Capacity</p>
                    <p className="text-lg font-semibold text-gray-900">{currency(totalCap)}</p>
                  </div>
                )}
                {can('operator.dashboard.available_capacity.view') && (
                  <div>
                    <p className="text-xs text-gray-500">Available Capacity</p>
                    <p className="text-lg font-semibold text-green-700">
                      {currency(availableCap)}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-gray-500">Used Today</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {currency(num(capacity?.used_today))}
                    <span className="text-xs text-gray-400 ml-1">
                      / {currency(num(capacity?.daily_limit))}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {can('operator.dashboard.revenue.view') && (
            <div className="bg-white rounded-lg shadow-sm p-5">
              <div className="flex items-center space-x-2 mb-3">
                <TrendingUp className="h-4 w-4 text-green-600" />
                <h3 className="text-sm font-semibold text-gray-900">Revenue</h3>
              </div>
              <div className="space-y-3">
                <RevenueRow label="Today" value={num(revenue?.today)} highlight />
                <RevenueRow label="Last 7 days" value={num(revenue?.last_7d)} />
                <RevenueRow label="Last 30 days" value={num(revenue?.last_30d)} />
              </div>
            </div>
          )}
        </div>

        {can('operator.dashboard.swap_activity.view') && (
          <div className="bg-white rounded-lg shadow-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <Repeat className="h-4 w-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-gray-900">Swap Activity</h3>
              </div>
              <button
                onClick={() => void load()}
                className="inline-flex items-center text-xs text-gray-500 hover:text-gray-900"
              >
                <RefreshCcw size={12} className="mr-1" />
                Refresh
              </button>
            </div>
            {swaps.length === 0 ? (
              <div className="p-10 text-center text-sm text-gray-500">No swap activity yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                      <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                      <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {swaps.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-5 py-2 text-xs text-gray-500">{s.date}</td>
                        <td className="px-5 py-2 text-xs text-gray-500">{s.time}</td>
                        <td className="px-5 py-2 text-xs text-gray-900">{s.source}</td>
                        <td className="px-5 py-2 text-xs text-gray-900 text-right font-medium">
                          {currency(num(s.amount))}
                        </td>
                        <td className="px-5 py-2 text-xs">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              s.status === 'Added'
                                ? 'bg-green-100 text-green-800'
                                : s.status === 'Pending'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <footer className="text-center text-[11px] text-gray-400 py-4">
          Secure operator session · Token ·
          <span className="font-mono"> ...{tokenTail}</span>
        </footer>
      </main>
    </div>
  );
}

function MetricCard({
  icon,
  bg,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  bg: string;
  label: string;
  value: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center space-x-3 mb-3">
        <div className={`p-2 rounded-lg ${bg}`}>{icon}</div>
        <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">{label}</p>
      </div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function RevenueRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm font-semibold ${highlight ? 'text-green-700' : 'text-gray-900'}`}>
        {currency(value)}
      </span>
    </div>
  );
}

function ErrorShell({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-lg shadow-sm max-w-md w-full p-8 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          {icon}
        </div>
        <h1 className="text-lg font-semibold text-gray-900 mb-2">{title}</h1>
        <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
        <div className="mt-6">
          <Link
            to="/login"
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50"
          >
            Go to admin login
          </Link>
        </div>
      </div>
    </div>
  );
}
