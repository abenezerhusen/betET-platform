import React, { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FileText, Gift, Users, Wallet, Target, Gamepad2, Settings, ChevronDown, ChevronRight, Shield, PenTool as Tool, Network, Activity, AlertTriangle, BarChart2, Bell, History, Trophy, CreditCard, Repeat, Smartphone, Terminal, Inbox, Sliders, Percent, Code2, Package, Plug } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuthStore } from '../store/auth';

interface MenuItem {
  title: string;
  icon: React.ReactNode;
  path?: string;
  /** Section 22 — permission ID gating this entry. */
  perm?: string;
  children?: MenuItem[];
}

/**
 * Section 22 — single source of truth for sidebar entries. Each entry
 * carries the permission ID that gates its visibility. A parent
 * section auto-hides when every child is gated out.
 */
const menuItems: MenuItem[] = [
  {
    title: 'Dashboard',
    icon: <LayoutDashboard size={20} />,
    path: '/dashboard',
    perm: 'dashboard.view',
  },
  {
    title: 'Reports',
    icon: <FileText size={20} />,
    children: [
      { title: 'Offline Cash Report', path: '/reports/offline-cash', perm: 'reports.offline_cash', icon: <ChevronRight size={16} /> },
      { title: 'Online Cash Report', path: '/reports/online-cash', perm: 'reports.online_cash', icon: <ChevronRight size={16} /> },
      { title: 'Payable Report', path: '/reports/payable', perm: 'reports.payable', icon: <ChevronRight size={16} /> },
    ],
  },
  {
    title: 'Promotions',
    icon: <Gift size={20} />,
    children: [
      { title: 'Raffles', path: '/promotions/raffles', perm: 'promotions.raffles.view', icon: <ChevronRight size={16} /> },
      { title: 'Referrals', path: '/promotions/referrals', perm: 'promotions.referrals.view', icon: <ChevronRight size={16} /> },
      { title: 'Bonus Engine', path: '/promotions/bonus', perm: 'promotions.bonus.view', icon: <ChevronRight size={16} /> },
      { title: 'Affiliates', path: '/promotions/affiliates', perm: 'promotions.affiliates.view', icon: <ChevronRight size={16} /> },
    ],
  },
  {
    title: 'Users',
    icon: <Users size={20} />,
    children: [
      { title: 'Super Admin', path: '/users/super-admin', perm: 'users.super_admin.view', icon: <ChevronRight size={16} /> },
      { title: 'Administrators', path: '/users/administrators', perm: 'users.administrators.view', icon: <ChevronRight size={16} /> },
      { title: 'Agents', path: '/users/agents', perm: 'users.agents.view', icon: <ChevronRight size={16} /> },
      { title: 'Branches', path: '/users/branches', perm: 'users.branches.view', icon: <ChevronRight size={16} /> },
      { title: 'Sales', path: '/users/sales', perm: 'users.sales.view', icon: <ChevronRight size={16} /> },
      { title: 'Online Users', path: '/users/online-users', perm: 'users.online.view', icon: <ChevronRight size={16} /> },
    ],
  },
  {
    title: 'Transactions',
    icon: <Wallet size={20} />,
    children: [
      { title: 'Online Transactions', path: '/transactions/online', perm: 'tx.online.view', icon: <ChevronRight size={16} /> },
      { title: 'Branch Transactions', path: '/transactions/branch', perm: 'tx.branch.view', icon: <ChevronRight size={16} /> },
      { title: 'Wallet Transactions', path: '/transactions/wallet', perm: 'tx.wallet.view', icon: <ChevronRight size={16} /> },
    ],
  },
  {
    title: 'Bets',
    icon: <Target size={20} />,
    children: [
      { title: 'Offline Bets', path: '/bets/offline', perm: 'bets.offline.view', icon: <ChevronRight size={16} /> },
      { title: 'Online Bets', path: '/bets/online', perm: 'bets.online.view', icon: <ChevronRight size={16} /> },
      { title: 'Super Jackpots', path: '/bets/jackpots', perm: 'bets.jackpots.view', icon: <ChevronRight size={16} /> },
      { title: 'BetForMe', path: '/bets/bet-for-me', perm: 'bets.bet_for_me.view', icon: <ChevronRight size={16} /> },
    ],
  },
  {
    title: 'Tournaments',
    icon: <Trophy size={20} />,
    children: [
      { title: 'View Tournaments', path: '/tournaments/view', perm: 'tournaments.view', icon: <ChevronRight size={16} /> },
      { title: 'Manage Tournaments', path: '/tournaments/manage', perm: 'tournaments.manage', icon: <ChevronRight size={16} /> },
      { title: 'Streak Settings', path: '/tournaments/streak', perm: 'tournaments.streak', icon: <ChevronRight size={16} /> },
    ],
  },
  {
    title: 'Casino Config',
    icon: <Gamepad2 size={20} />,
    children: [
      { title: 'Casino', path: '/casino/main', perm: 'casino.view', icon: <ChevronRight size={16} /> },
    ],
  },
  {
    title: 'P2P System',
    icon: <Repeat size={20} />,
    children: [
      { title: 'Dashboard', path: '/p2p/dashboard', perm: 'p2p.dashboard', icon: <LayoutDashboard size={16} /> },
      { title: 'Transactions', path: '/p2p/transactions', perm: 'p2p.transactions', icon: <Wallet size={16} /> },
      { title: 'Deposit Queue', path: '/p2p/deposit-queue', perm: 'p2p.deposit_queue.view', icon: <ChevronRight size={16} /> },
      { title: 'Withdrawal Queue', path: '/p2p/withdrawal-queue', perm: 'p2p.withdrawal_queue.view', icon: <ChevronRight size={16} /> },
      { title: 'Wallet Devices', path: '/p2p/wallet-devices', perm: 'p2p.wallet_devices.view', icon: <Smartphone size={16} /> },
      { title: 'Device Control', path: '/p2p/device-control', perm: 'p2p.device_control', icon: <Terminal size={16} /> },
      { title: 'Commands Queue', path: '/p2p/commands-queue', perm: 'p2p.commands_queue', icon: <Inbox size={16} /> },
      { title: 'Agents / Operators', path: '/p2p/operators', perm: 'p2p.operators.view', icon: <Users size={16} /> },
      { title: 'Operator Access', path: '/p2p/operator-access', perm: 'p2p.operators.access.view', icon: <Shield size={16} /> },
      { title: 'Limits & Rules', path: '/p2p/limits', perm: 'p2p.limits.view', icon: <Sliders size={16} /> },
      { title: 'Commissions', path: '/p2p/commissions', perm: 'p2p.commissions.view', icon: <Percent size={16} /> },
      { title: 'Logs / Monitoring', path: '/p2p/logs', perm: 'p2p.logs', icon: <FileText size={16} /> },
    ],
  },
  {
    title: 'Games',
    icon: <Gamepad2 size={20} />,
    children: [
      { title: 'RTP Management', path: '/games/rtp', perm: 'games.rtp.view', icon: <Percent size={16} /> },
    ],
  },
  {
    title: 'Iframe Integration',
    icon: <Code2 size={20} />,
    path: '/iframe',
    perm: 'iframe.outbound.view',
  },
  {
    title: 'Packages',
    icon: <Package size={20} />,
    path: '/packages',
    perm: 'packages.view',
  },
  {
    title: 'APIs & Integrations',
    icon: <Plug size={20} />,
    path: '/apis',
    perm: 'apis.view',
  },
  {
    title: 'Settings',
    icon: <Settings size={20} />,
    children: [
      { title: 'General', path: '/settings/general', perm: 'settings.general', icon: <ChevronRight size={16} /> },
      { title: 'Main Configuration', path: '/settings/main', perm: 'settings.main', icon: <ChevronRight size={16} /> },
      { title: 'Payment Configuration', path: '/settings/payment', perm: 'settings.payment', icon: <CreditCard size={16} /> },
      { title: 'Security', path: '/settings/security', perm: 'settings.security', icon: <Shield size={16} /> },
      { title: 'Maintenance', path: '/settings/maintenance', perm: 'settings.maintenance', icon: <Tool size={16} /> },
      { title: 'API Management', path: '/settings/api', perm: 'settings.api_management', icon: <Network size={16} /> },
      { title: 'SMS Config', path: '/settings/sms', perm: 'settings.sms', icon: <ChevronRight size={16} /> },
      { title: 'Game Picks', path: '/settings/game-picks', perm: 'settings.game_picks', icon: <ChevronRight size={16} /> },
      { title: 'Match Stats', path: '/settings/match-stats', perm: 'settings.match_stats', icon: <ChevronRight size={16} /> },
    ],
  },
  {
    title: 'Monitoring',
    icon: <Activity size={20} />,
    children: [
      { title: 'User Activity', path: '/monitoring/activity', perm: 'monitoring.activity', icon: <Users size={16} /> },
      { title: 'Error Tracking', path: '/monitoring/errors', perm: 'monitoring.errors', icon: <AlertTriangle size={16} /> },
      { title: 'Performance', path: '/monitoring/performance', perm: 'monitoring.performance', icon: <BarChart2 size={16} /> },
      { title: 'Notifications', path: '/monitoring/notifications', perm: 'monitoring.notifications', icon: <Bell size={16} /> },
      { title: 'Audit Trail', path: '/monitoring/audit', perm: 'monitoring.audit', icon: <History size={16} /> },
    ],
  },
];

/**
 * Filters the menu tree to only the items the current user can see.
 * A parent group disappears when every one of its children is gated out.
 */
function filterMenu(
  items: MenuItem[],
  has: (id: string) => boolean
): MenuItem[] {
  const out: MenuItem[] = [];
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      const visibleChildren = item.children.filter(
        (c) => !c.perm || has(c.perm)
      );
      if (visibleChildren.length > 0) {
        out.push({ ...item, children: visibleChildren });
      }
      continue;
    }
    if (!item.perm || has(item.perm)) {
      out.push(item);
    }
  }
  return out;
}

interface MenuItemProps {
  item: MenuItem;
  isCollapsed: boolean;
}

function MenuItem({ item, isCollapsed }: MenuItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (item.children) {
    return (
      <div>
        <button
          className={cn(
            'w-full flex items-center px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg',
            isCollapsed && 'justify-center'
          )}
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className="flex items-center space-x-3">
            {item.icon}
            {!isCollapsed && <span>{item.title}</span>}
          </span>
          {!isCollapsed && <ChevronDown size={16} className={cn('ml-auto', isOpen && 'rotate-180')} />}
        </button>
        {isOpen && !isCollapsed && (
          <div className="ml-6 mt-1 space-y-1">
            {item.children.map((child) => (
              <NavLink
                key={child.path}
                to={child.path || '#'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center space-x-3 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg',
                    isActive && 'bg-gray-100 text-gray-900'
                  )
                }
              >
                {child.icon}
                <span>{child.title}</span>
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.path || '#'}
      className={({ isActive }) =>
        cn(
          'flex items-center space-x-3 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg',
          isCollapsed && 'justify-center',
          isActive && 'bg-gray-100 text-gray-900'
        )
      }
    >
      {item.icon}
      {!isCollapsed && <span>{item.title}</span>}
    </NavLink>
  );
}

export function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);

  // Recompute when role or permissions change. Including `user` in
  // deps catches both the initial login and any token refresh that
  // updated the embedded permission claim.
  const visible = useMemo(
    () => filterMenu(menuItems, hasPermission),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.role, user?.permissions?.join('|')]
  );

  return (
    <aside
      className={cn(
        'bg-white border-r border-gray-200 h-screen flex flex-col transition-all duration-300',
        isCollapsed ? 'w-20' : 'w-64'
      )}
    >
      <div className="p-4 flex-shrink-0 border-b border-gray-100">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full bg-gray-100 p-2 rounded-lg text-gray-600 hover:bg-gray-200"
        >
          {isCollapsed ? '→' : '←'}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto space-y-2 p-4 scrollbar-thin">
        {visible.map((item) => (
          <MenuItem key={item.title} item={item} isCollapsed={isCollapsed} />
        ))}
      </nav>
    </aside>
  );
}
