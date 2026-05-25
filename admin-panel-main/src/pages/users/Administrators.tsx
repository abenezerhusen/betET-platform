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

interface AdminData {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  expiryDate: string;
  role: string;
  rawStatus: AdminUser['status'];
  status: string;
  permissions: string[];
  lastLogin: string;
}

function metaArray(meta: Record<string, unknown>, key: string): string[] {
  const v = meta[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function toAdminRow(u: AdminUser): AdminData {
  const md = (u.metadata ?? {}) as Record<string, unknown>;
  const fn = String(md.first_name ?? '') || (u.email ? u.email.split('@')[0] : '') || '';
  const ln = String(md.last_name ?? '');
  return {
    id: u.id,
    firstName: fn,
    lastName: ln,
    username: String(md.username ?? '') || u.email || u.phone || u.id,
    email: u.email ?? '',
    phone: u.phone ?? '',
    expiryDate: typeof md.expires_at === 'string' ? md.expires_at.slice(0, 10) : '',
    role: u.role,
    rawStatus: u.status,
    status:
      u.status === 'active'
        ? 'Active'
        : u.status === 'suspended'
          ? 'Suspended'
          : u.status,
    permissions: metaArray(md, 'permissions'),
    lastLogin: u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '-',
  };
}

const tabs = [
  { id: 'list', label: 'Admin List' },
  { id: 'add', label: 'Add Admin' },
];

const createAdminSchema = z
  .object({
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    username: z.string().trim().optional(),
    email: z.string().trim().email().optional().or(z.literal('')),
    phone: z.string().trim().min(8).optional().or(z.literal('')),
    expiryDate: z.string().optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .optional()
      .or(z.literal('')),
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

export function Administrators() {
  const currentRole = useAuthStore((s) => s.user?.role);
  // Spec: Administrators page is Super Admin only.
  const isSuperAdmin = currentRole === 'superadmin';
  const [activeTab, setActiveTab] = useState('list');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedUser, setSelectedUser] = useState<AdminData | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  // Spec: this page manages Administrators only. Super Admins must be
  // created from the dedicated Super Admin page so the two lists stay
  // strictly separated. The role here is fixed to 'admin'.
  const newAdminRole: 'Administrator' = 'Administrator';
  const [newAdminPermissions, setNewAdminPermissions] = useState<string[]>([]);
  const [formState, setFormState] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    phone: '',
    expiryDate: '',
    password: '',
    confirmPassword: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const { items: backendAdmins, reload, loading } = useAdminUsersByRole('admin', {
    pollIntervalMs: 30000,
  });
  const adminRows = useMemo(() => backendAdmins.map(toAdminRow), [backendAdmins]);

  const findUser = (id: string) => adminRows.find((u) => u.id === id);

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
    if (user) {
      setSelectedUser(user);
      setIsStatusModalOpen(true);
    }
  };

  const handleRoleSettings = (id: string) => {
    const user = findUser(id);
    if (user) {
      setSelectedUser(user);
      setIsRoleModalOpen(true);
    }
  };

  const submitCreate = async () => {
    if (submitting) return;
    const parsed = createAdminSchema.safeParse(formState);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid administrator form';
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
        role: 'admin',
        metadata: {
          first_name: parsed.data.firstName,
          last_name: parsed.data.lastName,
          username: parsed.data.username,
          expires_at: parsed.data.expiryDate || null,
          permissions: newAdminPermissions,
        },
      });
      toast('Administrator created.');
      setFormState({
        firstName: '',
        lastName: '',
        username: '',
        email: '',
        phone: '',
        expiryDate: '',
        password: '',
        confirmPassword: '',
      });
      setNewAdminPermissions([]);
      setActiveTab('list');
      reload();
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      toast(`Failed to create administrator: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitStatus = async () => {
    if (!selectedUser) return;
    try {
      const next: usersApi.AdminUserStatus =
        selectedUser.rawStatus === 'active' ? 'suspended' : 'active';
      await usersApi.setUserStatus(selectedUser.id, next, 'Admin panel toggle');
      toast(
        next === 'active'
          ? 'Administrator reactivated.'
          : 'Administrator suspended; active sessions ended.'
      );
      reload();
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      toast(`Failed to update status: ${msg}`, 'error');
    }
    setIsStatusModalOpen(false);
  };

  const submitEdit = async (data: Record<string, unknown>) => {
    if (!selectedUser) return;
    try {
      const md = (backendAdmins.find((u) => u.id === selectedUser.id)?.metadata ?? {}) as Record<
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
      toast('Administrator updated.');
      reload();
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      toast(`Failed to update administrator: ${msg}`, 'error');
    }
    setIsEditModalOpen(false);
  };

  const submitChangePassword = async (data: { password: string }) => {
    if (!selectedUser) return;
    await usersApi.changeUserPassword(selectedUser.id, data.password);
    toast('Password updated; administrator must log in again.');
  };

  const submitRoleAssign = async (permissions: string[]) => {
    if (!selectedUser) return;
    try {
      // Preserve all other metadata while updating the permissions list.
      const md = (backendAdmins.find((u) => u.id === selectedUser.id)?.metadata ?? {}) as Record<
        string,
        unknown
      >;
      await usersApi.updateUser(selectedUser.id, {
        metadata: { ...md, permissions },
      });
      toast(`Permissions updated (${permissions.length} enabled).`);
      reload();
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      toast(`Failed to update permissions: ${msg}`, 'error');
    }
    setIsRoleModalOpen(false);
  };

  const columns = [
    { header: 'First Name', accessor: 'firstName' as const },
    { header: 'Last Name', accessor: 'lastName' as const },
    { header: 'Username', accessor: 'username' as const },
    { header: 'Email', accessor: 'email' as const },
    { header: 'Phone', accessor: 'phone' as const },
    { header: 'Expiry Date', accessor: 'expiryDate' as const },
    { header: 'Role', accessor: 'role' as const },
    {
      header: 'Permissions',
      accessor: 'permissions' as const,
      render: (value: string[]) => (
        <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
          {value?.length ?? 0} enabled
        </span>
      ),
    },
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
          Only Super Administrators can manage Administrator accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Administrators</h1>
        {activeTab === 'list' && (
          <button
            onClick={() => setActiveTab('add')}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Add Administrator
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
          />

          <div className="bg-white rounded-lg shadow overflow-hidden">
            {loading && adminRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
            ) : (
              <DataTable columns={columns} data={adminRows} />
            )}
          </div>
        </>
      ) : (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-6">Add New Administrator</h2>
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
                <label className="block text-sm font-medium text-gray-700">Expiry Date</label>
                <input
                  type="date"
                  value={formState.expiryDate}
                  onChange={(e) =>
                    setFormState((s) => ({ ...s, expiryDate: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
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
              <div>
                <label className="block text-sm font-medium text-gray-700">Role</label>
                <div className="mt-1 px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-700">
                  Administrator
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Super Admin accounts are created from the dedicated Super
                  Admin page.
                </p>
              </div>
            </div>

            <PermissionsSelector
              scope={newAdminRole}
              value={newAdminPermissions}
              onChange={setNewAdminPermissions}
              defaultOpen={false}
              title="Permissions & Access"
              description={`Select which sections and actions this ${newAdminRole} can use. You can change these any time from the Role Settings action.`}
            />

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setNewAdminPermissions([]);
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
                {submitting ? 'Creating…' : 'Create Administrator'}
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
        mode="admin"
        title="Edit Administrator"
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
        userType="Administrator"
        currentStatus={selectedUser?.status || 'Active'}
      />

      <RoleSettingsModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        onSave={(permissions) => void submitRoleAssign(permissions)}
        userType="Administrator"
        currentPermissions={selectedUser?.permissions ?? []}
      />
    </div>
  );
}
