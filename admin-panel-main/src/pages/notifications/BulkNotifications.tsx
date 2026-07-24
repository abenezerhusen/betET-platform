import React, { useEffect, useState } from 'react';
import { Send, Megaphone, RefreshCw, Ban } from 'lucide-react';
import { TabGroup } from '../../components/TabGroup';
import { DataTable } from '../../components/DataTable';
import { toast } from '../../lib/toast';
import * as api from '../../lib/api/notificationsCenter';
import { useAuthStore } from '../../store/auth';

const tabs = [
  { id: 'compose', label: 'Compose' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'logs', label: 'Delivery Logs' },
];

const campaignColumns = [
  { header: 'Title', accessor: 'title' as const },
  { header: 'Audience', accessor: 'audience' as const },
  { header: 'Channel', accessor: 'channel' as const },
  { header: 'Category', accessor: 'category' as const },
  { header: 'Status', accessor: 'status' as const },
  { header: 'Recipients', accessor: 'total_recipients' as const },
  { header: 'Sent', accessor: 'sent_count' as const },
  { header: 'Failed', accessor: 'failed_count' as const },
  { header: 'Created', accessor: 'created' as const },
];

const logColumns = [
  { header: 'Channel', accessor: 'channel' as const },
  { header: 'Provider', accessor: 'provider' as const },
  { header: 'Category', accessor: 'category' as const },
  { header: 'Event', accessor: 'event_type' as const },
  { header: 'Recipient', accessor: 'recipient' as const },
  { header: 'Status', accessor: 'status' as const },
  { header: 'Error', accessor: 'error' as const },
  { header: 'Created', accessor: 'created' as const },
];

export function BulkNotifications() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('compose');

  // Compose state
  const [mode, setMode] = useState<'marketing' | 'system'>('marketing');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<api.BulkAudience>('all');
  const [userIds, setUserIds] = useState('');
  const [channel, setChannel] = useState<api.NotifChannel>('default');
  const [sending, setSending] = useState(false);

  const [campaigns, setCampaigns] = useState<Record<string, unknown>[]>([]);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const res = await api.listBulk({ limit: 50 });
      setCampaigns(
        (res.items ?? []).map((c) => ({
          ...c,
          created: c.created_at ? new Date(c.created_at).toLocaleString() : '—',
        }))
      );
    } catch (err) {
      toast(`Failed to load campaigns: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await api.listLogs({ limit: 100 });
      setLogs(
        (res.items ?? []).map((l) => ({
          ...l,
          provider: l.provider ?? '—',
          recipient: l.recipient ?? '—',
          error: l.error ?? '—',
          created: l.created_at ? new Date(l.created_at).toLocaleString() : '—',
        }))
      );
    } catch (err) {
      toast(`Failed to load logs: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuth) return;
    if (activeTab === 'campaigns') void loadCampaigns();
    if (activeTab === 'logs') void loadLogs();
  }, [isAuth, activeTab]);

  const submit = async () => {
    if (!message.trim()) {
      toast('Message is required.', 'error');
      return;
    }
    setSending(true);
    try {
      const ids =
        audience === 'selected'
          ? userIds
              .split(/[,\n\s]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      const payload: api.CreateBulkInput = {
        title: title.trim() || undefined,
        message: message.trim(),
        audience,
        user_ids: ids,
        channel,
      };
      const res =
        mode === 'system'
          ? await api.createSystemAnnouncement(payload)
          : await api.createBulk({ ...payload, category: 'marketing' });
      toast(
        `Queued to ${res.total_recipients} recipient(s). Status: ${res.status}.`,
        'success'
      );
      setTitle('');
      setMessage('');
      setUserIds('');
      setActiveTab('campaigns');
    } catch (err) {
      toast(`Send failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSending(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await api.cancelBulk(id);
      toast('Campaign cancelled.');
      void loadCampaigns();
    } catch (err) {
      toast(`Cancel failed: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Megaphone className="h-8 w-8 text-blue-600" />
        <h1 className="text-2xl font-semibold text-gray-900">Bulk & System Notifications</h1>
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'compose' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4 max-w-3xl">
          <p className="text-xs text-gray-500">
            Notifications are queued and delivered by the worker through the active provider
            (SMS / Telegram). Delivery status is tracked under the Campaigns and Delivery Logs
            tabs.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <label className="space-y-1">
              <span className="text-gray-700">Type</span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'marketing' | 'system')}
                className="w-full rounded-md border-gray-300"
              >
                <option value="marketing">Marketing / Promotional</option>
                <option value="system">System Announcement</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">Channel</span>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as api.NotifChannel)}
                className="w-full rounded-md border-gray-300"
              >
                <option value="default">Default provider</option>
                <option value="sms">SMS</option>
                <option value="telegram">Telegram Gateway</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">Audience</span>
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value as api.BulkAudience)}
                className="w-full rounded-md border-gray-300"
              >
                <option value="all">All Users</option>
                <option value="active">Active Users (last 30 days)</option>
                <option value="vip">VIP Users</option>
                <option value="selected">Selected Users</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">Title (optional)</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border-gray-300"
              />
            </label>
          </div>

          {audience === 'selected' && (
            <label className="space-y-1 block text-sm">
              <span className="text-gray-700">User IDs (comma / newline separated)</span>
              <textarea
                rows={3}
                value={userIds}
                onChange={(e) => setUserIds(e.target.value)}
                className="w-full rounded-md border-gray-300 font-mono text-xs"
              />
            </label>
          )}

          <label className="space-y-1 block text-sm">
            <span className="text-gray-700">Message</span>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-md border-gray-300"
              placeholder="Your message to users…"
            />
          </label>

          <div className="flex justify-end">
            <button
              onClick={() => void submit()}
              disabled={sending}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
            >
              <Send className="h-4 w-4 mr-2" />
              {sending ? 'Queuing…' : 'Queue & Send'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'campaigns' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={() => void loadCampaigns()}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </button>
          </div>
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <DataTable
              columns={[
                ...campaignColumns,
                {
                  header: 'Actions',
                  accessor: 'id' as const,
                  render: (_value: unknown, row: Record<string, unknown>) =>
                    ['queued', 'sending'].includes(String(row.status)) ? (
                      <button
                        onClick={() => void cancel(String(row.id))}
                        className="inline-flex items-center text-red-600 hover:text-red-800 text-sm"
                      >
                        <Ban className="h-4 w-4 mr-1" /> Cancel
                      </button>
                    ) : (
                      <span className="text-gray-400">—</span>
                    ),
                },
              ]}
              data={campaigns}
            />
          </div>
          {loading && <p className="text-sm text-gray-500">Loading…</p>}
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={() => void loadLogs()}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </button>
          </div>
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <DataTable columns={logColumns} data={logs} />
          </div>
          {loading && <p className="text-sm text-gray-500">Loading…</p>}
        </div>
      )}
    </div>
  );
}
