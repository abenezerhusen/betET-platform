/** /api/admin/casino — providers / categories / tags / games / engine config */
import { http } from './client';

export interface CasinoProvider {
  id: string;
  tenant_id?: string | null;
  name: string;
  slug: string;
  logo_url?: string | null;
  is_active: boolean;
  config?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function listProviders() {
  return http.get<{ items: CasinoProvider[] }>('/api/admin/casino/providers');
}

export function createProvider(input: Partial<CasinoProvider>) {
  return http.post<CasinoProvider>('/api/admin/casino/providers', input);
}

export function updateProvider(id: string, input: Partial<CasinoProvider>) {
  return http.put<CasinoProvider>(`/api/admin/casino/providers/${id}`, input);
}

export function deleteProvider(id: string) {
  return http.delete<{ id: string }>(`/api/admin/casino/providers/${id}`);
}

export interface CasinoCategory {
  id: string;
  tenant_id?: string | null;
  name: string;
  slug: string;
  icon_url?: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function listCategories() {
  return http.get<{ items: CasinoCategory[] }>('/api/admin/casino/categories');
}

export function createCategory(input: Partial<CasinoCategory>) {
  return http.post<CasinoCategory>('/api/admin/casino/categories', input);
}

export function updateCategory(id: string, input: Partial<CasinoCategory>) {
  return http.put<CasinoCategory>(`/api/admin/casino/categories/${id}`, input);
}

export function deleteCategory(id: string) {
  return http.delete<{ id: string }>(`/api/admin/casino/categories/${id}`);
}

export interface CasinoTag {
  id: string;
  tenant_id?: string | null;
  name: string;
  slug: string;
  color?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function listTags() {
  return http.get<{ items: CasinoTag[] }>('/api/admin/casino/tags');
}

export function createTag(input: Partial<CasinoTag>) {
  return http.post<CasinoTag>('/api/admin/casino/tags', input);
}

export function updateTag(id: string, input: Partial<CasinoTag>) {
  return http.put<CasinoTag>(`/api/admin/casino/tags/${id}`, input);
}

export function deleteTag(id: string) {
  return http.delete<{ id: string }>(`/api/admin/casino/tags/${id}`);
}

export interface CasinoGame {
  id: string;
  tenant_id?: string | null;
  provider_id?: string | null;
  category_id?: string | null;
  name: string;
  slug: string;
  image_url?: string | null;
  rtp?: number | string | null;
  volatility?: 'low' | 'medium' | 'high' | 'very_high' | null;
  is_active: boolean;
  is_featured: boolean;
  display_order: number;
  config?: Record<string, unknown>;
  /** Joined from casino_providers */
  provider_name?: string | null;
  /** Joined from casino_categories */
  category_name?: string | null;
  /** Aggregated from casino_game_tags */
  tag_ids?: string[];
  created_at: string;
  updated_at: string;
}

export function listGames(query: {
  provider_id?: string;
  category_id?: string;
  is_active?: boolean;
  search?: string;
  page?: number;
  limit?: number;
} = {}) {
  return http.get<{
    items: CasinoGame[];
    total?: number;
    page?: number;
    limit?: number;
  }>('/api/admin/casino/games', { query });
}

export interface CreateGamePayload {
  provider_id?: string;
  category_id?: string;
  name: string;
  slug: string;
  image_url?: string;
  rtp?: number;
  volatility?: 'low' | 'medium' | 'high' | 'very_high';
  is_active?: boolean;
  is_featured?: boolean;
  display_order?: number;
  tag_ids?: string[];
  config?: Record<string, unknown>;
}

export function createGame(input: CreateGamePayload) {
  return http.post<CasinoGame>('/api/admin/casino/games', input);
}

export function updateGame(id: string, input: Partial<CreateGamePayload>) {
  return http.put<CasinoGame>(`/api/admin/casino/games/${id}`, input);
}

/** Spec: PATCH /api/admin/casino/games/:id/status */
export function toggleGameStatus(id: string, is_active: boolean) {
  return http.patch<CasinoGame>(`/api/admin/casino/games/${id}/status`, {
    is_active,
  });
}

export function deleteGame(id: string) {
  return http.delete<{ id: string }>(`/api/admin/casino/games/${id}`);
}

/** Spec: GET /api/admin/casino/engine/config (alias of /engine-config). */
export function getEngineConfig() {
  return http.get<Record<string, unknown>>('/api/admin/casino/engine/config');
}

/** Persists JSON under settings key `casino.engine.config` (backend expects `{ config }`). */
export function updateEngineConfig(config: Record<string, unknown>) {
  return http.put<Record<string, unknown>>('/api/admin/casino/engine/config', { config });
}
