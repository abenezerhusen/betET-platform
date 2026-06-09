/**
 * /api/admin/game-activity — internal-game per-bet monitoring.
 *
 * Lists every bet placed on the internal games (Aviator / JetX / Fast Keno /
 * Multi Hot 5) from the `game_bets` table, joined to the player and round, so
 * admins can monitor stakes, wins, losses, cash-out multipliers and the net
 * result per player.
 */
import { http } from './client';

export interface GameActivityQuery {
  from?: string;
  to?: string;
  game_id?: 'aviator' | 'jetx' | 'fast-keno' | 'multi-hot-5';
  status?: 'active' | 'cashed_out' | 'lost' | 'won';
  result?: 'win' | 'loss' | 'pending';
  user_id?: string;
  phone?: string;
  search?: string;
  min_amount?: number;
  max_amount?: number;
  limit?: number;
  offset?: number;
  [key: string]: string | number | boolean | null | undefined;
}

export interface GameBetRow {
  id: string;
  tenant_id: string;
  round_id: string;
  user_id: string | null;
  game_id: string;
  amount: string | number;
  payout: string | number;
  net: string | number;
  multiplier: string | number | null;
  auto_cashout: string | number | null;
  selected_numbers: number[] | null;
  lines: number | null;
  status: string;
  result: 'win' | 'loss' | 'pending';
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  crash_point: string | number | null;
  server_seed_hash: string | null;
  user_email: string | null;
  user_phone: string | null;
  user_name: string | null;
}

export interface GameActivitySummary {
  total_bets?: string;
  total_staked?: string;
  total_payout?: string;
  ggr?: string;
  win_count?: string;
  loss_count?: string;
  pending_count?: string;
  player_count?: string;
}

export interface GameActivityResponse {
  items: GameBetRow[];
  total?: number;
  limit?: number;
  offset?: number;
  summary?: GameActivitySummary | null;
}

export function listGameActivity(
  query: GameActivityQuery = {}
): Promise<GameActivityResponse> {
  return http.get<GameActivityResponse>('/api/admin/game-activity', { query });
}
