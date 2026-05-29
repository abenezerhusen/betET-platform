import React, { useMemo, useState } from 'react';
import { z } from 'zod';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { UserPlus } from 'lucide-react';
import { UserActions } from '../../components/UserActions';
import { EditUserModal } from '../../components/EditUserModal';
import { PasswordChangeModal } from '../../components/PasswordChangeModal';
import { StatusToggleModal } from '../../components/StatusToggleModal';
import { RoleSettingsModal } from '../../components/RoleSettingsModal';
import { AgentWalletModal } from '../../components/AgentWalletModal';
import { PermissionsSelector } from '../../components/PermissionsSelector';
import { toast } from '../../lib/toast';
import { useAdminUsersByRole } from '../../lib/hooks';
import * as usersApi from '../../lib/api/users';
import type { AdminUser } from '../../lib/api/types';
import { toNumber } from '../../lib/format';

interface AgentData {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  type: string;
  channel: string;
  minStake: number;
  prepaidWallet: number;
  creditLimit: number;
  onlineStatus: string;
  status: string;
  branch: string;
}

function toRow(u: AdminUser): AgentData {
  const md = (u.metadata ?? {}) as Record<string, unknown>;
  return {
    id: u.id,
    firstName: String(md.first_name ?? '') || (u.email ? u.email.split('@')[0] : ''),
    lastName: String(md.last_name ?? ''),
    username: String(md.username ?? u.email ?? u.phone ?? u.id),
    email: u.email ?? '',
    phone: u.phone ?? '',
    type: String(md.agent_type ?? 'Regular'),
    channel: String(md.channel ?? 'Retail'),
    minStake: toNumber(md.min_stake as string | number | undefined),
    prepaidWallet: toNumber(md.prepaid_wallet as string | number | undefined),
    creditLimit: toNumber(md.credit_limit as string | number | undefined),
    onlineStatus: u.last_login_at ? 'Online' : 'Offline',
    status:
      u.status === 'active'
        ? 'Active'
        : u.status === 'suspended'
          ? 'Suspended'
          : 'Inactive',
    branch: String(md.branch ?? ''),
  };
}

const tabs = [
  { id: 'list', label: 'Agent List' },
  { id: 'add', label: 'Add Agent' },
];

const createAgentSchema = z
  .object({
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    username: z.string().trim().optional(),
    email: z.string().trim().email().optional().or(z.literal('')),
    phone: z.string().trim().min(8).optional().or(z.literal('')),
    agentType: z.enum(['regular', 'pos']),
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

export function Agents() {
  const [activeTab, setActiveTab] = useState('list');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedAgent, setSelectedAgent] = useState<AgentData | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [newAgentPermissions, setNewAgentPermissions] = useState<string[]>([]);
  const [formState, setFormState] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    phone: '',
    agentType: 'regular',
    password: '',
    confirmPassword: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const { items: backend, reload, loading } = useAdminUsersByRole('agent', {
    pollIntervalMs: 30000,
  });
  const rows = useMemo(() => backend.map(toRow), [backend]);
  const findAgent = (id: string) => rows.find((a) => a.id === id);

  const handleEdit = (id: string) => {
    const agent = findAgent(id);
    if (agent) {
      setSelectedAgent(agent);
      setIsEditModalOpen(true);
    }
  };

  const handleChangePassword = (id: string) => {
    const agent = findAgent(id);
    if (agent) {
      setSelectedAgent(agent);
      setIsPasswordModalOpen(true);
    }
  };

  const handleToggleStatus = (id: string) => {
    const agent = findAgent(id);
    if (agent) {
      setSelectedAgent(agent);
      setIsStatusModalOpen(true);
    }
  };

  const handleRoleSettings = (id: string) => {
    const agent = findAgent(id);
    if (agent) {
      setSelectedAgent(agent);
      setIsRoleModalOpen(true);
    }
  };

  const handleWallet = (id: string) => {
    const agent = findAgent(id);
    if (agent) {
      setSelectedAgent(agent);
      setIsWalletModalOpen(true);
    }
  };

  const submitCreate = async () => {
    if (submitting) return;
    const parsed = createAgentSchema.safeParse(formState);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid agent form';
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
        role: 'agent',
        metadata: {
          first_name: parsed.data.firstName,
          last_name: parsed.data.lastName,
          username: parsed.data.username,
          agent_type: parsed.data.agentType,
          permissions: newAgentPermissions,
        },
      });
      toast('Agent created.');
      setFormState({
        firstName: '',
        lastName: '',
        username: '',
        email: '',
        phone: '',
        agentType: 'regular',
        password: '',
        confirmPassword: '',
      });
      setNewAgentPermissions([]);
      setActiveTab('list');
      reload();
    } catch (err) {
      toast(`Failed to create agent: ${(err as Error)?.message ?? err}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async (data: Record<string, unknown>) => {
    if (!selectedAgent) return;
    try {
      await usersApi.updateUser(selectedAgent.id, {
        email: (data.email as string | undefined) ?? undefined,
        phone: (data.phone as string | undefined) ?? undefined,
      });
      toast('Agent updated.');
      reload();
    } catch (err) {
      toast(`Failed to update agent: ${(err as Error)?.message ?? err}`);
    }
    setIsEditModalOpen(false);
  };

  const submitStatus = async () => {
    if (!selectedAgent) return;
    try {
      if (selectedAgent.status === 'Active') {
        await usersApi.suspendUser(selectedAgent.id, 'Admin panel action');
        toast('Agent deactivated.');
      } else {
        await usersApi.updateUser(selectedAgent.id, { status: 'active' });
        toast('Agent activated.');
      }
      reload();
    } catch (err) {
      toast(`Failed: ${(err as Error)?.message ?? err}`);
    }
    setIsStatusModalOpen(false);
  };

  const submitRoleAssign = async (permissions: string[]) => {
    if (!selectedAgent) return;
    try {
      await usersApi.assignPermissions(selectedAgent.id, permissions);
      toast(`Agent permissions updated (${permissions.length} enabled).`);
      reload();
    } catch (err) {
      toast(`Failed to update permissions: ${(err as Error)?.message ?? err}`);
    }
    setIsRoleModalOpen(false);
  };

  const filters = [
    {
      label: 'Type',
      options: ['Regular', 'POS'],
      value: selectedType,
      onChange: setSelectedType,
    },
    {
      label: 'Status',
      options: ['Active', 'Inactive', 'Suspended'],
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
  ];

  const columns = [
    { header: 'First Name', accessor: 'firstName' as const },
    { header: 'Last Name', accessor: 'lastName' as const },
    { header: 'Username', accessor: 'username' as const },
    { header: 'Email', accessor: 'email' as const },
    { header: 'Phone', accessor: 'phone' as const },
    { header: 'Type', accessor: 'type' as const },
    { header: 'Channel', accessor: 'channel' as const },
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
        <h1 className="text-2xl font-semibold text-gray-900">Agents</h1>
        {activeTab === 'list' && (
          <button
            onClick={() => setActiveTab('add')}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Add Agent
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
          />

          <div className="bg-white rounded-lg shadow">
            {loading && rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
            ) : (
              <DataTable columns={columns} data={rows} />
            )}
          </div>
        </>
      ) : (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-6">Add New Agent</h2>
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
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, firstName: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Last Name</label>
                <input
                  type="text"
                  value={formState.lastName}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, lastName: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Username</label>
                <input
                  type="text"
                  value={formState.username}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, username: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={formState.email}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, email: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Phone Number</label>
                <input
                  type="tel"
                  value={formState.phone}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, phone: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Agent Type</label>
                <select
                  value={formState.agentType}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, agentType: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="regular">Regular</option>
                  <option value="pos">POS</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">New Password</label>
                <input
                  type="password"
                  value={formState.password}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, password: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Repeat Password</label>
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

            <PermissionsSelector
              scope="Agent"
              value={newAgentPermissions}
              onChange={setNewAgentPermissions}
              defaultOpen={false}
              title="Permissions & Access (including P2P)"
              description="Select which sections this agent can use. P2P Access controls whether the agent can open the P2P dashboard and related queues."
            />

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setNewAgentPermissions([]);
                  setActiveTab('list');
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create Agent'}
              </button>
            </div>
          </form>
        </div>
      )}

      <EditUserModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSubmit={(data) => void submitEdit(data as Record<string, unknown>)}
        user={selectedAgent}
      />

      <PasswordChangeModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        onSubmit={async (data) => {
          if (!selectedAgent) return;
          await usersApi.changeUserPassword(selectedAgent.id, data.password);
          toast('Password updated; agent must log in again.');
        }}
        userId={selectedAgent?.id || ''}
      />

      <StatusToggleModal
        isOpen={isStatusModalOpen}
        onClose={() => setIsStatusModalOpen(false)}
        onConfirm={() => void submitStatus()}
        userType="Agent"
        currentStatus={selectedAgent?.status || 'Active'}
      />

      <RoleSettingsModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        onSave={(permissions) => void submitRoleAssign(permissions)}
        userType="Agent"
        currentPermissions={
          selectedAgent
            ? (((backend.find((u) => u.id === selectedAgent.id)?.metadata ?? {}) as Record<
                string,
                unknown
              >).permissions as string[] | undefined) ?? []
            : []
        }
      />

      <AgentWalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        agentData={
          selectedAgent
            ? {
                userId: selectedAgent.id,
                name: `${selectedAgent.firstName} ${selectedAgent.lastName}`.trim() ||
                  selectedAgent.username,
                balance: selectedAgent.prepaidWallet,
                branch: selectedAgent.branch,
              }
            : undefined
        }
        onSuccess={reload}
      />
    </div>
  );
}
