import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TabGroup } from '../../components/TabGroup';
import { Inbox, CheckCircle, XCircle, Clock, Send, Loader2 } from 'lucide-react';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import { listCommands } from '../../lib/api/p2p';

type CmdStatus = 'Pending' | 'Sent' | 'Executing' | 'Success' | 'Failed' | 'Cancelled';

interface CommandRow {
  id: string;
  device: string;
  type: string;
  status: CmdStatus;
  timestamp: string;
  reference: string;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

function mapCmdStatus(raw: string): CmdStatus {
  switch (raw) {
    case 'pending':
      return 'Pending';
    case 'sent':
      return 'Sent';
    case 'executing':
      return 'Executing';
    case 'success':
      return 'Success';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
}

function formatKind(kind: string): string {
  return kind
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function mapCommand(r: Record<string, unknown>): CommandRow {
  const id = String(r.id ?? '');
  const agentId = r.agent_id != null ? String(r.agent_id) : '—';
  const kind = String(r.kind ?? '—');
  const status = mapCmdStatus(String(r.status ?? ''));
  const created = r.created_at != null ? String(r.created_at) : '';
  const reference = r.reference != null && String(r.reference) !== '' ? String(r.reference) : '—';
  return {
    id,
    device: `${agentId.slice(0, 8)}…`,
    type: formatKind(kind),
    status,
    timestamp: created ? new Date(created).toLocaleString() : '—',
    reference,
  };
}

const tabs = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'executing', label: 'In Progress' },
  { id: 'success', label: 'Success' },
  { id: 'failed', label: 'Failed' },
];

const steps: Exclude<CmdStatus, 'Failed' | 'Cancelled'>[] = ['Pending', 'Sent', 'Executing', 'Success'];

function StatusPipeline({ status }: { status: CmdStatus }) {
  const isFailed = status === 'Failed' || status === 'Cancelled';
  const currentIdx = isFailed ? 2 : steps.indexOf(status as (typeof steps)[number]);

  return (
    <div className="flex items-center">
      {steps.map((step, idx) => {
        const isDone = !isFailed && idx <= currentIdx;
        const isCurrent = !isFailed && idx === currentIdx && status !== 'Success';
        return (
          <React.Fragment key={step}>
            <div
              className={`flex items-center justify-center h-6 w-6 rounded-full text-xs font-medium ${
                isFailed && idx === 2
                  ? 'bg-red-100 text-red-700'
                  : isDone
                  ? 'bg-blue-600 text-white'
                  : isCurrent
                  ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-200'
                  : 'bg-gray-100 text-gray-400'
              }`}
              title={step}
            >
              {isFailed && idx === 2 ? (
                <XCircle size={14} />
              ) : isDone ? (
                <CheckCircle size={14} />
              ) : isCurrent ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                idx + 1
              )}
            </div>
            {idx < steps.length - 1 && (
              <div className={`w-5 h-0.5 ${idx < currentIdx && !isFailed ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: CmdStatus }) {
  const map: Record<CmdStatus, { bg: string; text: string; icon: typeof Clock }> = {
    Pending: { bg: 'bg-gray-100', text: 'text-gray-700', icon: Clock },
    Sent: { bg: 'bg-blue-100', text: 'text-blue-800', icon: Send },
    Executing: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: Loader2 },
    Success: { bg: 'bg-green-100', text: 'text-green-800', icon: CheckCircle },
    Failed: { bg: 'bg-red-100', text: 'text-red-800', icon: XCircle },
    Cancelled: { bg: 'bg-gray-200', text: 'text-gray-800', icon: XCircle },
  };
  const { bg, text, icon: Icon } = map[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${bg} ${text}`}>
      <Icon size={12} className={`mr-1 ${status === 'Executing' ? 'animate-spin' : ''}`} />
      {status}
    </span>
  );
}

export function CommandsQueue() {
  const [activeTab, setActiveTab] = useState('all');
  const [rows, setRows] = useState<CommandRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listCommands({ page: 1, limit: 200 });
      setRows((res.items ?? []).map((x) => mapCommand(x as Record<string, unknown>)));
    } catch (e) {
      toast(errMsg(e), 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((c) => {
      if (activeTab === 'all') return true;
      if (activeTab === 'pending') return c.status === 'Pending';
      if (activeTab === 'executing') return c.status === 'Sent' || c.status === 'Executing';
      if (activeTab === 'success') return c.status === 'Success';
      if (activeTab === 'failed') return c.status === 'Failed' || c.status === 'Cancelled';
      return true;
    });
  }, [rows, activeTab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Inbox className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Commands Queue</h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Command Flow</h2>
          <p className="text-sm text-gray-500 mt-1">Pending → Sent → Executing → Success / Failed</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Agent / device
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Command</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reference</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                    Loading commands…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                    No commands for this filter.
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((cmd) => (
                  <tr key={cmd.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-500 font-mono">{cmd.id.slice(0, 8)}…</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{cmd.device}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{cmd.type}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{cmd.reference}</td>
                    <td className="px-6 py-4">
                      <StatusPipeline status={cmd.status} />
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <StatusBadge status={cmd.status} />
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{cmd.timestamp}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
