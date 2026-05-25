import React, { useCallback, useEffect, useState } from 'react';
import { TabGroup } from '../../components/TabGroup';
import { FileText, MessageSquare, Terminal, AlertTriangle, Repeat, FileDown } from 'lucide-react';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import { listEventLogs } from '../../lib/api/p2p';

const tabs = [
  { id: 'sms', label: 'SMS Logs' },
  { id: 'ussd', label: 'USSD Execution' },
  { id: 'errors', label: 'Errors' },
  { id: 'switches', label: 'Wallet Switches' },
];

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

export function Logs() {
  const [activeTab, setActiveTab] = useState('sms');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'sms') {
        const [inRes, outRes] = await Promise.all([
          listEventLogs({ kind: 'sms_in', limit: 100, page: 1 }),
          listEventLogs({ kind: 'sms_out', limit: 100, page: 1 }),
        ]);
        const merged = [...(inRes.items ?? []), ...(outRes.items ?? [])].sort((a, b) => {
          const ta = new Date(String(a.created_at ?? 0)).getTime();
          const tb = new Date(String(b.created_at ?? 0)).getTime();
          return tb - ta;
        });
        setRows(merged.slice(0, 150));
      } else {
        let kind: 'ussd' | 'error' | 'wallet_switch';
        if (activeTab === 'ussd') kind = 'ussd';
        else if (activeTab === 'errors') kind = 'error';
        else kind = 'wallet_switch';
        const res = await listEventLogs({ kind, limit: 150, page: 1 });
        setRows(res.items ?? []);
      }
    } catch (e) {
      toast(errMsg(e), 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    void load();
  }, [load]);

  const fmtTime = (iso: unknown) =>
    iso ? new Date(String(iso)).toLocaleString() : '—';

  const handleExportLogs = () => {
    let columns: { header: string; accessor: keyof Record<string, unknown> | string }[] = [];
    let exportRows: Array<Record<string, unknown>> = [];
    let label = activeTab;

    const walletPlaceholder = (r: Record<string, unknown>) =>
      String(r.agent_id ?? r.tenant_id ?? '—');

    switch (activeTab) {
      case 'sms':
        columns = [
          { header: 'Time', accessor: 'created_at' },
          { header: 'Kind', accessor: 'kind' },
          { header: 'Wallet / Agent', accessor: 'agent_id' },
          { header: 'Message', accessor: 'message' },
        ];
        exportRows = rows.map((r) => ({
          created_at: fmtTime(r.created_at),
          kind: r.kind,
          agent_id: walletPlaceholder(r),
          message: r.message ?? r.code ?? '',
        }));
        label = 'sms-logs';
        break;
      case 'ussd':
        columns = [
          { header: 'Time', accessor: 'created_at' },
          { header: 'Device', accessor: 'agent_id' },
          { header: 'Message', accessor: 'message' },
          { header: 'Duration ms', accessor: 'duration_ms' },
        ];
        exportRows = rows.map((r) => ({
          created_at: fmtTime(r.created_at),
          agent_id: walletPlaceholder(r),
          message: r.message ?? r.code ?? '',
          duration_ms: r.duration_ms ?? '',
        }));
        label = 'ussd-logs';
        break;
      case 'errors':
        columns = [
          { header: 'Time', accessor: 'created_at' },
          { header: 'Source', accessor: 'agent_id' },
          { header: 'Code', accessor: 'code' },
          { header: 'Message', accessor: 'message' },
        ];
        exportRows = rows.map((r) => ({
          created_at: fmtTime(r.created_at),
          agent_id: walletPlaceholder(r),
          code: r.code ?? '',
          message: r.message ?? '',
        }));
        label = 'error-logs';
        break;
      case 'switches':
        columns = [
          { header: 'Time', accessor: 'created_at' },
          { header: 'Message', accessor: 'message' },
          { header: 'Code', accessor: 'code' },
        ];
        exportRows = rows.map((r) => ({
          created_at: fmtTime(r.created_at),
          message: r.message ?? '',
          code: r.code ?? '',
        }));
        label = 'wallet-switches';
        break;
    }

    if (exportRows.length === 0) {
      toast('No logs to export.', 'error');
      return;
    }
    downloadCsv(columns, exportRows, `${label}-${todayStamp()}`);
    toast(`Exported ${exportRows.length} rows.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <FileText className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Logs & Monitoring</h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 mr-2 disabled:opacity-50"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={handleExportLogs}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Export Logs
        </button>
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'sms' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center space-x-2">
            <MessageSquare className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-medium text-gray-900">SMS Events (`sms_in` / `sms_out`)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kind</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Agent</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading && (
                  <tr>
                    <td colSpan={4} className="px-6 py-6 text-center text-sm text-gray-500">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((r, i) => (
                    <tr key={String(r.id ?? i)}>
                      <td className="px-6 py-3 text-sm text-gray-600 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                      <td className="px-6 py-3 text-sm text-gray-900">{String(r.kind ?? '')}</td>
                      <td className="px-6 py-3 text-sm text-gray-600 font-mono text-xs">
                        {String(r.agent_id ?? '—')}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-900">{String(r.message ?? r.code ?? '')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'ussd' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center space-x-2">
            <Terminal className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-medium text-gray-900">USSD (`kind = ussd`)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Agent</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading && (
                  <tr>
                    <td colSpan={4} className="px-6 py-6 text-center text-sm text-gray-500">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((r, i) => (
                    <tr key={String(r.id ?? i)}>
                      <td className="px-6 py-3 text-sm text-gray-600 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                      <td className="px-6 py-3 text-sm text-gray-600 font-mono text-xs">{String(r.agent_id ?? '—')}</td>
                      <td className="px-6 py-3 text-sm text-gray-900">{String(r.message ?? r.code ?? '')}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{String(r.duration_ms ?? '—')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'errors' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <h2 className="text-lg font-medium text-gray-900">Errors (`kind = error`)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Agent</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading && (
                  <tr>
                    <td colSpan={4} className="px-6 py-6 text-center text-sm text-gray-500">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((r, i) => (
                    <tr key={String(r.id ?? i)}>
                      <td className="px-6 py-3 text-sm text-gray-600 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                      <td className="px-6 py-3 text-sm text-gray-600 font-mono text-xs">{String(r.agent_id ?? '—')}</td>
                      <td className="px-6 py-3 text-sm font-mono text-red-700">{String(r.code ?? '')}</td>
                      <td className="px-6 py-3 text-sm text-gray-900">{String(r.message ?? '')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'switches' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center space-x-2">
            <Repeat className="h-5 w-5 text-orange-600" />
            <h2 className="text-lg font-medium text-gray-900">Wallet switches (`wallet_switch`)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading && (
                  <tr>
                    <td colSpan={2} className="px-6 py-6 text-center text-sm text-gray-500">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((r, i) => (
                    <tr key={String(r.id ?? i)}>
                      <td className="px-6 py-3 text-sm text-gray-600 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                      <td className="px-6 py-3 text-sm text-gray-900">{String(r.message ?? r.code ?? '')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
