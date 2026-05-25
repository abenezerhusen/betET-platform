import { Edit, Eye, Key, Power, Shield, Wallet, Building } from 'lucide-react';

interface UserActionsProps {
  userId: string;
  onEdit: (id: string) => void;
  onChangePassword: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onView?: (id: string) => void;
  onRoleSettings?: (id: string) => void;
  onWallet?: (id: string) => void;
  onBranchManage?: (id: string) => void;
  showRoleSettings?: boolean;
  showWallet?: boolean;
  showBranchManage?: boolean;
}

export function UserActions({
  userId,
  onEdit,
  onChangePassword,
  onToggleStatus,
  onView,
  onRoleSettings,
  onWallet,
  onBranchManage,
  showRoleSettings = false,
  showWallet = false,
  showBranchManage = false,
}: UserActionsProps) {
  return (
    <div className="flex items-center justify-start space-x-2">
      {onView && (
        <button
          onClick={() => onView(userId)}
          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full"
          title="View Details"
        >
          <Eye className="h-4 w-4" />
        </button>
      )}
      <button
        onClick={() => onEdit(userId)}
        className="p-1.5 text-green-600 hover:bg-green-50 rounded-full"
        title="Edit"
      >
        <Edit className="h-4 w-4" />
      </button>
      <button
        onClick={() => onChangePassword(userId)}
        className="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded-full"
        title="Change Password"
      >
        <Key className="h-4 w-4" />
      </button>
      <button
        onClick={() => onToggleStatus(userId)}
        className="p-1.5 text-red-600 hover:bg-red-50 rounded-full"
        title="Toggle Status"
      >
        <Power className="h-4 w-4" />
      </button>
      {showRoleSettings && onRoleSettings && (
        <button
          onClick={() => onRoleSettings(userId)}
          className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-full"
          title="Role Settings"
        >
          <Shield className="h-4 w-4" />
        </button>
      )}
      {showWallet && onWallet && (
        <button
          onClick={() => onWallet(userId)}
          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full"
          title="Wallet"
        >
          <Wallet className="h-4 w-4" />
        </button>
      )}
      {showBranchManage && onBranchManage && (
        <button
          onClick={() => onBranchManage(userId)}
          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-full"
          title="Branch Management"
        >
          <Building className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}