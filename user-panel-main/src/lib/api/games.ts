/**
 * Games + bets endpoints exposed to the end-user.
 */

import { apiRequest } from './client';
import type {
  GameSummary,
  BetSummaryItem,
  PaginatedResponse,
} from './types';

export interface ListGamesQuery {
  page?: number;
  limit?: number;
  type?:
    | 'sports'
    | 'casino'
    | 'live_casino'
    | 'virtual'
    | 'crash'
    | 'keno'
    | 'slot'
    | 'table'
    | 'jackpot'
    | 'custom';
  provider?: string;
  search?: string;
}

export async function listGames(
  query: ListGamesQuery = {}
): Promise<PaginatedResponse<GameSummary>> {
  return apiRequest<PaginatedResponse<GameSummary>>('/api/public/games', {
    query: query as Record<string, string | number | undefined>,
    skipAuth: true,
    skipRefresh: true,
  });
}

export interface PlaceBetInput {
  game_id: string;
  session_id?: string;
  stake: string | number;
  potential_win?: string | number;
  currency?: string;
  selection?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  idempotency_key?: string;
}

export async function placeBet(input: PlaceBetInput): Promise<{
  bet: {
    id: string;
    status: string;
    stake: string;
    potential_win: string;
  };
  wallet: {
    id: string;
    balance: string;
    bonus_balance: string;
    locked_balance: string;
  };
  transaction: {
    id: string;
    reference: string | null;
    amount: string;
    before_balance: string;
    after_balance: string;
  };
  idempotent: boolean;
}> {
  return apiRequest('/api/user/bets/place', {
    method: 'POST',
    body: input,
  });
}

export async function getBet(id: string): Promise<BetSummaryItem> {
  return apiRequest<BetSummaryItem>(`/api/user/bets/${id}`);
}

export interface CouponResult {
  coupon_code: string;
  bet_id: string;
  status: string;
  stake: string;
  potential_win: string;
  payout: string | null;
  currency: string;
  game_id: string | null;
  placed_at: string;
  settled_at: string | null;
  selection: unknown;
  metadata: Record<string, unknown>;
}

export async function getCouponByCode(code: string): Promise<CouponResult> {
  return apiRequest<CouponResult>(`/api/user/bets/coupon/${encodeURIComponent(code.trim())}`);
}

export interface CreateGameSessionBody {
  game_id: string;
  currency?: string;
  language?: string;
  return_url?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateGameSessionResponse {
  session_id: string;
  launch_url: string;
  token: string;
  expires_at: string;
  game: { id: string; name: string; provider: string; type: string };
  tenant: { id: string; slug: string };
  wallet: { id: string; currency: string; balance: string; bonus_balance: string };
}

export async function createGameSession(
  body: CreateGameSessionBody
): Promise<CreateGameSessionResponse> {
  return apiRequest<CreateGameSessionResponse>('/api/game/session/create', {
    method: 'POST',
    body,
  });
}

export async function endGameSession(sessionId: string): Promise<{
  session: unknown;
  already_ended: boolean;
}> {
  return apiRequest(`/api/game/session/${sessionId}/end`, {
    method: 'POST',
    body: {},
  });
}

/* ----------------------------------------------------------------------- */
/* Section 15 — Internal games lobby + external provider games             */
/* ----------------------------------------------------------------------- */

export interface InternalLobbyGame {
  id: string;
  name: string;
  provider: string;
  slug: string | null;
  thumbnail_url: string | null;
  game_type: string | null;
  min_bet: number;
  max_bet: number;
  rtp: number;
}

export interface LobbyResponse {
  top_games: InternalLobbyGame[];
  new_games: InternalLobbyGame[];
  popular_games: InternalLobbyGame[];
  all_games: InternalLobbyGame[];
}

export async function getInternalGamesLobby(): Promise<LobbyResponse> {
  return apiRequest<LobbyResponse>('/api/games/lobby', {
    skipAuth: true,
    skipRefresh: true,
  });
}

export interface ExternalGameRow {
  id: string;
  name: string;
  thumbnail_url: string;
  provider: string;
  provider_id: string;
  is_external: true;
}

export async function listExternalGames(): Promise<{ games: ExternalGameRow[] }> {
  return apiRequest<{ games: ExternalGameRow[] }>('/api/games/external/list', {
    skipAuth: true,
    skipRefresh: true,
  });
}

export interface ExternalLaunchResponse {
  session_id: string;
  session_token: string;
  launch_url: string;
  provider: { id: string; name: string };
  game_id: string;
}

export async function launchExternalGame(
  body: { provider_id: string; game_id: string; currency?: string; language?: string }
): Promise<ExternalLaunchResponse> {
  return apiRequest<ExternalLaunchResponse>('/api/games/external/launch', {
    method: 'POST',
    body,
  });
}

export async function endExternalGameSession(sessionId: string): Promise<{ ok: boolean; ended: boolean }> {
  return apiRequest<{ ok: boolean; ended: boolean }>(
    `/api/games/external/sessions/${sessionId}/end`,
    { method: 'POST', body: {} }
  );
}

export interface AviatorRoundState {
  round_id: string | null;
  phase: 'waiting' | 'flying' | 'crashed' | string;
  current_multiplier?: number | null;
  crash_point?: number | null;
  server_seed_hash?: string;
  client_seed?: string;
}

export async function getAviatorRoundCurrent(): Promise<AviatorRoundState> {
  return apiRequest<AviatorRoundState>('/api/games/aviator/round/current');
}

export async function placeAviatorBet(input: {
  round_id: string;
  amount: number;
  auto_cashout?: number;
}): Promise<{
  bet_id: string;
  round_id: string;
  amount: number;
  balance_after: number;
}> {
  return apiRequest('/api/games/aviator/bet', {
    method: 'POST',
    body: input,
  });
}

export async function cashoutAviator(input: {
  round_id: string;
  bet_id: string;
}): Promise<{
  payout: number;
  multiplier_at_cashout: number;
  balance_after: number;
}> {
  return apiRequest('/api/games/aviator/cashout', {
    method: 'POST',
    body: input,
  });
}

export async function getJetxRoundCurrent(): Promise<AviatorRoundState> {
  return apiRequest<AviatorRoundState>('/api/games/jetx/round/current');
}

export async function placeJetxBet(input: {
  round_id: string;
  amount: number;
  auto_cashout?: number;
}): Promise<{
  bet_id: string;
  round_id: string;
  amount: number;
  balance_after: number;
}> {
  return apiRequest('/api/games/jetx/bet', {
    method: 'POST',
    body: input,
  });
}

export async function cashoutJetx(input: {
  round_id: string;
  bet_id: string;
}): Promise<{
  payout: number;
  multiplier_at_cashout: number;
  balance_after: number;
}> {
  return apiRequest('/api/games/jetx/cashout', {
    method: 'POST',
    body: input,
  });
}

export interface KenoRoundState {
  round_id: string | null;
  phase: 'betting' | 'drawing' | 'complete' | string;
  numbers_drawn: number[];
  time_remaining: number;
}

export async function getKenoRoundCurrent(): Promise<KenoRoundState> {
  return apiRequest<KenoRoundState>('/api/games/keno/round/current');
}

export async function placeKenoBet(input: {
  round_id: string;
  selected_numbers: number[];
  spots: number;
  amount: number;
}): Promise<{
  bet_id: string;
  balance_after: number;
}> {
  return apiRequest('/api/games/keno/bet', {
    method: 'POST',
    body: input,
  });
}
