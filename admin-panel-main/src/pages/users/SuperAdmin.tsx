import { useMemo, useState } from 'react';
import { z } from 'zod';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { Shield, UserPlus } from 'lucide-react';
import { UserActions } from '../../components/UserActions';
import { UserDetailsModal } from '../../components/UserDetailsModal';
import { EditUserModal } from '../../components/EditUserModal';
import { PasswordChangeModal } from '../../components/PasswordChangeModal';
import { StatusToggleModal } from '../../components/StatusToggleModal';
import { RoleSettingsModal } from '../../components/RoleSettingsModal';
import { PermissionsSelector } from '../../components/PermissionsSelector';
import { toast } from '../../lib/toast';
import { useAdminUsersByRole } from '../../lib/hooks';
import * as usersApi from '../../lib/api/users';
import { useAuthStore } from '../../store/auth';
import type { AdminUser } from '../../lib/api/types';

interface SuperAdminData {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  lastLogin: string;
  status: string;
  rawStatus: AdminUser['status'];
  permissions: string[];
}

const tabs = [
  { id: 'list', label: 'Super Admin List' },
  { id: 'add', label: 'Add Super Admin' },
];

const createSuperAdminSchema = z
  .object({
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    username: z.string().trim().min(2, 'Username is required'),
    email: z.string().trim().email().optional().or(z.literal('')),
    phone: z.string().trim().min(8).optional().or(z.literal('')),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => Boolean((d.email ?? '').trim()) || Boolean((d.phone ?? '').trim()), {
    message: 'Email or phone is required',
    path: ['email'],
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

function metaArray(meta: Record<string, unknown>, key: string): string[] {
  const v = meta[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function toRow(u: AdminUser): SuperAdminData {
  const md = (u.metadata ?? {}) as Record<string, unknown>;
  return {
    id: u.id,
    firstName: String(md.first_name ?? '') || (u.email ? u.email.split('@')[0] : ''),
    lastName: String(md.last_name ?? ''),
    username:
      String(md.username ?? '') || u.email || u.phone || u.id,
    email: u.email ?? '',
    phone: u.phone ?? '',
    lastLogin: u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '-',
    rawStatus: u.status,
    status:
      u.status === 'active'
        ? 'Active'
        : u.status === 'suspended'
          ? 'Suspended'
          : u.status,
    permissions: metaArray(md, 'permissions'),
  };
}

export function SuperAdmin() {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const currentRole = useAuthStore((s) => s.user?.role);
  const [activeTab, setActiveTab] = useState<'list' | 'add'>('list');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedUser, setSelectedUser] = useState<SuperAdminData | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [createPermissions, setCreatePermissions] = useState<string[]>([]);
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [createError, setCreateError] = useState('');

  // Spec: Super Admin only. Block other roles with a friendly message — the
  // backend will refuse the API calls anyway, but this hides the page UI
  // for clarity.
  const isSuperAdmin = currentRole === 'superadmin';

  const { items: backend, reload, loading } = useAdminUsersByRole('superadmin', {
    pollIntervalMs: 30000,
  });
  const rows = useMemo(() => backend.map(toRow), [backend]);
  const findUser = (id: string) => rows.find((u) => u.id === id);

  const handleViewDetails = (id: string) => {
    const user = findUser(id);
    if (user) {
      setSelectedUser(user);
      setIsDetailsModalOpen(true);
    }
  };

  const handleEdit = (id: string) => {
    const user = findUser(id);
    if (user) {
      setSelectedUser(user);
      setIsEditModalOpen(true);
    }
  };

  const handleChangePassword = (id: string) => {
    const user = findUser(id);
    if (user) {
      setSelectedUser(user);
      setIsPasswordModalOpen(true);
    }
  };

  const handleToggleStatus = (id: string) => {
    const user = findUser(id);
    if (!user) return;
    if (user.id === currentUserId) {
      toast('You cannot change the status of your own account.', 'error');
      return;
    }
    setSelectedUser(user);
    setIsStatusModalOpen(true);
  };

  const handleRoleSettings = (id: string) => {
    const user = findUser(id);
    if (user) {
      setSelectedUser(user);
      setIsRoleModalOpen(true);
    }
  };

  const submitCreate = async () => {
    if (submittingCreate) return;
    const parsed = createSuperAdminSchema.safeParse(createForm);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid Super Admin form';
      setCreateError(msg);
      return;
    }
    setCreateError('');
    setSubmittingCreate(true);
    try {
      await usersApi.createUser({
        email: parsed.data.email || undefined,
        phone: parsed.data.phone || undefined,
        password: parsed.data.password,
        role: 'superadmin',
        metadata: {
          first_name: parsed.data.firstName || null,
          last_name: parsed.data.lastName || null,
          username: parsed.data.username,
          permissions: createPermissions,
        },
      });
      toast('Super Admin created.');
      setCreateForm({
        firstName: '',
        lastName: '',
        username: '',
        email: '',
        phone: '',
        password: '',
        confirmPassword: '',
      });
      setCreatePermissions([]);
      setActiveTab('list');
      reload();
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      toast(`Failed to create Super Admin: ${msg}`, 'error');
    } finally {
      setSubmittingCreate(false);
    }
  };

  const submitEdit = async (data: Record<string, unknown>) => {
    if (!selectedUser) return;
    try {
      const md = (backend.find((u) => u.id === selectedUser.id)?.metadata ?? {}) as Record<
        string,
        unknown
      >;
      await usersApi.updateUser(selectedUser.id, {
        email: ((data.email as string | undefined) ?? '').trim() || null,
        phone: ((data.phone as string | undefined) ?? '').trim() || null,
        metadata: {
          ...md,
          first_name: ((data.firstName as string | undefined) ?? '').trim() || null,
          last_name: ((data.lastName as string | undefined) ?? '').trim() || null,
        },
      });
      toast('Super Admin saved.');
      reload();
    } catch (err) {
      toast(`Failed to save: ${(err as Error)?.message ?? err}`, 'error');
    }
    setIsEditModalOpen(false);
  };

  const submitStatus = async () => {
    if (!selectedUser) return;
    try {
      const next: usersApi.AdminUserStatus =
        selectedUser.rawStatus === 'active' ? 'suspended' : 'active';
      await usersApi.setUserStatus(selectedUser.id, next, 'Admin panel toggle');
      toast(
        next === 'active'
          ? 'Super Admin reactivated.'
          : 'Super Admin suspended; active sessions ended.'
      );
      reload();
    } catch (err) {
      toast(`Failed to update status: ${(err as Error)?.message ?? err}`, 'error');
    }
    setIsStatusModalOpen(false);
  };

  const submitChangePassword = async (data: { password: string }) => {
    if (!selectedUser) return;
    await usersApi.changeUserPassword(selectedUser.id, data.password);
    toast('Password updated; Super Admin must log in again.');
  };

  const submitRoleAssign = async (permissions: string[]) => {
    if (!selectedUser) return;
    try {
      await usersApi.assignPermissions(selectedUser.id, permissions);
      toast(`Super Admin permissions updated (${permissions.length} enabled).`);
      reload();
    } catch (err) {
      toast(`Failed to update permissions: ${(err as Error)?.message ?? err}`, 'error');
    }
    setIsRoleModalOpen(false);
  };

  const columns = [
    { header: 'First Name', accessor: 'firstName' as const },
    { header: 'Last Name', accessor: 'lastName' as const },
    { header: 'Username', accessor: 'username' as const },
    { header: 'Email', accessor: 'email' as const },
    { header: 'Phone', accessor: 'phone' as const },
    { header: 'Last Login', accessor: 'lastLogin' as const },
    {
      header: 'Status',
      accessor: 'status' as const,
      render: (value: string) => (
        <span
          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
            value === 'Active'
              ? 'bg-green-100 text-green-700'
              : value === 'Suspended'
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-700'
          }`}
        >
          {value}
        </span>
      ),
    },
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

  if (!isSuperAdmin) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <Shield className="h-10 w-10 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-900">Restricted Page</h2>
        <p className="text-sm text-gray-600 mt-1">
          Only Super Administrators can manage Super Admin accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Shield className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Super Admin Management</h1>
        </div>
        {activeTab === 'list' && (
          <button
            onClick={() => setActiveTab('add')}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Add Super Admin
          </button>
        )}
      </div>

      <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
        <div className="flex">
          <Shield className="h-5 w-5 text-blue-400" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">Super Admin Privileges</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>Super Administrators have full system access and can manage all users and settings.</p>
              <p className="mt-1">
                Super Admins cannot be deleted — only suspended. You cannot suspend your own account.
              </p>
            </div>
          </div>
        </div>
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as 'list' | 'add')}
      />

      {activeTab === 'list' ? (
        <>
          <FilterBar
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />

          <div className="bg-white rounded-lg shadow overflow-hidden">
            {loading && rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
            ) : (
              <DataTable columns={columns} data={rows} />
            )}
          </div>
        </>
      ) : (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-6">Add New Super Admin</h2>
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCreate();
            }}
          >
            {createError && (
              <div className="p-2 text-sm rounded border border-red-200 bg-red-50 text-red-700">
                {createError}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">First Name</label>
                <input
                  type="text"
                  value={createForm.firstName}
                  onChange={(e) => setCreateForm((s) => ({ ...s, firstName: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Last Name</label>
                <input
                  type="text"
                  value={createForm.lastName}
                  onChange={(e) => setCreateForm((s) => ({ ...s, lastName: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Username</label>
                <input
                  type="text"
                  value={createForm.username}
                  onChange={(e) => setCreateForm((s) => ({ ...s, username: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((s) => ({ ...s, email: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Phone Number</label>
                <input
                  type="tel"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm((s) => ({ ...s, phone: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">New Password</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((s) => ({ ...s, password: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Confirm Password</label>
                <input
                  type="password"
                  value={createForm.confirmPassword}
                  onChange={(e) =>
                    setCreateForm((s) => ({ ...s, confirmPassword: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <PermissionsSelector
              scope="Super Admin"
              value={createPermissions}
              onChange={setCreatePermissions}
              defaultOpen={false}
              title="Permissions & Access"
              description="Optional. Super Admins by default get every permission; use this to scope a delegated Super Admin."
            />

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setCreatePermissions([]);
                  setActiveTab('list');
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingCreate}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {submittingCreate ? 'Creating…' : 'Create Super Admin'}
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
        onSubmit={(data) => void submitEdit(data)}
        user={selectedUser}
        mode="admin"
        title="Edit Super Admin"
      />

      <PasswordChangeModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        onSubmit={submitChangePassword}
        userId={selectedUser?.id || ''}
      />

      <StatusToggleModal
        isOpen={isStatusModalOpen}
        onClose={() => setIsStatusModalOpen(false)}
        onConfirm={() => void submitStatus()}
        userType="Super Admin"
        currentStatus={selectedUser?.status || 'Active'}
      />

      <RoleSettingsModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        onSave={(permissions) => void submitRoleAssign(permissions)}
        userType="Super Admin"
        currentPermissions={selectedUser?.permissions ?? []}
      />
    </div>
  );
}
