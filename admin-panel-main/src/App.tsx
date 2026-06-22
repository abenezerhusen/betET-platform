import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Unauthorized } from './pages/Unauthorized';
import { RequirePermission } from './components/RequirePermission';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { OfflineCashReport } from './pages/reports/OfflineCashReport';
import { OnlineCashReport } from './pages/reports/OnlineCashReport';
import { PayableReport } from './pages/reports/PayableReport';
import { Referrals } from './pages/promotions/Referrals';
import { Raffles } from './pages/promotions/Raffles';
import { BonusEngine } from './pages/promotions/BonusEngine';
import { Affiliates } from './pages/promotions/Affiliates';
import { SuperAdmin } from './pages/users/SuperAdmin';
import { Administrators } from './pages/users/Administrators';
import { Agents } from './pages/users/Agents';
import { Branches } from './pages/users/Branches';
import { Sales } from './pages/users/Sales';
import { OnlineUsers } from './pages/users/OnlineUsers';
import { OnlineTransactions } from './pages/transactions/OnlineTransactions';
import { BranchTransactions } from './pages/transactions/BranchTransactions';
import { WalletTransactions } from './pages/transactions/WalletTransactions';
import { OfflineBets } from './pages/bets/OfflineBets';
import { OnlineBets } from './pages/bets/OnlineBets';
import { SuperJackpots } from './pages/bets/SuperJackpots';
import { BetForMe } from './pages/bets/BetForMe';
import ManualSettlement from './pages/bets/ManualSettlement';
import { ViewTournaments } from './pages/tournaments/ViewTournaments';
import { ManageTournaments } from './pages/tournaments/ManageTournaments';
import { StreakSettings } from './pages/tournaments/StreakSettings';
import { Casino } from './pages/casino/Casino';
import { CasinoEngine } from './pages/casino/CasinoEngine';
import { SmsConfig } from './pages/settings/SmsConfig';
import { GamePicks } from './pages/settings/GamePicks';
import { MatchStats } from './pages/settings/MatchStats';
import { GeneralConfig } from './pages/settings/GeneralConfig';
import { MainConfiguration } from './pages/settings/MainConfiguration';
import { PaymentConfiguration } from './pages/settings/PaymentConfiguration';
import { SecuritySettings } from './pages/settings/SecuritySettings';
import { MaintenanceTools } from './pages/settings/MaintenanceTools';
import { ApiManagement } from './pages/settings/ApiManagement';
import { UserActivityLogs } from './pages/monitoring/UserActivityLogs';
import { ErrorTracking } from './pages/monitoring/ErrorTracking';
import { PerformanceAnalytics } from './pages/monitoring/PerformanceAnalytics';
import { SystemNotifications } from './pages/monitoring/SystemNotifications';
import { AuditTrail } from './pages/monitoring/AuditTrail';
import { P2PDashboard } from './pages/p2p/Dashboard';
import { P2PTransactions } from './pages/p2p/Transactions';
import { DepositQueue } from './pages/p2p/DepositQueue';
import { WithdrawalQueue } from './pages/p2p/WithdrawalQueue';
import { WalletDevices } from './pages/p2p/WalletDevices';
import { DeviceControl } from './pages/p2p/DeviceControl';
import { CommandsQueue } from './pages/p2p/CommandsQueue';
import { Operators } from './pages/p2p/Operators';
import { OperatorAccess } from './pages/p2p/OperatorAccess';
import { OperatorDashboard } from './pages/operator/OperatorDashboard';
import { LimitsRules } from './pages/p2p/LimitsRules';
import { Commissions } from './pages/p2p/Commissions';
import { Logs as P2PLogs } from './pages/p2p/Logs';
import { RtpManagement } from './pages/games/RtpManagement';
import { GameActivity } from './pages/games/GameActivity';
import { IframeIntegration } from './pages/iframe/IframeIntegration';
import { Packages } from './pages/packages/Packages';
import { ApisIntegrations } from './pages/apis/ApisIntegrations';

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-100 p-6 scrollbar-thin">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Section 22 — central route table. Every entry pairs a path with the
 * permission ID that gates the page. Routes without `perm` are open to
 * any authenticated admin (currently only `/dashboard` defaults to that
 * via `dashboard.view`).
 */
const gatedRoutes: ReadonlyArray<{ path: string; perm: string; element: React.ReactNode }> = [
  { path: '/dashboard', perm: 'dashboard.view', element: <Dashboard /> },

  /* Reports */
  { path: '/reports/offline-cash', perm: 'reports.offline_cash', element: <OfflineCashReport /> },
  { path: '/reports/online-cash', perm: 'reports.online_cash', element: <OnlineCashReport /> },
  { path: '/reports/payable', perm: 'reports.payable', element: <PayableReport /> },

  /* Promotions */
  { path: '/promotions/raffles', perm: 'promotions.raffles.view', element: <Raffles /> },
  { path: '/promotions/referrals', perm: 'promotions.referrals.view', element: <Referrals /> },
  { path: '/promotions/bonus', perm: 'promotions.bonus.view', element: <BonusEngine /> },
  { path: '/promotions/affiliates', perm: 'promotions.affiliates.view', element: <Affiliates /> },

  /* Users */
  { path: '/users/super-admin', perm: 'users.super_admin.view', element: <SuperAdmin /> },
  { path: '/users/administrators', perm: 'users.administrators.view', element: <Administrators /> },
  { path: '/users/agents', perm: 'users.agents.view', element: <Agents /> },
  { path: '/users/branches', perm: 'users.branches.view', element: <Branches /> },
  { path: '/users/sales', perm: 'users.sales.view', element: <Sales /> },
  { path: '/users/online-users', perm: 'users.online.view', element: <OnlineUsers /> },

  /* Transactions */
  { path: '/transactions/online', perm: 'tx.online.view', element: <OnlineTransactions /> },
  { path: '/transactions/branch', perm: 'tx.branch.view', element: <BranchTransactions /> },
  { path: '/transactions/wallet', perm: 'tx.wallet.view', element: <WalletTransactions /> },

  /* Bets */
  { path: '/bets/offline', perm: 'bets.offline.view', element: <OfflineBets /> },
  { path: '/bets/online', perm: 'bets.online.view', element: <OnlineBets /> },
  { path: '/bets/jackpots', perm: 'bets.jackpots.view', element: <SuperJackpots /> },
  { path: '/bets/bet-for-me', perm: 'bets.bet_for_me.view', element: <BetForMe /> },
  { path: '/bets/settlement', perm: 'bets.settlement.view', element: <ManualSettlement /> },

  /* Tournaments */
  { path: '/tournaments/view', perm: 'tournaments.view', element: <ViewTournaments /> },
  { path: '/tournaments/manage', perm: 'tournaments.manage', element: <ManageTournaments /> },
  { path: '/tournaments/streak', perm: 'tournaments.streak', element: <StreakSettings /> },

  /* Casino */
  { path: '/casino/main', perm: 'casino.view', element: <Casino /> },
  { path: '/casino/casino', perm: 'casino.view', element: <Casino /> },
  { path: '/casino/engine', perm: 'casino.engine', element: <CasinoEngine /> },
  { path: '/casino/casino-engine', perm: 'casino.engine', element: <CasinoEngine /> },

  /* Settings — Super Admin only by catalog scope */
  { path: '/settings/sms', perm: 'settings.sms', element: <SmsConfig /> },
  { path: '/settings/game-picks', perm: 'settings.game_picks', element: <GamePicks /> },
  { path: '/settings/match-stats', perm: 'settings.match_stats', element: <MatchStats /> },
  { path: '/settings/general', perm: 'settings.general', element: <GeneralConfig /> },
  { path: '/settings/main', perm: 'settings.main', element: <MainConfiguration /> },
  { path: '/settings/payment', perm: 'settings.payment', element: <PaymentConfiguration /> },
  { path: '/settings/security', perm: 'settings.security', element: <SecuritySettings /> },
  { path: '/settings/maintenance', perm: 'settings.maintenance', element: <MaintenanceTools /> },
  { path: '/settings/api', perm: 'settings.api_management', element: <ApiManagement /> },

  /* Monitoring */
  { path: '/monitoring/activity', perm: 'monitoring.activity', element: <UserActivityLogs /> },
  { path: '/monitoring/errors', perm: 'monitoring.errors', element: <ErrorTracking /> },
  { path: '/monitoring/performance', perm: 'monitoring.performance', element: <PerformanceAnalytics /> },
  { path: '/monitoring/notifications', perm: 'monitoring.notifications', element: <SystemNotifications /> },
  { path: '/monitoring/audit', perm: 'monitoring.audit', element: <AuditTrail /> },

  /* P2P */
  { path: '/p2p/dashboard', perm: 'p2p.dashboard', element: <P2PDashboard /> },
  { path: '/p2p/transactions', perm: 'p2p.transactions', element: <P2PTransactions /> },
  { path: '/p2p/deposit-queue', perm: 'p2p.deposit_queue.view', element: <DepositQueue /> },
  { path: '/p2p/withdrawal-queue', perm: 'p2p.withdrawal_queue.view', element: <WithdrawalQueue /> },
  { path: '/p2p/wallet-devices', perm: 'p2p.wallet_devices.view', element: <WalletDevices /> },
  { path: '/p2p/device-control', perm: 'p2p.device_control', element: <DeviceControl /> },
  { path: '/p2p/commands-queue', perm: 'p2p.commands_queue', element: <CommandsQueue /> },
  { path: '/p2p/operators', perm: 'p2p.operators.view', element: <Operators /> },
  { path: '/p2p/operator-access', perm: 'p2p.operators.access.view', element: <OperatorAccess /> },
  { path: '/p2p/limits', perm: 'p2p.limits.view', element: <LimitsRules /> },
  { path: '/p2p/limits-rules', perm: 'p2p.limits.view', element: <LimitsRules /> },
  { path: '/p2p/commissions', perm: 'p2p.commissions.view', element: <Commissions /> },
  { path: '/p2p/logs', perm: 'p2p.logs', element: <P2PLogs /> },

  /* Games / Iframe / Packages / APIs */
  { path: '/games/rtp', perm: 'games.rtp.view', element: <RtpManagement /> },
  { path: '/games/activity', perm: 'games.activity.view', element: <GameActivity /> },
  { path: '/iframe', perm: 'iframe.outbound.view', element: <IframeIntegration /> },
  { path: '/packages', perm: 'packages.view', element: <Packages /> },
  { path: '/apis', perm: 'apis.view', element: <ApisIntegrations /> },
];

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/unauthorized" element={<Unauthorized />} />

        {/* Operator dashboard uses its own auth (secure email link), not the
            admin JWT, so it's exposed without an admin permission gate. */}
        <Route path="/operator/dashboard" element={<OperatorDashboard />} />

        {gatedRoutes.map((r) => (
          <Route
            key={r.path}
            path={r.path}
            element={
              <ProtectedLayout>
                <RequirePermission perm={r.perm}>{r.element}</RequirePermission>
              </ProtectedLayout>
            }
          />
        ))}

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
