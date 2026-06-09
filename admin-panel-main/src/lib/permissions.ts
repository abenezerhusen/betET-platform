import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Permission {
  id: string;
  name: string;
  description: string;
  category: string;
  /** user-types this permission applies to */
  scopes: PermissionScope[];
}

export type PermissionScope =
  | 'Super Admin'
  | 'Administrator'
  | 'Agent'
  | 'Branch'
  | 'Sales Staff'
  | 'Operator';

/* -------------------------------------------------------------------------- */
/*  Administrator / Super Admin permission catalog                            */
/*  Grouped 1:1 with the sidebar sections so every feature, button and page   */
/*  can be gated by the super admin from the Role Settings modal.             */
/* -------------------------------------------------------------------------- */
const adminScopes: PermissionScope[] = ['Administrator', 'Super Admin'];

const administratorCatalog: Permission[] = [
  /* Administrators management ----------------------------------------------- */
  { id: 'admin.create', name: 'Create Administrators', description: 'Create new administrator accounts', category: 'Administrators', scopes: adminScopes },
  { id: 'admin.update', name: 'Update Administrator Information', description: 'Modify existing administrator accounts', category: 'Administrators', scopes: adminScopes },
  { id: 'admin.view', name: 'View Administrators List', description: 'View all administrator accounts', category: 'Administrators', scopes: adminScopes },
  { id: 'admin.delete', name: 'Delete Administrators', description: 'Remove administrator accounts', category: 'Administrators', scopes: adminScopes },
  { id: 'admin.change_password', name: 'Change Administrator Password', description: 'Reset administrator passwords', category: 'Administrators', scopes: adminScopes },
  { id: 'admin.toggle_status', name: 'Enable / Disable Administrators', description: 'Activate or deactivate administrator accounts', category: 'Administrators', scopes: adminScopes },
  { id: 'admin.manage_roles', name: 'Manage Administrator Roles & Permissions', description: 'Assign or revoke permissions on administrators', category: 'Administrators', scopes: adminScopes },

  /* Dashboard --------------------------------------------------------------- */
  { id: 'dashboard.view', name: 'View Dashboard', description: 'Open the main dashboard page', category: 'Dashboard', scopes: adminScopes },
  { id: 'dashboard.kpi', name: 'View KPI Cards', description: 'See headline KPI widgets on the dashboard', category: 'Dashboard', scopes: adminScopes },
  { id: 'dashboard.charts', name: 'View Charts & Analytics', description: 'See graphs and analytic panels on the dashboard', category: 'Dashboard', scopes: adminScopes },
  { id: 'dashboard.date_filter', name: 'Filter Dashboard By Date', description: 'Use the date range filter on the dashboard', category: 'Dashboard', scopes: adminScopes },

  /* Reports ----------------------------------------------------------------- */
  { id: 'reports.offline_cash', name: 'View Offline Cash Report', description: 'Access the offline cash report', category: 'Reports', scopes: adminScopes },
  { id: 'reports.online_cash', name: 'View Online Cash Report', description: 'Access the online cash report', category: 'Reports', scopes: adminScopes },
  { id: 'reports.payable', name: 'View Payable Report', description: 'Access the payable report', category: 'Reports', scopes: adminScopes },
  { id: 'reports.export', name: 'Export Reports', description: 'Download / export report data', category: 'Reports', scopes: adminScopes },

  /* Promotions -------------------------------------------------------------- */
  { id: 'promotions.raffles.view', name: 'View Raffles', description: 'View raffle campaigns', category: 'Promotions', scopes: adminScopes },
  { id: 'promotions.raffles.manage', name: 'Manage Raffles', description: 'Create / edit / delete raffle campaigns', category: 'Promotions', scopes: adminScopes },
  { id: 'promotions.referrals.view', name: 'View Referrals', description: 'View referral data', category: 'Promotions', scopes: adminScopes },
  { id: 'promotions.referrals.manage', name: 'Manage Referrals', description: 'Configure the referral program', category: 'Promotions', scopes: adminScopes },
  { id: 'promotions.bonus.view', name: 'View Bonus Engine', description: 'View bonus engine configuration', category: 'Promotions', scopes: adminScopes },
  { id: 'promotions.bonus.manage', name: 'Manage Bonus Engine', description: 'Configure bonus rules and campaigns', category: 'Promotions', scopes: adminScopes },
  { id: 'promotions.affiliates.view', name: 'View Affiliates', description: 'View affiliates list', category: 'Promotions', scopes: adminScopes },
  { id: 'promotions.affiliates.manage', name: 'Manage Affiliates', description: 'Create / edit affiliates', category: 'Promotions', scopes: adminScopes },

  /* Users ------------------------------------------------------------------- */
  { id: 'users.super_admin.view', name: 'View Super Admin List', description: 'View super admin accounts', category: 'Users', scopes: adminScopes },
  { id: 'users.super_admin.manage', name: 'Manage Super Admins', description: 'Create / edit super admin accounts', category: 'Users', scopes: ['Super Admin'] },
  { id: 'users.administrators.view', name: 'View Administrators', description: 'View administrator list', category: 'Users', scopes: adminScopes },
  { id: 'users.agents.view', name: 'View Agents', description: 'View agents list', category: 'Users', scopes: adminScopes },
  { id: 'users.agents.create', name: 'Create Agents', description: 'Create new agent accounts', category: 'Users', scopes: adminScopes },
  { id: 'users.agents.edit', name: 'Edit Agents', description: 'Modify agent accounts', category: 'Users', scopes: adminScopes },
  { id: 'users.agents.delete', name: 'Delete Agents', description: 'Remove agent accounts', category: 'Users', scopes: adminScopes },
  { id: 'users.agents.wallet', name: 'Access Agent Wallet', description: 'Top-up / manage agent wallet', category: 'Users', scopes: adminScopes },
  { id: 'users.agents.roles', name: 'Manage Agent Permissions', description: 'Assign permissions to agents', category: 'Users', scopes: adminScopes },
  { id: 'users.branches.view', name: 'View Branches', description: 'View branches list', category: 'Users', scopes: adminScopes },
  { id: 'users.branches.manage', name: 'Manage Branches', description: 'Create / edit / delete branches', category: 'Users', scopes: adminScopes },
  { id: 'users.sales.view', name: 'View Sales Staff', description: 'View sales staff list', category: 'Users', scopes: adminScopes },
  { id: 'users.sales.manage', name: 'Manage Sales Staff', description: 'Create / edit sales staff accounts', category: 'Users', scopes: adminScopes },
  { id: 'users.online.view', name: 'View Online Users', description: 'View list of online (player) users', category: 'Users', scopes: adminScopes },
  { id: 'users.online.manage', name: 'Manage Online Users', description: 'Suspend / reset online user accounts', category: 'Users', scopes: adminScopes },

  /* Transactions ------------------------------------------------------------ */
  { id: 'tx.online.view', name: 'View Online Transactions', description: 'Access online transaction log', category: 'Transactions', scopes: adminScopes },
  { id: 'tx.branch.view', name: 'View Branch Transactions', description: 'Access branch transaction log', category: 'Transactions', scopes: adminScopes },
  { id: 'tx.wallet.view', name: 'View Wallet Transactions', description: 'Access wallet transaction log', category: 'Transactions', scopes: adminScopes },
  { id: 'tx.approve', name: 'Approve Transactions', description: 'Approve pending transactions', category: 'Transactions', scopes: adminScopes },
  { id: 'tx.cancel', name: 'Cancel Transactions', description: 'Cancel / reverse transactions', category: 'Transactions', scopes: adminScopes },
  { id: 'tx.export', name: 'Export Transactions', description: 'Export transaction data', category: 'Transactions', scopes: adminScopes },

  /* Bets -------------------------------------------------------------------- */
  { id: 'bets.offline.view', name: 'View Offline Bets', description: 'View offline betting tickets', category: 'Bets', scopes: adminScopes },
  { id: 'bets.online.view', name: 'View Online Bets', description: 'View online betting tickets', category: 'Bets', scopes: adminScopes },
  { id: 'bets.jackpots.view', name: 'View Super Jackpots', description: 'View super jackpot tickets', category: 'Bets', scopes: adminScopes },
  { id: 'bets.bet_for_me.view', name: 'View BetForMe', description: 'View BetForMe tickets', category: 'Bets', scopes: adminScopes },
  { id: 'bets.cancel', name: 'Cancel Bets', description: 'Cancel existing bets', category: 'Bets', scopes: adminScopes },
  { id: 'bets.payout', name: 'Payout Bets', description: 'Payout winning tickets', category: 'Bets', scopes: adminScopes },
  { id: 'bets.export', name: 'Export Bets', description: 'Export bet data', category: 'Bets', scopes: adminScopes },

  /* Tournaments ------------------------------------------------------------- */
  { id: 'tournaments.view', name: 'View Tournaments', description: 'View tournaments list', category: 'Tournaments', scopes: adminScopes },
  { id: 'tournaments.manage', name: 'Manage Tournaments', description: 'Create / edit / delete tournaments', category: 'Tournaments', scopes: adminScopes },
  { id: 'tournaments.streak', name: 'Edit Streak Settings', description: 'Configure streak tournament rules', category: 'Tournaments', scopes: adminScopes },

  /* Casino ------------------------------------------------------------------ */
  { id: 'casino.view', name: 'View Casino Config', description: 'Access casino configuration page', category: 'Casino', scopes: adminScopes },
  { id: 'casino.manage', name: 'Manage Casino', description: 'Enable / disable casino games and providers', category: 'Casino', scopes: adminScopes },
  { id: 'casino.engine', name: 'Configure Casino Engine', description: 'Edit casino engine settings', category: 'Casino', scopes: adminScopes },

  /* P2P System -------------------------------------------------------------- */
  { id: 'p2p.dashboard', name: 'View P2P Dashboard', description: 'Access the P2P dashboard', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.transactions', name: 'View P2P Transactions', description: 'Access P2P transaction log', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.deposit_queue.view', name: 'View Deposit Queue', description: 'View P2P deposit queue', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.deposit_queue.approve', name: 'Approve Deposits', description: 'Approve / reject queued deposits', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.withdrawal_queue.view', name: 'View Withdrawal Queue', description: 'View P2P withdrawal queue', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.withdrawal_queue.approve', name: 'Approve Withdrawals', description: 'Approve / reject queued withdrawals', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.wallet_devices.view', name: 'View Wallet Devices', description: 'View wallet device list', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.wallet_devices.manage', name: 'Manage Wallet Devices', description: 'Register / edit / top-up wallet devices', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.wallet_devices.swap', name: 'Swap / Top-Up Devices', description: 'Run manual or withdrawal swaps on devices', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.wallet_devices.accounts.add', name: 'Add Linked Accounts to Wallet Devices', description: 'Add additional phone numbers / accounts under the same wallet device to expand transaction capacity', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.wallet_devices.accounts.remove', name: 'Remove Linked Accounts from Wallet Devices', description: 'Remove a previously linked phone number / account from a wallet device', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.device_control', name: 'Device Control', description: 'Send control commands to wallet devices', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.commands_queue', name: 'View Commands Queue', description: 'Access the commands queue', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.operators.view', name: 'View Operators', description: 'View P2P operators list', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.operators.manage', name: 'Manage Operators', description: 'Create / edit / suspend operators', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.operators.access.view', name: 'View Operator Access', description: 'Open the Operator Access (secure login link) management page', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.operators.access.send_link', name: 'Send Operator Access Link', description: 'Send a secure dashboard access email (no-reply) to an operator', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.operators.access.rotate', name: 'Rotate Operator Access Link', description: 'Regenerate an operator access token and invalidate the previous one', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.operators.access.revoke', name: 'Revoke Operator Access Link', description: 'Revoke an active operator access link immediately', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.operators.access.set_permissions', name: 'Set Operator Dashboard Permissions', description: 'Enable or disable individual operator dashboard cards per SIM owner', category: 'P2P System', scopes: adminScopes },

  /* Security / Authentication --------------------------------------------- */
  { id: 'security.otp.toggle_admin_otp', name: 'Toggle Admin OTP Enforcement', description: 'Enable or disable the requirement for administrators to verify a 6-digit OTP on login', category: 'Security', scopes: ['Super Admin'] },
  { id: 'security.otp.toggle_super_admin_otp', name: 'Toggle Super Admin OTP Enforcement', description: 'Enable or disable the requirement for Super Admin to verify a 6-digit OTP on login', category: 'Security', scopes: ['Super Admin'] },
  { id: 'security.password_reset.view', name: 'View Password Reset Audit', description: 'View the password reset request audit log', category: 'Security', scopes: adminScopes },
  { id: 'security.password_reset.revoke', name: 'Revoke Password Reset Requests', description: 'Revoke pending password reset tokens / OTP requests', category: 'Security', scopes: ['Super Admin'] },
  { id: 'auth.forgot_password.super_admin', name: 'Use Forgot Password (Super Admin)', description: 'Allow super admin to use the forgot-password flow (email / OTP). Always available to Super Admin.', category: 'Security', scopes: ['Super Admin'] },
  { id: 'p2p.limits.view', name: 'View Limits & Rules', description: 'View P2P limits & rules', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.limits.manage', name: 'Manage Limits & Rules', description: 'Edit P2P limits & rules', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.commissions.view', name: 'View Commissions', description: 'View P2P commission configuration', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.commissions.manage', name: 'Manage Commissions', description: 'Edit P2P commission rules', category: 'P2P System', scopes: adminScopes },
  { id: 'p2p.logs', name: 'View P2P Logs', description: 'Access P2P logs / monitoring', category: 'P2P System', scopes: adminScopes },

  /* Games ------------------------------------------------------------------- */
  { id: 'games.view', name: 'View Games', description: 'View games management page', category: 'Games', scopes: adminScopes },
  { id: 'games.rtp.view', name: 'View RTP Management', description: 'Open RTP management', category: 'Games', scopes: adminScopes },
  { id: 'games.rtp.edit', name: 'Edit RTP Values', description: 'Adjust RTP values per game / client', category: 'Games', scopes: adminScopes },
  { id: 'games.activity.view', name: 'View Game Activity', description: 'Monitor internal game bets, wins and losses per player', category: 'Games', scopes: adminScopes },

  /* Iframe Integration ------------------------------------------------------ */
  { id: 'iframe.outbound.view', name: 'View Outbound Iframe', description: 'View outbound iframe configuration', category: 'Iframe Integration', scopes: adminScopes },
  { id: 'iframe.outbound.manage', name: 'Manage Outbound Iframe', description: 'Generate embed snippets, manage domain whitelist', category: 'Iframe Integration', scopes: adminScopes },
  { id: 'iframe.inbound.view', name: 'View Inbound Iframe', description: 'View external providers configuration', category: 'Iframe Integration', scopes: adminScopes },
  { id: 'iframe.inbound.manage', name: 'Manage Inbound Iframe', description: 'Add / edit / remove external providers', category: 'Iframe Integration', scopes: adminScopes },

  /* Packages ---------------------------------------------------------------- */
  { id: 'packages.view', name: 'View Packages', description: 'Access packages management', category: 'Packages', scopes: adminScopes },
  { id: 'packages.manage', name: 'Manage Packages', description: 'Create / edit / delete packages', category: 'Packages', scopes: adminScopes },

  /* APIs & Integrations ----------------------------------------------------- */
  { id: 'apis.view', name: 'View APIs & Integrations', description: 'Access APIs & integrations page', category: 'APIs & Integrations', scopes: adminScopes },
  { id: 'apis.manage', name: 'Manage APIs & Integrations', description: 'Add / edit / remove integrations', category: 'APIs & Integrations', scopes: adminScopes },

  /* Settings ---------------------------------------------------------------- */
  /* Settings catalog is Super-Admin-only per Section 22 spec. */
  { id: 'settings.view', name: 'View Settings', description: 'Open the Settings section', category: 'Settings', scopes: ['Super Admin'] },
  { id: 'settings.general', name: 'Edit General Settings', description: 'Edit general settings', category: 'Settings', scopes: ['Super Admin'] },
  /* `settings.main` is the canonical ID from Section 22; `settings.main_config`
   * is kept as an alias for backwards-compat with older saved role rows. */
  { id: 'settings.main', name: 'Edit Main Configuration', description: 'Edit main configuration', category: 'Settings', scopes: ['Super Admin'] },
  { id: 'settings.main_config', name: 'Edit Main Configuration (alias)', description: 'Legacy alias for settings.main', category: 'Settings', scopes: ['Super Admin'] },
  { id: 'settings.payment', name: 'Edit Payment Configuration', description: 'Edit payment configuration', category: 'Settings', scopes: ['Super Admin'] },
  { id: 'settings.security', name: 'Edit Security Settings', description: 'Edit security settings', category: 'Settings', scopes: ['Super Admin'] },
  { id: 'settings.maintenance', name: 'Edit Maintenance Settings', description: 'Enter / exit maintenance mode', category: 'Settings', scopes: ['Super Admin'] },
  { id: 'settings.api_management', name: 'Edit API Management', description: 'Edit API management', category: 'Settings', scopes: ['Super Admin'] },
  { id: 'settings.sms', name: 'Edit SMS Config', description: 'Edit SMS configuration', category: 'Settings', scopes: ['Super Admin'] },
  { id: 'settings.game_picks', name: 'Edit Game Picks', description: 'Edit game pick lists', category: 'Settings', scopes: ['Super Admin'] },
  { id: 'settings.match_stats', name: 'Edit Match Stats', description: 'Edit match stats configuration', category: 'Settings', scopes: ['Super Admin'] },

  /* Monitoring -------------------------------------------------------------- */
  { id: 'monitoring.activity', name: 'View User Activity Logs', description: 'Access user activity monitoring', category: 'Monitoring', scopes: adminScopes },
  { id: 'monitoring.errors', name: 'View Error Tracking', description: 'Access error tracking', category: 'Monitoring', scopes: adminScopes },
  { id: 'monitoring.performance', name: 'View Performance Analytics', description: 'Access performance analytics', category: 'Monitoring', scopes: adminScopes },
  { id: 'monitoring.notifications', name: 'View System Notifications', description: 'Access system notifications', category: 'Monitoring', scopes: adminScopes },
  { id: 'monitoring.audit', name: 'View Audit Trail', description: 'Access the audit trail', category: 'Monitoring', scopes: adminScopes },
];

/* -------------------------------------------------------------------------- */
/*  Agent permission catalog                                                  */
/*  Agents get their own scope-specific set — still covers sales/branches +   */
/*  dedicated P2P access permissions so an agent can be gated into just the   */
/*  P2P dashboard if needed.                                                  */
/* -------------------------------------------------------------------------- */
const agentScope: PermissionScope[] = ['Agent'];

const agentCatalog: Permission[] = [
  /* Existing (kept for backwards-compat — IDs must not change) */
  { id: 'list_sales', name: 'List Sales', description: 'View and manage sales staff list', category: 'List Management', scopes: agentScope },
  { id: 'list_branches', name: 'List Branches', description: 'View and manage branch list', category: 'List Management', scopes: agentScope },
  { id: 'list_offline_tickets', name: 'List Offline Tickets', description: 'View offline betting tickets', category: 'List Management', scopes: agentScope },
  { id: 'access_dashboard', name: 'Access Dashboard', description: 'Access to dashboard information', category: 'Dashboard Access', scopes: agentScope },
  { id: 'view_cashreport', name: 'View Cashreport', description: 'Access to cash report information', category: 'Dashboard Access', scopes: agentScope },
  { id: 'payout_disabled', name: 'Payout Disabled', description: 'Disable payout functionality', category: 'Transaction Restrictions', scopes: agentScope },
  { id: 'withdraw_disabled', name: 'Withdraw Disabled', description: 'Disable withdrawal functionality', category: 'Transaction Restrictions', scopes: agentScope },
  { id: 'deposit_disabled', name: 'Deposit Disabled', description: 'Disable deposit functionality', category: 'Transaction Restrictions', scopes: agentScope },

  /* Staff management */
  { id: 'agent.sales.create', name: 'Create Sales Staff', description: 'Create new sales staff accounts under this agent', category: 'Staff Management', scopes: agentScope },
  { id: 'agent.sales.edit', name: 'Edit Sales Staff', description: 'Edit sales staff accounts under this agent', category: 'Staff Management', scopes: agentScope },
  { id: 'agent.sales.reset_password', name: 'Reset Sales Password', description: 'Reset passwords for sales staff under this agent', category: 'Staff Management', scopes: agentScope },
  { id: 'agent.branches.manage', name: 'Manage Branches', description: 'Create / edit branches linked to this agent', category: 'Staff Management', scopes: agentScope },

  /* Financial */
  { id: 'agent.wallet.view', name: 'View Own Wallet', description: 'See own agent wallet balance and history', category: 'Financial', scopes: agentScope },
  { id: 'agent.wallet.topup', name: 'Top Up Wallet', description: 'Request wallet top-ups', category: 'Financial', scopes: agentScope },
  { id: 'agent.wallet.transfer', name: 'Transfer Between Sales', description: 'Move balance between sales staff', category: 'Financial', scopes: agentScope },
  { id: 'agent.credit_limit.view', name: 'View Credit Limit', description: 'See assigned credit limit', category: 'Financial', scopes: agentScope },

  /* Bets & transactions */
  { id: 'agent.bets.view', name: 'View Bets', description: 'View bets placed under this agent', category: 'Bets & Transactions', scopes: agentScope },
  { id: 'agent.bets.cancel', name: 'Cancel Bets', description: 'Cancel bets under this agent', category: 'Bets & Transactions', scopes: agentScope },
  { id: 'agent.transactions.view', name: 'View Transactions', description: 'View transactions under this agent', category: 'Bets & Transactions', scopes: agentScope },

  /* P2P Access (NEW) — granular gates for the agent P2P dashboard */
  { id: 'agent.p2p.dashboard', name: 'Access P2P Dashboard', description: 'Open the P2P dashboard', category: 'P2P Access', scopes: agentScope },
  { id: 'agent.p2p.transactions', name: 'View P2P Transactions', description: 'View own P2P transactions', category: 'P2P Access', scopes: agentScope },
  { id: 'agent.p2p.deposit_queue.view', name: 'View Deposit Queue', description: 'View P2P deposit queue', category: 'P2P Access', scopes: agentScope },
  { id: 'agent.p2p.deposit_queue.approve', name: 'Approve P2P Deposits', description: 'Approve deposits from the P2P queue', category: 'P2P Access', scopes: agentScope },
  { id: 'agent.p2p.withdrawal_queue.view', name: 'View Withdrawal Queue', description: 'View P2P withdrawal queue', category: 'P2P Access', scopes: agentScope },
  { id: 'agent.p2p.withdrawal_queue.approve', name: 'Approve P2P Withdrawals', description: 'Approve withdrawals from the P2P queue', category: 'P2P Access', scopes: agentScope },
  { id: 'agent.p2p.wallet_devices.view', name: 'View Wallet Devices', description: 'View linked P2P wallet devices', category: 'P2P Access', scopes: agentScope },
  { id: 'agent.p2p.wallet_devices.swap', name: 'Swap / Top-Up Devices', description: 'Run manual or withdrawal swaps on devices', category: 'P2P Access', scopes: agentScope },
  { id: 'agent.p2p.commissions.view', name: 'View Commissions', description: 'View own P2P commissions', category: 'P2P Access', scopes: agentScope },
  { id: 'agent.p2p.logs', name: 'View P2P Logs', description: 'View own P2P activity logs', category: 'P2P Access', scopes: agentScope },
];

/* -------------------------------------------------------------------------- */
/*  Sales (kept EXACTLY as-is per product direction)                          */
/* -------------------------------------------------------------------------- */
const salesScope: PermissionScope[] = ['Sales Staff'];

const salesCatalog: Permission[] = [
  { id: 'deposit', name: 'Deposit', description: 'Process customer deposits', category: 'Sales Operations', scopes: salesScope },
  { id: 'withdraw', name: 'Withdraw', description: 'Process customer withdrawals', category: 'Sales Operations', scopes: salesScope },
  { id: 'sell_tickets', name: 'Sell Tickets', description: 'Sell betting tickets to customers', category: 'Sales Operations', scopes: salesScope },
  { id: 'sell_jackpots', name: 'Sell Jackpots', description: 'Sell jackpot tickets to customers', category: 'Sales Operations', scopes: salesScope },
  { id: 'can_payout', name: 'Can Payout', description: 'Process payouts for winning tickets', category: 'Sales Operations', scopes: salesScope },
  { id: 'cancel_tickets', name: 'Cancel Sold Tickets', description: 'Cancel previously sold tickets', category: 'Sales Operations', scopes: salesScope },
  { id: 'cancel_jackpots', name: 'Cancel Sold Jackpots', description: 'Cancel previously sold jackpot tickets', category: 'Sales Operations', scopes: salesScope },
  { id: 'cancel_deposit', name: 'Cancel Deposit', description: 'Cancel customer deposits', category: 'Sales Operations', scopes: salesScope },
  { id: 'date_filter_dashboard', name: 'Date Filter Dashboard', description: 'Filter dashboard data by date', category: 'Sales Operations', scopes: salesScope },
  { id: 'request_withdrawal', name: 'Sales Can Request Withdrawal', description: 'Request withdrawals for customers', category: 'Sales Operations', scopes: salesScope },
  { id: 'disable_sales', name: 'Disable Sales', description: 'Temporarily disable sales operations', category: 'Sales Operations', scopes: salesScope },
  { id: 'super_sales', name: 'Is Super Sales?', description: 'Grant super sales privileges', category: 'Sales Operations', scopes: salesScope },
];

/* -------------------------------------------------------------------------- */
/*  Operator (SIM-card owner) self-service dashboard permissions              */
/*  Each of these gates one card / panel on the operator dashboard the owner  */
/*  reaches after clicking the secure email link from the super admin.        */
/* -------------------------------------------------------------------------- */
const operatorScope: PermissionScope[] = ['Operator'];

const operatorCatalog: Permission[] = [
  { id: 'operator.dashboard.view', name: 'Access Dashboard', description: 'Open the operator dashboard at all', category: 'Operator Dashboard', scopes: operatorScope },
  { id: 'operator.dashboard.status.view', name: 'View Status', description: 'See device online / offline status', category: 'Operator Dashboard', scopes: operatorScope },
  { id: 'operator.dashboard.balance.view', name: 'View Balance', description: 'See wallet balance', category: 'Operator Dashboard', scopes: operatorScope },
  { id: 'operator.dashboard.commission.view', name: 'View Commission', description: 'See commission rate and earned commission', category: 'Operator Dashboard', scopes: operatorScope },
  { id: 'operator.dashboard.pre_deposit.view', name: 'View Pre-Deposit', description: 'See pre-deposit amount', category: 'Operator Dashboard', scopes: operatorScope },
  { id: 'operator.dashboard.total_capacity.view', name: 'View Total Capacity', description: 'See total capacity (pre-deposit + commission headroom)', category: 'Operator Dashboard', scopes: operatorScope },
  { id: 'operator.dashboard.available_capacity.view', name: 'View Available Capacity', description: 'See available capacity remaining', category: 'Operator Dashboard', scopes: operatorScope },
  { id: 'operator.dashboard.swap_activity.view', name: 'View Swap Activity', description: 'See today / recent swap activity', category: 'Operator Dashboard', scopes: operatorScope },
  { id: 'operator.dashboard.revenue.view', name: 'View Revenue', description: 'See revenue today / 7 days / 30 days', category: 'Operator Dashboard', scopes: operatorScope },
];

/* -------------------------------------------------------------------------- */
/*  Branch (existing)                                                         */
/* -------------------------------------------------------------------------- */
const branchScope: PermissionScope[] = ['Branch'];

const branchCatalog: Permission[] = [
  { id: 'branch.payout_disabled', name: 'Payout Disabled', description: 'Disable payout functionality for this branch', category: 'Transaction Restrictions', scopes: branchScope },
  { id: 'branch.withdraw_disabled', name: 'Withdraw Disabled', description: 'Disable withdrawal functionality for this branch', category: 'Transaction Restrictions', scopes: branchScope },
  { id: 'branch.deposit_disabled', name: 'Deposit Disabled', description: 'Disable deposit functionality for this branch', category: 'Transaction Restrictions', scopes: branchScope },
  { id: 'branch.set_minimum_stake', name: 'Set Minimum Stake', description: 'Set minimum stake amount for bets', category: 'Transaction Restrictions', scopes: branchScope },
];

/* -------------------------------------------------------------------------- */
/*  Public helpers                                                            */
/* -------------------------------------------------------------------------- */
export const BUILT_IN_PERMISSIONS: Permission[] = [
  ...administratorCatalog,
  ...agentCatalog,
  ...salesCatalog,
  ...branchCatalog,
  ...operatorCatalog,
];

export function getPermissionsForScope(
  scope: PermissionScope,
  custom: Permission[] = []
): Permission[] {
  return [...BUILT_IN_PERMISSIONS, ...custom].filter((p) => p.scopes.includes(scope));
}

/**
 * Section 22 — Super Admin sentinel.
 *
 * The backend stamps a single entry "*" on the JWT when the user is a
 * super admin; the frontend's `hasPermission()` helper treats it as a
 * wildcard so super admins implicitly pass every gate. This sentinel
 * never appears in the saved Role row — it is added at token issuance.
 */
export const SUPERADMIN_WILDCARD = '*';

/** Convenience — returns the full list of catalog permission IDs. Used by
 *  the Role Settings modal to "Select All" for an administrator role. */
export function allPermissionIds(): string[] {
  return BUILT_IN_PERMISSIONS.map((p) => p.id);
}

/* -------------------------------------------------------------------------- */
/*  Zustand store for Super-Admin-added custom permissions                    */
/*  Persisted locally so adding a permission survives a reload.               */
/* -------------------------------------------------------------------------- */
interface CustomPermissionsState {
  custom: Permission[];
  addCustom: (p: Omit<Permission, 'id'> & { id?: string }) => Permission;
  removeCustom: (id: string) => void;
}

export const useCustomPermissions = create<CustomPermissionsState>()(
  persist(
    (set, get) => ({
      custom: [],
      addCustom: (p) => {
        const id =
          p.id ||
          `custom.${p.category.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.${Date.now()}`;
        const entry: Permission = {
          id,
          name: p.name,
          description: p.description,
          category: p.category,
          scopes: p.scopes,
        };
        set({ custom: [...get().custom, entry] });
        return entry;
      },
      removeCustom: (id) => set({ custom: get().custom.filter((p) => p.id !== id) }),
    }),
    { name: 'custom-permissions-storage' }
  )
);
