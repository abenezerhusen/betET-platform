import { apiRequest } from './client';

export interface SportsMatchRow {
  id: string;
  sport: string;
  league: string | null;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: 'scheduled' | 'live' | 'finished';
  home_score: number;
  away_score: number;
  minute: number;
  total_bets: number;
  home_odds: number;
  draw_odds: number;
  away_odds: number;
}

export interface SportsMarket {
  id: string;
  name: string;
  selections: Array<{ id: string; name: string; odds: number }>;
}

export interface SportsMatchDetail {
  id: string;
  sport: string;
  league: string | null;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: string;
  home_score: number;
  away_score: number;
  minute: number;
  markets: SportsMarket[];
}

export function listSportsMatches(params?: {
  type?: 'express';
  sort?: 'popularity';
  /** 'upcoming' is a spec alias for 'scheduled' — backend accepts both. */
  status?: 'scheduled' | 'upcoming' | 'live' | 'completed';
  is_featured?: boolean;
  sport?: string;
  league?: string;
  page?: number;
  limit?: number;
}) {
  return apiRequest<{ items: SportsMatchRow[]; total: number; page: number; limit: number }>(
    '/api/sports/matches',
    {
      method: 'GET',
      query: params as Record<string, string | number | boolean | undefined>,
    }
  );
}

export function getSportsMatch(id: string) {
  return apiRequest<SportsMatchDetail>(`/api/sports/matches/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
}

/* ----------------------------------------------------------------------- */
/* Catalog (sidebar)                                                       */
/* ----------------------------------------------------------------------- */

export interface SportsCatalogLeague {
  name: string;
  live_count: number;
  upcoming_count: number;
}

export interface SportsCatalogNode {
  sport: string;
  label: string;
  live_count: number;
  upcoming_count: number;
  leagues: SportsCatalogLeague[];
}

export function getSportsCatalog() {
  return apiRequest<{ sports: SportsCatalogNode[] }>('/api/sports/catalog', {
    method: 'GET',
    skipAuth: true,
    skipRefresh: true,
  });
}

/* ----------------------------------------------------------------------- */
/* Virtual sports                                                          */
/* ----------------------------------------------------------------------- */

export interface VirtualSportRound {
  id: string;
  sport: string;
  label: string;
  round_no: number;
  starts_at: string;
  status: 'scheduled' | 'live';
  home_team: string;
  away_team: string;
  odds: { home: number; draw?: number; away: number };
}

export function getVirtualSportsSchedule() {
  return apiRequest<{ items: VirtualSportRound[]; round_duration_seconds: number }>(
    '/api/sports/virtual/schedule',
    {
      method: 'GET',
      skipAuth: true,
      skipRefresh: true,
    }
  );
}

export function placeVirtualSportsBet(body: {
  round_id: string;
  selection: 'home' | 'draw' | 'away';
  stake: number;
  odds: number;
}) {
  return apiRequest<{
    bet_id: string;
    balance: number;
    potential_win: number;
    status: string;
  }>('/api/sports/virtual/bet', {
    method: 'POST',
    body,
  });
}
