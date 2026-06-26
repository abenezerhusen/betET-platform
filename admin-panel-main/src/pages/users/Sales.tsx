import React, { useMemo, useState } from 'react';
import { z } from 'zod';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { UserPlus } from 'lucide-react';
import { CountBadge } from '../../components/CountBadge';
import { UserActions } from '../../components/UserActions';
import { UserDetailsModal } from '../../components/UserDetailsModal';
import { EditUserModal } from '../../components/EditUserModal';
import { PasswordChangeModal } from '../../components/PasswordChangeModal';
import { StatusToggleModal } from '../../components/StatusToggleModal';
import { RoleSettingsModal } from '../../components/RoleSettingsModal';
import { toast } from '../../lib/toast';
import { useAdminUsersByRole } from '../../lib/hooks';
import * as usersApi from '../../lib/api/users';
import type { AdminUser } from '../../lib/api/types';
import { toNumber } from '../../lib/format';
import { useAuthStore } from '../../store/auth';

interface SalesData {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  agent: string;
  branch: string;
  channel: string;
  firstLogin: string;
  lastLogin: string;
  betLimit: number;
  depositLimit: number;
  superSales: boolean;
  status: string;
}

function toRow(u: AdminUser): SalesData {
  const md = (u.metadata ?? {}) as Record<string, unknown>;
  return {
    id: u.id,
    firstName:
      String(md.first_name ?? '') || (u.email ? u.email.split('@')[0] : ''),
    lastName: String(md.last_name ?? ''),
    username: String(md.username ?? u.email ?? u.phone ?? u.id),
    email: u.email ?? '',
    phone: u.phone ?? '',
    agent: String(md.agent ?? ''),
    branch: String(md.branch ?? ''),
    channel: String(md.channel ?? 'Retail'),
    firstLogin: u.created_at ? new Date(u.created_at).toLocaleDateString() : '',
    lastLogin: u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '-',
    betLimit: toNumber(md.bet_limit as string | number | undefined),
    depositLimit: toNumber(md.deposit_limit as string | number | undefined),
    superSales: Boolean(md.super_sales),
    status:
      u.status === 'active'
        ? 'Active'
        : u.status === 'suspended'
          ? 'Suspended'
          : 'Inactive',
  };
}

const tabs = [
  { id: 'list', label: 'Sales List' },
  { id: 'add', label: 'Add Sales' },
];

const createSalesSchema = z
  .object({
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    username: z.string().trim().optional(),
    email: z.string().trim().email().optional().or(z.literal('')),
    phone: z.string().trim().min(8).optional().or(z.literal('')),
    agentId: z.string().uuid('Agent is required'),
    branchId: z.string().uuid('Branch is required'),
    channel: z.enum(['retail', 'online']),
    password: z.string().min(8, 'Password must be at least 8 characters').optional().or(z.literal('')),
    confirmPassword: z.string().optional().or(z.literal('')),
  })
  .refine((d) => Boolean((d.email ?? '').trim()) || Boolean((d.phone ?? '').trim()), {
    message: 'Email or phone is required.',
    path: ['email'],
  })
  .refine((d) => (!d.password && !d.confirmPassword) || d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export function Sales() {
  const [activeTab, setActiveTab] = useState('list');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedUser, setSelectedUser] = useState<SalesData | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');

  const [formState, setFormState] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    phone: '',
    agentId: '',
    branchId: '',
    channel: 'retail',
    password: '',
    confirmPassword: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const { items: backend, reload, loading } = useAdminUsersByRole('sales', {
    pollIntervalMs: 30000,
  });
  const { items: agentUsers } = useAdminUsersByRole('agent', {
    pollIntervalMs: 30000,
  });
  const { items: branchUsers } = useAdminUsersByRole('branch', {
    pollIntervalMs: 30000,
  });
  const rows = useMemo(() => backend.map(toRow), [backend]);
  const agentOptions = useMemo(
    () =>
      agentUsers.map((u) => ({
        id: u.id,
        label:
          String((u.metadata as Record<string, unknown> | undefined)?.username ?? '') ||
          u.email ||
          u.phone ||
          u.id,
      })),
    [agentUsers]
  );
  const branchOptions = useMemo(() => {
    const selectedAgentId = formState.agentId;
    return branchUsers
      .filter((b) => {
        if (!selectedAgentId) return true;
        const md = (b.metadata ?? {}) as Record<string, unknown>;
        return String(md.agent_id ?? '') === selectedAgentId;
      })
      .map((b) => {
        const md = (b.metadata ?? {}) as Record<string, unknown>;
        return {
          id: b.id,
          label:
            String(md.branch_id ?? '') ||
            String(md.city ?? '') ||
            b.email ||
            b.phone ||
            b.id,
        };
      });
  }, [branchUsers, formState.agentId]);
  const findUser = (id: string) => rows.find((u) => u.id === id);

  const handleViewDetails = (id: string) => {
    const u = findUser(id);
    if (u) {
      setSelectedUser(u);
      setIsDetailsModalOpen(true);
    }
  };
  const handleEdit = (id: string) => {
    const u = findUser(id);
    if (u) {
      setSelectedUser(u);
      setIsEditModalOpen(true);
    }
  };
  const handleChangePassword = (id: string) => {
    const u = findUser(id);
    if (u) {
      setSelectedUser(u);
      setIsPasswordModalOpen(true);
    }
  };
  const handleToggleStatus = (id: string) => {
    const u = findUser(id);
    if (u) {
      setSelectedUser(u);
      setIsStatusModalOpen(true);
    }
  };
  const handleRoleSettings = (id: string) => {
    const u = findUser(id);
    if (u) {
      setSelectedUser(u);
      setIsRoleModalOpen(true);
    }
  };

  const submitCreate = async () => {
    if (submitting) return;
    const parsed = createSalesSchema.safeParse(formState);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid sales form';
      setFormError(msg);
      toast(msg);
      return;
    }
    setFormError('');
    setSubmitting(true);
    try {
      await usersApi.createUser({
        email: parsed.data.email || undefined,
        phone: parsed.data.phone || undefined,
        password: parsed.data.password || undefined,
        role: 'sales',
        metadata: {
          first_name: parsed.data.firstName,
          last_name: parsed.data.lastName,
          username: parsed.data.username,
          agent_id: parsed.data.agentId,
          branch_id: parsed.data.branchId,
          agent:
            agentOptions.find((a) => a.id === parsed.data.agentId)?.label ?? '',
          branch:
            branchOptions.find((b) => b.id === parsed.data.branchId)?.label ?? '',
          channel: parsed.data.channel,
        },
      });
      toast('Sales staff created.');
      setFormState({
        firstName: '',
        lastName: '',
        username: '',
        email: '',
        phone: '',
        agentId: '',
        branchId: '',
        channel: 'retail',
        password: '',
        confirmPassword: '',
      });
      setActiveTab('list');
      reload();
    } catch (err) {
      toast(`Failed to create sales staff: ${(err as Error)?.message ?? err}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async (data: Record<string, unknown>) => {
    if (!selectedUser) return;
    try {
      await usersApi.updateUser(selectedUser.id, {
        email: (data.email as string | undefined) ?? undefined,
        phone: (data.phone as string | undefined) ?? undefined,
      });
      toast('Sales staff updated.');
      reload();
    } catch (err) {
      toast(`Failed: ${(err as Error)?.message ?? err}`);
    }
    setIsEditModalOpen(false);
  };

  const submitStatus = async () => {
    if (!selectedUser) return;
    try {
      if (selectedUser.status === 'Active') {
        await usersApi.suspendUser(selectedUser.id, 'Admin panel action');
        toast('Sales staff deactivated.');
      } else {
        await usersApi.updateUser(selectedUser.id, { status: 'active' });
        toast('Sales staff activated.');
      }
      reload();
    } catch (err) {
      toast(`Failed: ${(err as Error)?.message ?? err}`);
    }
    setIsStatusModalOpen(false);
  };

  const submitRoleAssign = async (permissions: string[]) => {
    if (!selectedUser) return;
    try {
      await usersApi.assignPermissions(selectedUser.id, permissions);
      toast(`Sales staff permissions updated (${permissions.length} enabled).`);
      reload();
    } catch (err) {
      toast(`Failed: ${(err as Error)?.message ?? err}`);
    }
    setIsRoleModalOpen(false);
  };

  const filters = [
    {
      label: 'Agent',
      options: Array.from(new Set(rows.map((r) => r.agent).filter(Boolean))),
      value: selectedAgent,
      onChange: setSelectedAgent,
    },
    {
      label: 'Branch',
      options: Array.from(new Set(rows.map((r) => r.branch).filter(Boolean))),
      value: selectedBranch,
      onChange: setSelectedBranch,
    },
    {
      label: 'Channel',
      options: Array.from(new Set(rows.map((r) => r.channel).filter(Boolean))),
      value: selectedChannel,
      onChange: setSelectedChannel,
    },
  ];

  const filteredRows = rows.filter((r) => {
    if (selectedAgent && r.agent !== selectedAgent) return false;
    if (selectedBranch && r.branch !== selectedBranch) return false;
    if (selectedChannel && r.channel !== selectedChannel) return false;
    return true;
  });

  const handleClearFilters = () => {
    setSelectedAgent('');
    setSelectedBranch('');
    setSelectedChannel('');
    setStartDate(new Date());
    setEndDate(new Date());
  };

  // Total + per-status counts for the header badge. Computed from the
  // unfiltered list so the totals reflect the whole tenant.
  const counts = useMemo(() => {
    const active = rows.filter((r) => r.status === 'Active').length;
    const suspended = rows.filter((r) => r.status === 'Suspended').length;
    const inactive = rows.filter((r) => r.status === 'Inactive').length;
    return { total: rows.length, active, suspended, inactive };
  }, [rows]);

  const columns = [
    { header: 'First Name', accessor: 'firstName' as const },
    { header: 'Last Name', accessor: 'lastName' as const },
    { header: 'Username', accessor: 'username' as const },
    { header: 'Email', accessor: 'email' as const },
    { header: 'Phone', accessor: 'phone' as const },
    { header: 'Agent', accessor: 'agent' as const },
    { header: 'Branch', accessor: 'branch' as const },
    { header: 'Status', accessor: 'status' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      className: 'w-32',
      render: (value: string) => (
        <UserActions
          userId={value}
          onView={handleViewDetails}
          onEdit={handleEdit}
          onChangePassword={handleChangePassword}
          onToggleStatus={handleToggleStatus}
          onRoleSettings={handleRoleSettings}
          showRoleSettings={true}
        />
      ),
    },
  ];

  const canManageSales = useAuthStore((s) => s.hasPermission('users.sales.manage'));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold text-gray-900">Sales Staff</h1>
          {activeTab === 'list' && (
            <CountBadge
              total={counts.total}
              loading={loading && rows.length === 0}
              breakdown={[
                { label: 'Active', value: counts.active, tone: 'green' },
                { label: 'Suspended', value: counts.suspended, tone: 'red' },
                { label: 'Inactive', value: counts.inactive, tone: 'gray' },
                ...(filteredRows.length !== rows.length
                  ? [{ label: 'Showing', value: filteredRows.length, tone: 'blue' as const }]
                  : []),
              ]}
            />
          )}
        </div>
        {activeTab === 'list' && canManageSales && (
          <button
            onClick={() => setActiveTab('add')}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Add Sales Staff
          </button>
        )}
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'list' ? (
        <>
          <FilterBar
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            filters={filters}
            onClear={handleClearFilters}
          />

          <div className="bg-white rounded-lg shadow overflow-hidden">
            {loading && rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
            ) : (
              <DataTable columns={columns} data={filteredRows} />
            )}
          </div>
        </>
      ) : (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-6">Add New Sales Staff</h2>
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCreate();
            }}
          >
            {formError && (
              <div className="p-2 text-sm rounded border border-red-200 bg-red-50 text-red-700">
                {formError}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">First Name</label>
                <input
                  type="text"
                  value={formState.firstName}
                  onChange={(e) => setFormState((s) => ({ ...s, firstName: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Last Name</label>
                <input
                  type="text"
                  value={formState.lastName}
                  onChange={(e) => setFormState((s) => ({ ...s, lastName: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Username</label>
                <input
                  type="text"
                  value={formState.username}
                  onChange={(e) => setFormState((s) => ({ ...s, username: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={formState.email}
                  onChange={(e) => setFormState((s) => ({ ...s, email: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Phone Number</label>
                <input
                  type="tel"
                  value={formState.phone}
                  onChange={(e) => setFormState((s) => ({ ...s, phone: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Agent</label>
                <select
                  value={formState.agentId}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, agentId: e.target.value, branchId: '' }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">Select Agent</option>
                  {agentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Branch</label>
                <select
                  value={formState.branchId}
                  disabled={!formState.agentId}
                  onChange={(e) => setFormState((s) => ({ ...s, branchId: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {formState.agentId
                      ? branchOptions.length === 0
                        ? 'This agent has no branches yet'
                        : 'Select Branch'
                      : 'Select Agent first'}
                  </option>
                  {branchOptions.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
                {formState.agentId && branchOptions.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    No branches are assigned to this agent yet. Create a Branch
                    under this Agent first, then come back here.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Channel</label>
                <select
                  value={formState.channel}
                  onChange={(e) => setFormState((s) => ({ ...s, channel: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="retail">Retail</option>
                  <option value="online">Online</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">New Password</label>
                <input
                  type="password"
                  value={formState.password}
                  onChange={(e) => setFormState((s) => ({ ...s, password: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Confirm Password</label>
                <input
                  type="password"
                  value={formState.confirmPassword}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, confirmPassword: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setActiveTab('list')}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create Sales Staff'}
              </button>
            </div>
          </form>
        </div>
      )}

      <UserDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        user={selectedUser}
      />

      <EditUserModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSubmit={(data) => void submitEdit(data as Record<string, unknown>)}
        user={selectedUser}
      />

      <PasswordChangeModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        onSubmit={async (data) => {
          if (!selectedUser) return;
          await usersApi.changeUserPassword(selectedUser.id, data.password);
          toast('Password updated; sales staff must log in again.');
        }}
        userId={selectedUser?.id || ''}
      />

      <StatusToggleModal
        isOpen={isStatusModalOpen}
        onClose={() => setIsStatusModalOpen(false)}
        onConfirm={() => void submitStatus()}
        userType="Sales Staff"
        currentStatus={selectedUser?.status || 'Active'}
      />

      <RoleSettingsModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        onSave={(permissions) => void submitRoleAssign(permissions)}
        userType="Sales Staff"
        currentPermissions={
          selectedUser
            ? (((backend.find((u) => u.id === selectedUser.id)?.metadata ?? {}) as Record<
                string,
                unknown
              >).permissions as string[] | undefined) ?? []
            : []
        }
      />
    </div>
  );
}
