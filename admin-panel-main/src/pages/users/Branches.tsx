import React, { useMemo, useState } from 'react';
import { z } from 'zod';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { Building, UserPlus } from 'lucide-react';
import { CountBadge } from '../../components/CountBadge';
import { UserActions } from '../../components/UserActions';
import { BranchWalletModal } from '../../components/BranchWalletModal';
import { EditUserModal } from '../../components/EditUserModal';
import { PasswordChangeModal } from '../../components/PasswordChangeModal';
import { StatusToggleModal } from '../../components/StatusToggleModal';
import { RoleSettingsModal } from '../../components/RoleSettingsModal';
import { toast } from '../../lib/toast';
import { useAdminUsersByRole } from '../../lib/hooks';
import * as usersApi from '../../lib/api/users';
import type { AdminUser } from '../../lib/api/types';
import { toNumber } from '../../lib/format';

interface BranchData {
  id: string;
  branchId: string;
  city: string;
  agent: string;
  address: string;
  channel: string;
  minStake: number;
  onlineStatus: string;
  offlineBetLimit: number;
  depositLimit: number;
  duplicateBetLimit: number;
  status: string;
  balance: number;
  operatingHours: {
    start: string;
    end: string;
  };
}

function toRow(u: AdminUser): BranchData {
  const md = (u.metadata ?? {}) as Record<string, unknown>;
  const oh = (md.operating_hours ?? {}) as { start?: string; end?: string };
  const limits = (md.limits ?? {}) as Record<string, unknown>;
  return {
    id: u.id,
    branchId: String(md.branch_id ?? u.id.slice(0, 8)),
    city: String(md.city ?? ''),
    agent: String(md.agent_name ?? ''),
    address: String(md.address ?? ''),
    channel: String(md.channel ?? 'Regular'),
    minStake: toNumber(md.min_stake as string | number | undefined),
    onlineStatus: u.last_login_at ? 'Online' : 'Offline',
    offlineBetLimit: toNumber(limits.offline_bet as string | number | undefined),
    depositLimit: toNumber(limits.deposit as string | number | undefined),
    duplicateBetLimit: toNumber(limits.duplicate_bet as string | number | undefined),
    status:
      u.status === 'active'
        ? 'Active'
        : u.status === 'suspended'
          ? 'Suspended'
          : 'Inactive',
    balance: toNumber(md.balance as string | number | undefined),
    operatingHours: {
      start: oh.start ?? '09:00',
      end: oh.end ?? '17:00',
    },
  };
}

const tabs = [
  { id: 'list', label: 'Branch List' },
  { id: 'add', label: 'Add Branch' },
];

const createBranchSchema = z.object({
  branchId: z.string().trim().min(2, 'Branch ID is required'),
  city: z.string().trim().min(2, 'City is required'),
  agentId: z.string().uuid('Agent is required'),
  branchSecret: z.string().min(8, 'Branch Secret must be at least 8 characters'),
  address: z.string().trim().min(5, 'Address is required'),
  channel: z.enum(['regular', 'premium']),
  minStake: z.string().refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, {
    message: 'Min Stake must be a valid non-negative number',
  }),
});

export function Branches() {
  const [activeTab, setActiveTab] = useState('list');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<BranchData | null>(null);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [formState, setFormState] = useState({
    branchId: '',
    city: '',
    agentId: '',
    branchSecret: '',
    address: '',
    channel: 'regular',
    minStake: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const { items: backend, reload, loading } = useAdminUsersByRole('branch', {
    pollIntervalMs: 30000,
  });
  const { items: agentUsers } = useAdminUsersByRole('agent', {
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
  const findBranch = (id: string) => rows.find((b) => b.id === id);

  const handleEdit = (id: string) => {
    const branch = findBranch(id);
    if (branch) {
      setSelectedBranch(branch);
      setIsEditModalOpen(true);
    }
  };

  const handleWallet = (id: string) => {
    const branch = findBranch(id);
    if (branch) {
      setSelectedBranch(branch);
      setIsWalletModalOpen(true);
    }
  };

  const handleChangePassword = (id: string) => {
    const branch = findBranch(id);
    if (branch) {
      setSelectedBranch(branch);
      setIsPasswordModalOpen(true);
    }
  };

  const handleToggleStatus = (id: string) => {
    const branch = findBranch(id);
    if (branch) {
      setSelectedBranch(branch);
      setIsStatusModalOpen(true);
    }
  };

  const handleRoleSettings = (id: string) => {
    const branch = findBranch(id);
    if (branch) {
      setSelectedBranch(branch);
      setIsRoleModalOpen(true);
    }
  };

  const submitCreate = async () => {
    if (submitting) return;
    const parsed = createBranchSchema.safeParse(formState);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid branch form';
      setFormError(msg);
      toast(msg);
      return;
    }
    setFormError('');
    setSubmitting(true);
    try {
      await usersApi.createUser({
        email: `${parsed.data.branchId}@${parsed.data.city}.local`,
        password: parsed.data.branchSecret,
        role: 'branch',
        metadata: {
          branch_id: parsed.data.branchId,
          city: parsed.data.city,
          agent_id: parsed.data.agentId,
          agent_name:
            agentOptions.find((a) => a.id === parsed.data.agentId)?.label ?? '',
          address: parsed.data.address,
          channel: parsed.data.channel,
          min_stake: Number(parsed.data.minStake) || 0,
        },
      });
      toast('Branch created.');
      setFormState({
        branchId: '',
        city: '',
        agentId: '',
        branchSecret: '',
        address: '',
        channel: 'regular',
        minStake: '',
      });
      setActiveTab('list');
      reload();
    } catch (err) {
      toast(`Failed to create branch: ${(err as Error)?.message ?? err}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async (data: Record<string, unknown>) => {
    if (!selectedBranch) return;
    try {
      await usersApi.updateUser(selectedBranch.id, {
        email: (data.email as string | undefined) ?? undefined,
        phone: (data.phone as string | undefined) ?? undefined,
      });
      toast('Branch updated.');
      reload();
    } catch (err) {
      toast(`Failed to update branch: ${(err as Error)?.message ?? err}`);
    }
    setIsEditModalOpen(false);
  };

  const submitStatus = async () => {
    if (!selectedBranch) return;
    try {
      if (selectedBranch.status === 'Active') {
        await usersApi.suspendUser(selectedBranch.id, 'Admin panel action');
        toast('Branch deactivated.');
      } else {
        await usersApi.updateUser(selectedBranch.id, { status: 'active' });
        toast('Branch activated.');
      }
      reload();
    } catch (err) {
      toast(`Failed: ${(err as Error)?.message ?? err}`);
    }
    setIsStatusModalOpen(false);
  };

  const submitRoleAssign = async (permissions: string[]) => {
    if (!selectedBranch) return;
    try {
      await usersApi.assignPermissions(selectedBranch.id, permissions);
      toast(`Branch permissions updated (${permissions.length} enabled).`);
      reload();
    } catch (err) {
      toast(`Failed to update permissions: ${(err as Error)?.message ?? err}`);
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
      label: 'City',
      options: Array.from(new Set(rows.map((r) => r.city).filter(Boolean))),
      value: selectedCity,
      onChange: setSelectedCity,
    },
  ];

  const filteredRows = rows.filter((r) => {
    if (selectedAgent && r.agent !== selectedAgent) return false;
    if (selectedCity && r.city !== selectedCity) return false;
    return true;
  });

  const handleClearFilters = () => {
    setSelectedAgent('');
    setSelectedCity('');
    setStartDate(new Date());
    setEndDate(new Date());
  };

  // Total + per-status counts for the header badge.
  const counts = useMemo(() => {
    const active = rows.filter((r) => r.status === 'Active').length;
    const suspended = rows.filter((r) => r.status === 'Suspended').length;
    const inactive = rows.filter((r) => r.status === 'Inactive').length;
    return { total: rows.length, active, suspended, inactive };
  }, [rows]);

  const columns = [
    { header: 'Branch ID', accessor: 'branchId' as const },
    { header: 'City', accessor: 'city' as const },
    { header: 'Agent', accessor: 'agent' as const },
    { header: 'Address', accessor: 'address' as const },
    { header: 'Channel', accessor: 'channel' as const },
    { header: 'Min Stake', accessor: 'minStake' as const },
    { header: 'Status', accessor: 'status' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      className: 'w-40',
      render: (value: string) => (
        <UserActions
          userId={value}
          onEdit={handleEdit}
          onChangePassword={handleChangePassword}
          onToggleStatus={handleToggleStatus}
          onRoleSettings={handleRoleSettings}
          onWallet={handleWallet}
          showRoleSettings={true}
          showWallet={true}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Building className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Branches</h1>
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
        {activeTab === 'list' && (
          <button
            onClick={() => setActiveTab('add')}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Add Branch
          </button>
        )}
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

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

          <div className="bg-white rounded-lg shadow">
            {loading && rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
            ) : (
              <DataTable columns={columns} data={filteredRows} />
            )}
          </div>
        </>
      ) : (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-6">Add New Branch</h2>
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
                <label className="block text-sm font-medium text-gray-700">Branch ID</label>
                <input
                  type="text"
                  value={formState.branchId}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, branchId: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">City</label>
                <input
                  type="text"
                  value={formState.city}
                  onChange={(e) => setFormState((s) => ({ ...s, city: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Agent</label>
                <select
                  value={formState.agentId}
                  disabled={agentOptions.length === 0}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, agentId: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {agentOptions.length === 0
                      ? 'No agents \u2014 create an Agent first'
                      : 'Select Agent'}
                  </option>
                  {agentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {agentOptions.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    A Branch must belong to an Agent. Create an Agent on the
                    Agents page first, then come back here.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Branch Secret</label>
                <input
                  type="password"
                  value={formState.branchSecret}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, branchSecret: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Address</label>
                <input
                  type="text"
                  value={formState.address}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, address: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Channel</label>
                <select
                  value={formState.channel}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, channel: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="regular">Regular</option>
                  <option value="premium">Premium</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Min Stake</label>
                <input
                  type="number"
                  value={formState.minStake}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, minStake: e.target.value }))
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
                {submitting ? 'Creating…' : 'Create Branch'}
              </button>
            </div>
          </form>
        </div>
      )}

      <BranchWalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        branchId={selectedBranch?.id}
        branchData={selectedBranch ? {
          name: selectedBranch.branchId,
          balance: selectedBranch.balance,
          operatingHours: selectedBranch.operatingHours,
          limits: {
            duplicateBetStake: selectedBranch.duplicateBetLimit,
            deposit: selectedBranch.depositLimit,
            offlineBet: selectedBranch.offlineBetLimit,
            minimumStake: selectedBranch.minStake,
          },
          status: selectedBranch.status
        } : undefined}
        onSuccess={reload}
      />

      <EditUserModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSubmit={(data) => void submitEdit(data as Record<string, unknown>)}
        user={selectedBranch}
      />

      <PasswordChangeModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        onSubmit={async (data) => {
          if (!selectedBranch) return;
          await usersApi.changeUserPassword(selectedBranch.id, data.password);
          toast('Password updated; branch must log in again.');
        }}
        userId={selectedBranch?.id || ''}
      />

      <StatusToggleModal
        isOpen={isStatusModalOpen}
        onClose={() => setIsStatusModalOpen(false)}
        onConfirm={() => void submitStatus()}
        userType="Branch"
        currentStatus={selectedBranch?.status || 'Active'}
      />

      <RoleSettingsModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        onSave={(permissions) => void submitRoleAssign(permissions)}
        userType="Branch"
        currentPermissions={
          selectedBranch
            ? (((backend.find((u) => u.id === selectedBranch.id)?.metadata ?? {}) as Record<
                string,
                unknown
              >).permissions as string[] | undefined) ?? []
            : []
        }
      />
    </div>
  );
}
