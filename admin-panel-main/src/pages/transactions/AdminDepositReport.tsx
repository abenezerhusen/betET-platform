/**
 * /transactions/admin-deposits — Admin Deposit Report.
 *
 * Lists every manual credit an administrator made into an online user's
 * wallet (the "deposit funds into a user account" action). Powered by
 * `GET /api/admin/transactions/admin-deposits` so filtering, sorting and
 * pagination are pushed down to the server.
 *
 * Columns: Deposit ID, User Name, Phone, Amount, Previous Balance,
 * New Balance, Deposited By, Date/Time, Remark.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { FileDown, FileText, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import { toast } from '../../lib/toast';
import * as txApi from '../../lib/api/transactions';
import { useAuthStore } from '../../store/auth';
import { formatCurrency, toIso, toNumber } from '../../lib/format';

const PAGE_SIZE = 50;

interface DepositRow {
  id: string;
  userName: string;
  phone: string;
  amount: number;
  beforeBalance: number;
  afterBalance: number;
  depositedBy: string;
  date: string;
  remark: string;
  currency?: string;
  raw: txApi.AdminDepositRow;
}

const num = (v: string | number | null | undefined): number => toNumber(v);

function mapRow(r: txApi.AdminDepositRow): DepositRow {
  return {
    id: r.id,
    userName: String(r.user_name ?? r.user_phone ?? r.user_email ?? '—'),
    phone: String(r.user_phone ?? '—'),
    amount: Math.abs(num(r.amount)),
    beforeBalance: num(r.before_balance),
    afterBalance: num(r.after_balance),
    depositedBy: String(r.admin_name ?? r.admin_email ?? r.admin_id ?? '—'),
    date: r.created_at ? new Date(r.created_at).toLocaleString() : '',
    remark: String(r.remark ?? ''),
    currency: r.currency ?? undefined,
    raw: r,
  };
}

type SortKey = 'date' | 'amount' | 'admin';

export function AdminDepositReport() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  const canView =
    role === 'admin' || role === 'superadmin' || role === 'tenant_admin';

  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [adminName, setAdminName] = useState('');
  const [phone, setPhone] = useState('');
  const [search, setSearch] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  const [sort, setSort] = useState<SortKey>('date');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<DepositRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<{
    total_amount: string;
    count: string;
  } | null>(null);
  const [admins, setAdmins] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Normalise to whole-day boundaries so the selected end-day is included.
  const { fromParam, toParam } = useMemo(() => {
    const s = new Date(startDate);
    s.setHours(0, 0, 0, 0);
    const e = new Date(endDate);
    e.setHours(23, 59, 59, 999);
    return { fromParam: toIso(s), toParam: toIso(e) };
  }, [startDate, endDate]);

  // Map the selected administrator label back to its id for the query.
  const adminIdByName = useMemo(() => {
    const m = new Map<string, string>();
    admins.forEach((a) => {
      if (a.name && !m.has(a.name)) m.set(a.name, a.id);
    });
    return m;
  }, [admins]);

  const buildQuery = (extra?: Partial<txApi.AdminDepositQuery>): txApi.AdminDepositQuery => ({
    from: fromParam,
    to: toParam,
    admin_id: adminName ? adminIdByName.get(adminName) ?? undefined : undefined,
    phone: phone || undefined,
    search: search || undefined,
    min_amount: minAmount ? Number(minAmount) : undefined,
    max_amount: maxAmount ? Number(maxAmount) : undefined,
    sort,
    dir,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...extra,
  });

  // Reset to first page whenever a filter/sort changes.
  useEffect(() => {
    setPage(0);
  }, [
    fromParam,
    toParam,
    adminName,
    phone,
    search,
    minAmount,
    maxAmount,
    sort,
    dir,
  ]);

  useEffect(() => {
    if (!isAuth || !canView) return;
    let cancelled = false;
    setLoading(true);
    txApi
      .listAdminDeposits(buildQuery())
      .then((res) => {
        if (cancelled) return;
        setRows(res.items.map(mapRow));
        setTotal(res.total ?? 0);
        setSummary(res.summary ?? null);
        if (res.admins?.length) setAdmins(res.admins);
      })
      .catch((err: Error) =>
        toast(`Failed to load deposit report: ${err.message}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAuth,
    canView,
    fromParam,
    toParam,
    adminName,
    phone,
    search,
    minAmount,
    maxAmount,
    sort,
    dir,
    page,
  ]);

  const filters = [
    {
      label: 'Administrator',
      options: admins.map((a) => a.name).filter(Boolean),
      value: adminName,
      onChange: setAdminName,
    },
    {
      label: 'User Phone',
      options: [] as string[],
      value: phone,
      onChange: setPhone,
      type: 'text' as const,
    },
    {
      label: 'Phone / Deposit ID',
      options: [] as string[],
      value: search,
      onChange: setSearch,
      type: 'text' as const,
    },
    {
      label: 'Min Amount',
      options: [] as string[],
      value: minAmount,
      onChange: setMinAmount,
      type: 'number' as const,
    },
    {
      label: 'Max Amount',
      options: [] as string[],
      value: maxAmount,
      onChange: setMaxAmount,
      type: 'number' as const,
    },
  ];

  const columns = useMemo(
    () => [
      {
        header: 'Deposit ID',
        accessor: 'id' as const,
        render: (v: string) => (
          <span className="font-mono text-xs text-gray-700" title={v}>
            {v.length > 12 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v}
          </span>
        ),
      },
      { header: 'User Name', accessor: 'userName' as const },
      { header: 'Phone', accessor: 'phone' as const },
      {
        header: 'Amount',
        accessor: 'amount' as const,
        render: (v: number, r: DepositRow) => (
          <span className="font-medium text-green-700">
            {formatCurrency(v, r.currency)}
          </span>
        ),
      },
      {
        header: 'Previous Balance',
        accessor: 'beforeBalance' as const,
        render: (v: number, r: DepositRow) => formatCurrency(v, r.currency),
      },
      {
        header: 'New Balance',
        accessor: 'afterBalance' as const,
        render: (v: number, r: DepositRow) => formatCurrency(v, r.currency),
      },
      { header: 'Deposited By', accessor: 'depositedBy' as const },
      { header: 'Date & Time', accessor: 'date' as const },
      { header: 'Remark', accessor: 'remark' as const },
    ],
    []
  );

  /** Fetch every row that matches the current filters (paged in blocks). */
  const fetchAllRows = async (): Promise<DepositRow[]> => {
    const all: DepositRow[] = [];
    const block = 500;
    let offset = 0;
    // Safety cap so an accidental huge range can't hang the browser.
    const CAP = 20000;
    for (;;) {
      const res = await txApi.listAdminDeposits(
        buildQuery({ limit: block, offset })
      );
      all.push(...res.items.map(mapRow));
      offset += block;
      if (
        res.items.length < block ||
        offset >= (res.total ?? all.length) ||
        all.length >= CAP
      ) {
        break;
      }
    }
    return all;
  };

  const stamp = () => {
    const d = new Date();
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  };

  const handleExportExcel = async () => {
    if (total === 0) {
      toast('No deposits to export.', 'error');
      return;
    }
    setExporting(true);
    try {
      const data = await fetchAllRows();
      const XLSX = await import('xlsx');
      const aoa = data.map((r) => ({
        'Deposit ID': r.id,
        'User Name': r.userName,
        Phone: r.phone,
        Amount: r.amount,
        'Previous Balance': r.beforeBalance,
        'New Balance': r.afterBalance,
        'Deposited By': r.depositedBy,
        'Date & Time': r.date,
        Remark: r.remark,
      }));
      const ws = XLSX.utils.json_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Admin Deposits');
      XLSX.writeFile(wb, `admin-deposit-report-${stamp()}.xlsx`);
      toast(`Exported ${data.length} deposits to Excel.`);
    } catch (err) {
      toast(`Excel export failed: ${(err as Error).message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (total === 0) {
      toast('No deposits to export.', 'error');
      return;
    }
    setExporting(true);
    try {
      const data = await fetchAllRows();
      const totalAmount = data.reduce((s, r) => s + r.amount, 0);
      const esc = (v: unknown) =>
        String(v ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      const body = data
        .map(
          (r) => `<tr>
            <td class="mono">${esc(r.id)}</td>
            <td>${esc(r.userName)}</td>
            <td>${esc(r.phone)}</td>
            <td class="r">${esc(formatCurrency(r.amount, r.currency))}</td>
            <td class="r">${esc(formatCurrency(r.beforeBalance, r.currency))}</td>
            <td class="r">${esc(formatCurrency(r.afterBalance, r.currency))}</td>
            <td>${esc(r.depositedBy)}</td>
            <td>${esc(r.date)}</td>
            <td>${esc(r.remark)}</td>
          </tr>`
        )
        .join('');
      const range = `${new Date(startDate).toLocaleDateString()} — ${new Date(
        endDate
      ).toLocaleDateString()}`;
      const html = `<!doctype html><html><head><meta charset="utf-8">
        <title>Admin Deposit Report</title>
        <style>
          *{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}
          body{margin:24px;color:#111}
          h1{font-size:18px;margin:0 0 4px}
          .meta{font-size:12px;color:#555;margin-bottom:12px}
          .totals{font-size:13px;margin:8px 0 16px;font-weight:bold}
          table{width:100%;border-collapse:collapse;font-size:11px}
          th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
          th{background:#f3f4f6;text-transform:uppercase;font-size:10px;color:#374151}
          td.r{text-align:right}
          td.mono{font-family:'Courier New',monospace;font-size:10px}
          tr:nth-child(even) td{background:#fafafa}
          @media print{.noprint{display:none}}
        </style></head><body>
        <h1>Admin Deposit Report</h1>
        <div class="meta">Date range: ${esc(range)} &nbsp;•&nbsp; Generated: ${esc(
        new Date().toLocaleString()
      )}</div>
        <div class="totals">Total Deposited: ${esc(
          formatCurrency(totalAmount)
        )} &nbsp;•&nbsp; Records: ${data.length}</div>
        <button class="noprint" onclick="window.print()" style="margin-bottom:12px;padding:6px 12px;cursor:pointer">Print / Save as PDF</button>
        <table><thead><tr>
          <th>Deposit ID</th><th>User Name</th><th>Phone</th><th>Amount</th>
          <th>Previous Balance</th><th>New Balance</th><th>Deposited By</th>
          <th>Date &amp; Time</th><th>Remark</th>
        </tr></thead><tbody>${body}</tbody></table>
        <script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
        </body></html>`;
      const w = window.open('', '_blank');
      if (!w) {
        toast('Popup blocked — allow popups to export PDF.', 'error');
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      toast(`Prepared ${data.length} deposits for PDF.`);
    } catch (err) {
      toast(`PDF export failed: ${(err as Error).message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sort === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setDir('desc');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!canView) {
    return (
      <div className="bg-white p-8 rounded-lg shadow text-center text-gray-600">
        Restricted page — Admin / Super Admin only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">
          Admin Deposit Report
        </h1>
        <div className="flex gap-2">
          <button
            onClick={handleExportExcel}
            disabled={exporting}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
          <button
            onClick={handleExportPdf}
            disabled={exporting}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <FileText className="h-4 w-4 mr-2" />
            Export PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Total Deposited"
          value={formatCurrency(num(summary?.total_amount ?? 0))}
          sublabel="For selected filters / date range"
          tone="positive"
        />
        <SummaryCard
          label="Deposit Count"
          value={String(summary?.count ?? total)}
          sublabel="Matching records"
        />
        <SummaryCard
          label="Administrators"
          value={String(admins.length)}
          sublabel="Who have made deposits"
        />
      </div>

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
        onClear={() => {
          setAdminName('');
          setPhone('');
          setSearch('');
          setMinAmount('');
          setMaxAmount('');
          setStartDate(() => {
            const d = new Date();
            d.setDate(d.getDate() - 30);
            return d;
          });
          setEndDate(new Date());
        }}
      />

      {/* Sort controls */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500 inline-flex items-center">
          <ArrowUpDown className="h-4 w-4 mr-1" /> Sort by:
        </span>
        {([
          ['date', 'Date'],
          ['amount', 'Amount'],
          ['admin', 'Administrator'],
        ] as Array<[SortKey, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => toggleSort(key)}
            className={`px-3 py-1 rounded-md border ${
              sort === key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {label}
            {sort === key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow">
        {loading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No admin deposits found for the selected filters.
          </div>
        ) : (
          <DataTable columns={columns} data={rows} />
        )}

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
            <span>
              Showing {page * PAGE_SIZE + 1}–
              {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
                className="inline-flex items-center px-3 py-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </button>
              <span className="px-2">
                Page {page + 1} / {totalPages}
              </span>
              <button
                onClick={() =>
                  setPage((p) => (p + 1 < totalPages ? p + 1 : p))
                }
                disabled={page + 1 >= totalPages || loading}
                className="inline-flex items-center px-3 py-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'positive' | 'negative';
}) {
  const cls =
    tone === 'positive'
      ? 'text-green-700'
      : tone === 'negative'
      ? 'text-red-700'
      : 'text-gray-900';
  return (
    <div className="bg-white p-4 rounded-lg shadow-sm">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className={`text-2xl font-semibold ${cls}`}>{value}</p>
      {sublabel && <p className="text-xs text-gray-500 mt-1">{sublabel}</p>}
    </div>
  );
}

export default AdminDepositReport;
