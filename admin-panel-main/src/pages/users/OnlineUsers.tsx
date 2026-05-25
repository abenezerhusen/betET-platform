import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { ImportModal } from '../../components/ImportModal';
import { AddMemberModal } from '../../components/AddMemberModal';
import { WalletModal } from '../../components/WalletModal';
import { UserDetailsModal } from '../../components/UserDetailsModal';
import * as XLSX from 'xlsx';
import { toast } from '../../lib/toast';
import * as usersApi from '../../lib/api/users';
import { ApiError } from '../../lib/api/client';
import type { AdminUser } from '../../lib/api/types';
import { useAuthStore } from '../../store/auth';
import {
  UserPlus,
  FileDown,
  FileUp,
  Wallet,
  FileText,
  Download,
  Pause,
  Play,
  Shield,
} from 'lucide-react';

interface OnlineUserData {
  id: string;
  name: string;
  memberId: string;
  phone: string;
  email: string;
  balance: number;
  bonus: number;
  won: number;
  status: string;
  rawStatus: string;
  memberType: string;
  lastLogin: string;
  dateJoined: string;
  lastBetAt: string | null;
  lastBetTimestamp: number | null;
}

const tabs = [
  { id: 'all', label: 'All Members' },
  { id: 'active', label: 'Active Users' },
  { id: 'inactive', label: 'Inactive Users' },
  { id: 'blocked', label: 'Blocked' },
];

const importedMemberSchema = z
  .object({
    name: z.string().trim().min(2),
    email: z.string().trim().email().optional().or(z.literal('')),
    phone: z.string().trim().min(8).optional().or(z.literal('')),
    memberType: z.enum(['Regular', 'VIP', 'Premium']).optional(),
    city: z.string().trim().optional().or(z.literal('')),
    address: z.string().trim().optional().or(z.literal('')),
    password: z.string().min(8),
  })
  .refine((d) => Boolean((d.email ?? '').trim()) || Boolean((d.phone ?? '').trim()), {
    message: 'email or phone is required',
  });

const ACTIVE_BET_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const numFromString = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function inferMemberType(meta: Record<string, unknown>): string {
  const t = typeof meta.member_type === 'string' ? (meta.member_type as string) : '';
  if (!t) return 'Regular';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function buildMemberId(u: AdminUser): string {
  // Use the first 6 chars of the user UUID, uppercase. Stable, no per-render
  // numbering issues that the previous implementation had.
  return `MEM-${u.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

function toRow(u: AdminUser): OnlineUserData {
  const md = (u.metadata ?? {}) as Record<string, unknown>;
  const lastBetIso = u.last_bet_at ?? null;
  const lastBetTs = lastBetIso ? new Date(lastBetIso).getTime() : null;
  return {
    id: u.id,
    name:
      String(md.full_name ?? '').trim() ||
      [String(md.first_name ?? ''), String(md.last_name ?? '')]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ') ||
      u.email ||
      u.phone ||
      `User ${u.id.slice(0, 6)}`,
    memberId: buildMemberId(u),
    phone: u.phone ?? '-',
    email: u.email ?? '-',
    balance: numFromString(u.balance),
    bonus: numFromString(u.bonus_balance),
    won: numFromString(u.total_won),
    status:
      u.status === 'active'
        ? 'Active'
        : u.status === 'suspended'
          ? 'Blocked'
          : u.status === 'disabled' || u.status === 'banned'
            ? 'Blocked'
            : 'Inactive',
    rawStatus: u.status,
    memberType: inferMemberType(md),
    lastLogin: u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '-',
    dateJoined: u.created_at ? new Date(u.created_at).toLocaleDateString() : '-',
    lastBetAt: lastBetIso,
    lastBetTimestamp: lastBetTs,
  };
}

export function OnlineUsers() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentRole = useAuthStore((s) => s.user?.role);
  // Spec: Admin / Super Admin only. Block other roles.
  const canView = currentRole === 'admin' || currentRole === 'superadmin';
  const [activeTab, setActiveTab] = useState('all');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<OnlineUserData | null>(null);
  const [items, setItems] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setLoading(true);

    const load = () => {
      usersApi
        .listUsers({
          role: 'online_user',
          page: 1,
          limit: 500,
          with_balance: true,
          with_activity: true,
        })
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setLoading(false);
          const msg =
            err instanceof ApiError ? err.message : String((err as Error)?.message ?? err);
          toast(`Failed to load members: ${msg}`, 'error');
        });
    };

    load();
    const interval = window.setInterval(load, 15000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, tick]);

  const rows = useMemo(() => items.map(toRow), [items]);

  const filters = [
    {
      label: 'Phone Number',
      options: [] as string[],
      value: phoneNumber,
      onChange: setPhoneNumber,
      type: 'text' as const,
    },
    {
      label: 'Status',
      options: ['Active', 'Inactive', 'Blocked'],
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
    {
      label: 'Member Type',
      options: ['Regular', 'VIP', 'Premium'],
      value: selectedType,
      onChange: setSelectedType,
    },
  ];

  const filteredRows = useMemo(() => {
    const now = Date.now();
    let filtered = rows;

    switch (activeTab) {
      case 'active':
        filtered = rows.filter(
          (u) =>
            u.rawStatus === 'active' &&
            u.lastBetTimestamp !== null &&
            now - u.lastBetTimestamp <= ACTIVE_BET_WINDOW_MS
        );
        break;
      case 'inactive':
        filtered = rows.filter(
          (u) =>
            u.rawStatus === 'active' &&
            (u.lastBetTimestamp === null || now - u.lastBetTimestamp > ACTIVE_BET_WINDOW_MS)
        );
        break;
      case 'blocked':
        filtered = rows.filter((u) => u.rawStatus !== 'active');
        break;
      default:
        filtered = rows;
    }

    if (phoneNumber) {
      filtered = filtered.filter((u) => u.phone.includes(phoneNumber));
    }
    if (selectedStatus) {
      filtered = filtered.filter((u) => u.status === selectedStatus);
    }
    if (selectedType) {
      filtered = filtered.filter((u) => u.memberType === selectedType);
    }
    return filtered;
  }, [rows, activeTab, phoneNumber, selectedStatus, selectedType]);

  const handleViewWallet = (id: string) => {
    const member = rows.find((u) => u.id === id);
    if (member) {
      setSelectedMember(member);
      setIsWalletModalOpen(true);
    }
  };

  const handleViewDetails = (id: string) => {
    const member = rows.find((u) => u.id === id);
    if (member) {
      setSelectedMember(member);
      setIsDetailsModalOpen(true);
    }
  };

  const handleToggleStatus = async (id: string) => {
    const member = rows.find((u) => u.id === id);
    if (!member) return;
    try {
      const next: usersApi.AdminUserStatus =
        member.rawStatus === 'active' ? 'suspended' : 'active';
      await usersApi.setUserStatus(id, next, 'Admin panel toggle');
      toast(
        next === 'active'
          ? `${member.name} reactivated.`
          : `${member.name} suspended; active sessions ended.`
      );
      reload();
    } catch (err) {
      toast(`Failed to update status: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const handleImportUsers = async (data: any[]) => {
    if (!Array.isArray(data) || data.length === 0) {
      toast('No rows found in file.', 'error');
      return;
    }
    let imported = 0;
    let failed = 0;
    for (const raw of data) {
      const parsed = importedMemberSchema.safeParse(raw);
      if (!parsed.success) {
        failed += 1;
        continue;
      }
      const [first, ...rest] = parsed.data.name.split(/\s+/);
      try {
        await usersApi.createUser({
          email: parsed.data.email || undefined,
          phone: parsed.data.phone || undefined,
          password: parsed.data.password,
          role: 'user',
          metadata: {
            full_name: parsed.data.name,
            first_name: first ?? '',
            last_name: rest.join(' ') || null,
            member_type: (parsed.data.memberType ?? 'Regular').toLowerCase(),
            city: parsed.data.city || null,
            address: parsed.data.address || null,
          },
        });
        imported += 1;
      } catch {
        failed += 1;
      }
    }
    toast(
      failed === 0
        ? `Imported ${imported} member${imported === 1 ? '' : 's'}.`
        : `Imported ${imported}; ${failed} row${failed === 1 ? '' : 's'} failed.`,
      failed === 0 ? 'success' : 'info'
    );
    reload();
  };

  const handleExportTemplate = () => {
    const template = [
      {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1234567890',
        memberType: 'Regular',
        city: 'New York',
        address: '123 Main St',
        password: 'ChangeMe1!',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'member_import_template.xlsx');
  };

  const handleExportUsers = () => {
    const exported = filteredRows.map((u) => ({
      member_id: u.memberId,
      name: u.name,
      email: u.email,
      phone: u.phone,
      balance: u.balance,
      bonus_balance: u.bonus,
      total_won: u.won,
      status: u.status,
      member_type: u.memberType,
      last_login: u.lastLogin,
      last_bet_at: u.lastBetAt ?? '',
      date_joined: u.dateJoined,
    }));
    const ws = XLSX.utils.json_to_sheet(exported);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Members');
    XLSX.writeFile(wb, 'members_export.xlsx');
    toast(`Exported ${exported.length} member${exported.length === 1 ? '' : 's'}.`);
  };

  const handleAddMember = async (memberData: any) => {
    try {
      await usersApi.createUser({
        email: memberData.email || undefined,
        phone: memberData.phone || undefined,
        password: memberData.password,
        role: 'user',
        metadata: {
          full_name: `${memberData.firstName ?? ''} ${memberData.lastName ?? ''}`.trim(),
          first_name: memberData.firstName ?? null,
          last_name: memberData.lastName ?? null,
          member_type: String(memberData.memberType ?? 'Regular').toLowerCase(),
          city: memberData.city ?? null,
          address: memberData.address ?? null,
        },
      });
      toast('Member created.');
      reload();
    } catch (err) {
      toast(`Failed to create member: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const columns = [
    { header: 'Name', accessor: 'name' as const },
    { header: 'Member ID', accessor: 'memberId' as const },
    { header: 'Phone', accessor: 'phone' as const },
    { header: 'Email', accessor: 'email' as const },
    {
      header: 'Balance',
      accessor: 'balance' as const,
      render: (value: number) => `$${value.toFixed(2)}`,
    },
    {
      header: 'Bonus',
      accessor: 'bonus' as const,
      render: (value: number) => `$${value.toFixed(2)}`,
    },
    {
      header: 'Won',
      accessor: 'won' as const,
      render: (value: number) => `$${value.toFixed(2)}`,
    },
    {
      header: 'Status',
      accessor: 'status' as const,
      render: (value: string) => (
        <span
          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
            value === 'Active'
              ? 'bg-green-100 text-green-700'
              : value === 'Blocked'
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-700'
          }`}
        >
          {value}
        </span>
      ),
    },
    {
      header: 'Member Type',
      accessor: 'memberType' as const,
      render: (value: string) => (
        <span
          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
            value === 'VIP'
              ? 'bg-yellow-100 text-yellow-700'
              : value === 'Premium'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-blue-100 text-blue-700'
          }`}
        >
          {value}
        </span>
      ),
    },
    { header: 'Last Login', accessor: 'lastLogin' as const },
    { header: 'Date Joined', accessor: 'dateJoined' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      className: 'w-32',
      render: (value: string) => {
        const member = rows.find((r) => r.id === value);
        return (
          <div className="flex items-center justify-start space-x-1">
            <button
              onClick={() => handleViewWallet(value)}
              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full"
              title="Wallet"
            >
              <Wallet className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleViewDetails(value)}
              className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-full"
              title="View Details"
            >
              <FileText className="h-4 w-4" />
            </button>
            <button
              onClick={() => void handleToggleStatus(value)}
              className={`p-1.5 rounded-full ${
                member?.rawStatus === 'active'
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-green-600 hover:bg-green-50'
              }`}
              title={member?.rawStatus === 'active' ? 'Suspend' : 'Reactivate'}
            >
              {member?.rawStatus === 'active' ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </button>
          </div>
        );
      },
    },
  ];

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <Shield className="h-10 w-10 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-900">Restricted Page</h2>
        <p className="text-sm text-gray-600 mt-1">
          Only Administrators and Super Administrators can manage Online Users.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow">
        <h1 className="text-2xl font-semibold text-gray-900">Online Users</h1>
        <div className="flex space-x-4">
          <button
            onClick={handleExportTemplate}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <Download className="h-4 w-4 mr-2" />
            Download Template
          </button>
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileUp className="h-4 w-4 mr-2" />
            Import Members
          </button>
          <button
            onClick={handleExportUsers}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Members
          </button>
          <button
            onClick={() => setIsAddMemberModalOpen(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Add Member
          </button>
        </div>
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
      />

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading members…</div>
        ) : (
          <DataTable columns={columns} data={filteredRows} />
        )}
      </div>

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={(data) => void handleImportUsers(data)}
      />

      <AddMemberModal
        isOpen={isAddMemberModalOpen}
        onClose={() => setIsAddMemberModalOpen(false)}
        onAdd={(data) => void handleAddMember(data)}
      />

      <WalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        memberData={
          selectedMember
            ? {
                userId: selectedMember.id,
                name: selectedMember.name,
                balance: selectedMember.balance,
                bonus: selectedMember.bonus,
                won: selectedMember.won,
              }
            : undefined
        }
        onSuccess={() => reload()}
      />

      <UserDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        user={selectedMember}
      />
    </div>
  );
}
