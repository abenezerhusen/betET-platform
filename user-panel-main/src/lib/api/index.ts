/**
 * Barrel re-exports for the user-panel API client.
 *
 * Components should import from `@/lib/api`:
 *
 *   import { authApi, walletApi, profileApi } from '@/lib/api';
 *
 * The named `*Api` aliases are kept stable for consumers, even if the
 * underlying module structure is refactored later.
 */

export { apiRequest, ApiError, apiConfig } from './client';
export * from './types';

import * as authApi from './auth';
import * as profileApi from './profile';
import * as walletApi from './wallet';
import * as gamesApi from './games';
import * as bonusesApi from './bonuses';
import * as gamePicksApi from './gamePicks';
import * as sportsApi from './sports';
import * as promotionsApi from './promotions';
import * as liveCasinoApi from './liveCasino';
import * as tournamentsApi from './tournaments';
import * as betsApi from './bets';
import * as publicConfigApi from './publicConfig';
import * as jackpotsApi from './jackpots';

export {
  authApi,
  profileApi,
  walletApi,
  gamesApi,
  bonusesApi,
  gamePicksApi,
  sportsApi,
  promotionsApi,
  liveCasinoApi,
  tournamentsApi,
  betsApi,
  publicConfigApi,
  jackpotsApi,
};
