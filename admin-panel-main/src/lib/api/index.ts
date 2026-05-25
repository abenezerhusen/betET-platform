/**
 * Barrel for the admin-panel API client. Use:
 *
 *   import { users, wallets, reports } from '@/lib/api'
 *   const list = await users.listUsers({ role: 'agent' })
 *
 * or import individual functions:
 *
 *   import { listUsers } from '@/lib/api/users'
 */

export * from './client';
export * from './types';

import * as auth from './auth';
import * as dashboard from './dashboard';
import * as users from './users';
import * as tenants from './tenants';
import * as roles from './roles';
import * as wallets from './wallets';
import * as games from './games';
import * as reports from './reports';
import * as panelReports from './panel-reports';
import * as transactions from './transactions';
import * as auditLogs from './audit-logs';
import * as logs from './logs';
import * as analytics from './analytics';
import * as monitoring from './monitoring';
import * as settings from './settings';
import * as configurations from './configurations';
import * as bonuses from './bonuses';
import * as paymentMethods from './payment-methods';
import * as telebirr from './telebirr';
import * as p2p from './p2p';
import * as promotions from './promotions';
import * as tournaments from './tournaments';
import * as casino from './casino';
import * as sportsbook from './sportsbook';
import * as bets from './bets';
import * as jackpots from './jackpots';
import * as betForMe from './betForMe';

export {
  auth,
  dashboard,
  users,
  tenants,
  roles,
  wallets,
  games,
  reports,
  panelReports,
  transactions,
  auditLogs,
  logs,
  analytics,
  monitoring,
  settings,
  configurations,
  bonuses,
  paymentMethods,
  telebirr,
  p2p,
  promotions,
  tournaments,
  casino,
  sportsbook,
  bets,
  jackpots,
  betForMe,
};
