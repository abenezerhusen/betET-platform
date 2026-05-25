import React, { useEffect, useMemo, useState } from 'react';
import {
  Smartphone,
  Shield,
  Mail,
  RefreshCcw,
  Ban,
  Check,
  Clock,
  Users,
  Send,
  AlertTriangle,
} from 'lucide-react';
import { RoleSettingsModal } from '../../components/RoleSettingsModal';
import { toast } from '../../lib/toast';
import * as p2pApi from '../../lib/api/p2p';

type OperatorWithTokens = p2pApi.OperatorRow & {
  tokens?: Array<{
    id: string;
    token_tail?: string;
    expires_at?: string;
    revoked_at?: string | null;
    last_used_at?: string | null;
    delivered_to?: string | null;
    created_at?: string;
  }>;
};

function formatRelative(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatExpiry(iso?: string): string {
  if (!iso) return '—';
  const expMs = new Date(iso).getTime();
  if (Number.isNaN(expMs)) return '—';
  const diff = expMs - Date.now();
  if (diff <= 0) return 'expired';
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}

export function OperatorAccess() {
  const [rows, setRows] = useState<OperatorWithTokens[]>([]);
  const [walletNameById, setWalletNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [permsTarget, setPermsTarget] = useState<OperatorWithTokens | null>(null);
  const [editOwner, setEditOwner] = useState<OperatorWithTokens | null>(null);
  const [editForm, setEditForm] = useState({ ownerName: '', ownerEmail: '' });

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const load = async () => {
    setLoading(true);
    try {
      const [operatorsRes, walletsRes] = await Promise.all([
        p2pApi.listOperators({ page: 1, limit: 200, role: 'operator' }),
        p2pApi.listWalletDevices({ page: 1, limit: 200 }),
      ]);

      const walletMap: Record<string, string> = {};
      (walletsRes.items ?? []).forEach((w) => {
        walletMap[w.id] = w.device_name || w.agent_name || w.telebirr_number;
      });
      setWalletNameById(walletMap);

      const operators = operatorsRes.items ?? [];
      const hydrated = await Promise.all(
        operators.map(async (op) => {
          try {
            return await p2pApi.getOperator(op.id);
          } catch {
            return op;
          }
        })
      );
      setRows(hydrated as OperatorWithTokens[]);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load operator access data', 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const activeTokenByOperator = useMemo(() => {
    const map = new Map<string, NonNullable<OperatorWithTokens['tokens']>[number]>();
    const now = Date.now();
    for (const row of rows) {
      const tokens = (row.tokens ?? []).slice().sort((a, b) => {
        const ta = new Date(a.created_at ?? 0).getTime();
        const tb = new Date(b.created_at ?? 0).getTime();
        return tb - ta;
      });
      for (const t of tokens) {
        const expMs = t.expires_at ? new Date(t.expires_at).getTime() : 0;
        if (!t.revoked_at && expMs > now) {
          map.set(row.id, t);
          break;
        }
      }
    }
    return map;
  }, [rows]);

  const stats = useMemo(() => {
    let revoked = 0;
    rows.forEach((r) => {
      (r.tokens ?? []).forEach((t) => {
        if (t.revoked_at) revoked += 1;
      });
    });
    return {
      total: rows.length,
      activeLinks: activeTokenByOperator.size,
      revoked,
    };
  }, [rows, activeTokenByOperator]);

  const handleCopy = async (token: string) => {
    const url = `${origin}/operator/dashboard?token=${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      toast('Failed to copy link', 'error');
    }
  };

  const handleSendLink = async (op: OperatorWithTokens) => {
    try {
      const res = await p2pApi.issueAccessToken(op.id, {
        ttl_hours: 24,
        delivered_to: op.email,
      });
      await handleCopy(res.token);
      toast('Access link issued', 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to issue token', 'error');
    }
  };

  const handleRotate = async (op: OperatorWithTokens) => {
    try {
      const res = await p2pApi.rotateAccessToken(op.id, {
        ttl_hours: 24,
        delivered_to: op.email,
      });
      await handleCopy(res.token);
      toast('Access link rotated', 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to rotate token', 'error');
    }
  };

  const handleRevoke = async (op: OperatorWithTokens) => {
    const active = activeTokenByOperator.get(op.id);
    if (!active) return;
    try {
      await p2pApi.revokeAccessToken(active.id);
      toast('Access token revoked', 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to revoke token', 'error');
    }
  };

  const handleSaveOwner = async () => {
    if (!editOwner) return;
    try {
      await p2pApi.updateOperator(editOwner.id, {
        name: editForm.ownerName.trim() || editOwner.name,
        email: editForm.ownerEmail.trim() || editOwner.email,
      });
      toast('Operator updated', 'success');
      setEditOwner(null);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to update operator', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Shield className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Operator Access</h1>
            <p className="text-sm text-gray-500">
              Send secure dashboard links and manage per-operator permissions.
            </p>
          </div>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50"
        >
          <RefreshCcw size={14} className="mr-1.5" />
          Refresh
        </button>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start space-x-2">
        <Shield className="h-4 w-4 text-blue-700 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-blue-900 leading-relaxed">
          Access links are issued and validated server-side. Tokens are operator-scoped,
          expire automatically, and can be revoked at any time.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Smartphone className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">SIM Operators</p>
              <p className="text-xl font-semibold">{stats.total}</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <Check className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Active Links</p>
              <p className="text-xl font-semibold">{stats.activeLinks}</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-purple-50 rounded-lg">
              <Mail className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Link Delivery</p>
              <p className="text-xl font-semibold">API</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-red-50 rounded-lg">
              <Ban className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Revoked</p>
              <p className="text-xl font-semibold">{stats.revoked}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">SIM Owners & Access Links</h2>
          <div className="flex items-center text-xs text-gray-500 space-x-1">
            <Users size={14} />
            <span>{rows.length} operators</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  SIM
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Owner
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Access Link
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Used
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Dashboard Perms
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {!loading &&
                rows.map((op) => {
                  const active = activeTokenByOperator.get(op.id);
                  const perms = Array.isArray(op.permissions) ? op.permissions : [];
                  const allowedCount = perms.length;
                  const assigned = op.assigned_agent_ids ?? [];
                  const deviceName =
                    assigned.map((id) => walletNameById[id] ?? id).slice(0, 2).join(', ') ||
                    'Unassigned';
                  return (
                    <tr key={op.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center space-x-2">
                          <Smartphone size={14} className="text-blue-600" />
                          <span className="font-medium text-gray-900">{deviceName}</span>
                        </div>
                        <div className="text-xs text-gray-500 font-mono">{op.id.slice(0, 8)}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{op.name}</td>
                      <td className="px-6 py-4 text-sm">
                        <button
                          onClick={() => {
                            setEditOwner(op);
                            setEditForm({
                              ownerName: op.name,
                              ownerEmail: op.email,
                            });
                          }}
                          className="text-gray-700 hover:text-blue-600 hover:underline"
                        >
                          {op.email}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {active ? (
                          <div className="flex items-center space-x-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              <Check size={10} className="mr-1" />
                              Active
                            </span>
                            <span className="inline-flex items-center text-xs text-gray-500">
                              <Clock size={10} className="mr-1" />
                              {formatExpiry(active.expires_at)}
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            No active link
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {formatRelative(active?.last_used_at)}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          {allowedCount} enabled
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-right">
                        <div className="inline-flex items-center space-x-1">
                          <button
                            onClick={() => void handleSendLink(op)}
                            title="Send access link"
                            className="inline-flex items-center px-2 py-1 border border-transparent rounded text-xs font-medium text-white bg-blue-600 hover:bg-blue-700"
                          >
                            <Send size={12} className="mr-1" />
                            Send Link
                          </button>
                          {active && (
                            <>
                              <button
                                onClick={() => void handleRotate(op)}
                                title="Rotate token"
                                className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
                              >
                                <RefreshCcw size={14} />
                              </button>
                              <button
                                onClick={() => void handleRevoke(op)}
                                title="Revoke link"
                                className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                              >
                                <Ban size={14} />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => setPermsTarget(op)}
                            title="Dashboard permissions"
                            className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
                          >
                            <Shield size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-gray-500">
                    No operators found.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-gray-500">
                    Loading operator access...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {permsTarget && (
        <RoleSettingsModal
          isOpen={!!permsTarget}
          onClose={() => setPermsTarget(null)}
          userType="Operator"
          currentPermissions={Array.isArray(permsTarget.permissions) ? permsTarget.permissions : []}
          onSave={(perms) =>
            void (async () => {
              try {
                await p2pApi.setOperatorPermissions(permsTarget.id, { permissions: perms });
                toast('Permissions updated', 'success');
                setPermsTarget(null);
                await load();
              } catch (err) {
                toast(
                  err instanceof Error ? err.message : 'Failed to update permissions',
                  'error'
                );
              }
            })()
          }
        />
      )}

      {editOwner && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Edit Owner</h3>
              <button
                onClick={() => setEditOwner(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Owner name</label>
                <input
                  type="text"
                  value={editForm.ownerName}
                  onChange={(e) => setEditForm({ ...editForm, ownerName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Owner email</label>
                <input
                  type="email"
                  value={editForm.ownerEmail}
                  onChange={(e) => setEditForm({ ...editForm, ownerEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3 flex items-start space-x-2">
                <AlertTriangle className="h-4 w-4 text-yellow-700 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-yellow-900">
                  Updating email does not automatically resend link. Click
                  &quot;Send Link&quot; afterwards to issue a fresh one.
                </p>
              </div>
            </div>
            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setEditOwner(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSaveOwner()}
                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
