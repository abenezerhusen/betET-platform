import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, UserPlus, Shield, Eye, X } from 'lucide-react';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import { createOperator, listOperators, listWalletDevices, type OperatorRow } from '../../lib/api/p2p';

type UiRole = 'Admin' | 'Operator' | 'Client';

interface OperatorVM {
  id: string;
  name: string;
  email: string;
  role: UiRole;
  assignedAgentIds: string[];
  status: 'Active' | 'Suspended';
  lastLogin: string;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

function apiRoleToUi(role: OperatorRow['role']): UiRole {
  if (role === 'admin') return 'Admin';
  if (role === 'client') return 'Client';
  return 'Operator';
}

function uiRoleToApi(role: UiRole): OperatorRow['role'] {
  if (role === 'Admin') return 'admin';
  if (role === 'Client') return 'client';
  return 'operator';
}

function apiStatusToUi(s: OperatorRow['status']): OperatorVM['status'] {
  return s === 'suspended' ? 'Suspended' : 'Active';
}

function uiStatusToApi(s: OperatorVM['status']): OperatorRow['status'] {
  return s === 'Suspended' ? 'suspended' : 'active';
}

function vmFromApi(row: OperatorRow): OperatorVM {
  const login =
    row.last_login_at != null && row.last_login_at !== ''
      ? new Date(row.last_login_at).toLocaleString()
      : 'Never';
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: apiRoleToUi(row.role),
    assignedAgentIds: row.assigned_agent_ids ?? [],
    status: apiStatusToUi(row.status),
    lastLogin: login,
  };
}

const roleStyle: Record<UiRole, string> = {
  Admin: 'bg-purple-100 text-purple-800',
  Operator: 'bg-blue-100 text-blue-800',
  Client: 'bg-gray-100 text-gray-700',
};

const roleIcon: Record<UiRole, typeof Shield> = {
  Admin: Shield,
  Operator: Users,
  Client: Eye,
};

export function Operators() {
  const [roleFilter, setRoleFilter] = useState<'' | UiRole>('');
  const [operators, setOperators] = useState<OperatorVM[]>([]);
  const [agentLabelById, setAgentLabelById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  const emptyForm = {
    name: '',
    email: '',
    role: 'Operator' as UiRole,
    assignedAgentIds: [] as string[],
    status: 'Active' as OperatorVM['status'],
  };
  const [form, setForm] = useState(emptyForm);

  const loadAgents = useCallback(async () => {
    try {
      const res = await listWalletDevices({ page: 1, limit: 200 });
      const map: Record<string, string> = {};
      for (const w of res.items ?? []) {
        const id = String(w.id);
        const label =
          String(w.agent_name ?? '').trim() ||
          String(w.telebirr_number ?? '').trim() ||
          id.slice(0, 8);
        if (!map[id]) map[id] = label;
      }
      setAgentLabelById(map);
    } catch {
      setAgentLabelById({});
    }
  }, []);

  const loadOperators = useCallback(async () => {
    setLoading(true);
    try {
      const q =
        roleFilter === ''
          ? {}
          : { role: uiRoleToApi(roleFilter) as OperatorRow['role'] };
      const res = await listOperators({ ...q, page: 1, limit: 200 });
      setOperators((res.items ?? []).map(vmFromApi));
    } catch (e) {
      toast(errMsg(e), 'error');
      setOperators([]);
    } finally {
      setLoading(false);
    }
  }, [roleFilter]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    void loadOperators();
  }, [loadOperators]);

  const toggleAgent = (agentId: string) => {
    setForm((prev) => ({
      ...prev,
      assignedAgentIds: prev.assignedAgentIds.includes(agentId)
        ? prev.assignedAgentIds.filter((x) => x !== agentId)
        : [...prev.assignedAgentIds, agentId],
    }));
  };

  const agentOptions = useMemo(() => {
    return Object.entries(agentLabelById)
      .map(([agent_id, label]) => ({ agent_id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [agentLabelById]);

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) return;
    try {
      await createOperator({
        name: form.name.trim(),
        email: form.email.trim(),
        role: uiRoleToApi(form.role),
        status: uiStatusToApi(form.status),
        permissions: [],
        assigned_agent_ids: form.role === 'Operator' ? form.assignedAgentIds : [],
      });
      toast('Operator created.');
      setForm(emptyForm);
      setShowAddModal(false);
      await loadOperators();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const adminCount = operators.filter((o) => o.role === 'Admin').length;
  const operatorCount = operators.filter((o) => o.role === 'Operator').length;
  const clientCount = operators.filter((o) => o.role === 'Client').length;

  const renderAssignments = (ids: string[]) => {
    if (ids.length === 0) {
      return <span className="text-gray-400 text-xs">None</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <span key={id} className="inline-flex px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">
            {agentLabelById[id] ?? `${id.slice(0, 8)}…`}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Users className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Agents / Operators</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Add Operator
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-purple-50 rounded-lg">
              <Shield className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Admin (full access)</p>
              <p className="text-xl font-semibold">{loading ? '…' : adminCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Operator (transactions)</p>
              <p className="text-xl font-semibold">{loading ? '…' : operatorCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gray-100 rounded-lg">
              <Eye className="h-5 w-5 text-gray-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Client (read-only)</p>
              <p className="text-xl font-semibold">{loading ? '…' : clientCount}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Roles & Permissions</h2>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All roles</option>
            <option value="Admin">Admin</option>
            <option value="Operator">Operator</option>
            <option value="Client">Client</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Assigned agents
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Login</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                    Loading operators…
                  </td>
                </tr>
              )}
              {!loading &&
                operators.map((op) => {
                  const Icon = roleIcon[op.role];
                  const assignments =
                    op.role === 'Admin'
                      ? ['All wallets']
                      : op.role === 'Client'
                      ? ['Reports only']
                      : op.assignedAgentIds.map((id) => agentLabelById[id] ?? `${id.slice(0, 8)}…`);
                  return (
                    <tr key={op.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{op.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{op.email}</td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${roleStyle[op.role]}`}
                        >
                          <Icon size={12} className="mr-1" />
                          {op.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {op.role === 'Operator' ? (
                          renderAssignments(op.assignedAgentIds)
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {assignments.map((label, idx) => (
                              <span
                                key={`${op.id}-scope-${idx}`}
                                className="inline-flex px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            op.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {op.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{op.lastLogin}</td>
                    </tr>
                  );
                })}
              {!loading && operators.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                    No operators returned from the API.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
              <div className="flex items-center space-x-2">
                <UserPlus className="h-5 w-5 text-blue-600" />
                <h3 className="text-lg font-medium text-gray-900">Add Agent / Operator</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  setForm(emptyForm);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Samuel G."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="agent@betops.et"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <p className="text-xs text-gray-500">
                Operator login credentials are provisioned separately; this API stores the operator profile only.
              </p>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Role</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['Admin', 'Operator', 'Client'] as UiRole[]).map((r) => {
                    const Icon = roleIcon[r];
                    const active = form.role === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setForm({ ...form, role: r })}
                        className={`flex items-center justify-center px-3 py-2 border rounded-md text-sm font-medium ${
                          active
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon size={14} className="mr-1.5" />
                        {r}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-1.5">
                  {form.role === 'Admin' && 'Full access to all wallets, operators and settings.'}
                  {form.role === 'Operator' && 'Can process deposits/withdrawals on assigned wallet agents.'}
                  {form.role === 'Client' && 'Read-only access to their own reports.'}
                </p>
              </div>

              {form.role === 'Operator' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Assigned wallet agents</label>
                  <div className="flex flex-wrap gap-2">
                    {agentOptions.map((a) => {
                      const active = form.assignedAgentIds.includes(a.agent_id);
                      return (
                        <button
                          key={a.agent_id}
                          type="button"
                          onClick={() => toggleAgent(a.agent_id)}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                            active
                              ? 'border-blue-600 bg-blue-50 text-blue-700'
                              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {a.label}
                        </button>
                      );
                    })}
                  </div>
                  {agentOptions.length === 0 && (
                    <p className="text-xs text-gray-500 mt-1.5">
                      No wallet devices loaded — register agents first under Wallet Devices.
                    </p>
                  )}
                  {form.assignedAgentIds.length === 0 && agentOptions.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1.5">Select one or more agents this operator can manage.</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                <div className="inline-flex rounded-md shadow-sm" role="group">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, status: 'Active' })}
                    className={`px-4 py-1.5 text-sm font-medium border rounded-l-md ${
                      form.status === 'Active'
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, status: 'Suspended' })}
                    className={`px-4 py-1.5 text-sm font-medium border-t border-b border-r rounded-r-md ${
                      form.status === 'Suspended'
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Suspended
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg sticky bottom-0">
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  setForm(emptyForm);
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!form.name.trim() || !form.email.trim()}
                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Save Operator
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
