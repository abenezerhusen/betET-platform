/**
 * Section 19 — read-only public configuration consumed by the user panel.
 *
 * Backed by /api/public/{general,top-bets,top-matches,promotions,operation-hours}.
 * These endpoints require only the tenant header (no auth) so they can
 * be called on landing pages, in the splash screen, etc.
 */

import { apiRequest } from './client';

export interface PublicGeneral {
  platform_name: string;
  logo_url: string;
  currency: string;
  country: string;
  country_code: string;
  timezone: string;
  website_url: string;
  offline_bet_support: boolean;
  offline_payout: boolean;
  enable_language_selection: boolean;
  social: {
    facebook: string;
    telegram: string;
    tiktok: string;
    instagram: string;
    twitter: string;
  };
  contact: { email: string; phone: string };
  support: { phone: string; email: string };
  underage_disclaimer: string;
  about_us: string;
  /** Admin-managed Terms & Conditions body (Settings → General → Company). */
  terms_and_conditions: string;
  /** Admin-managed footer blurb (Settings → General → Company). */
  footer_text: string;
}

export interface TopBetEntry {
  id?: string;
  league: string;
  league_group?: string;
  sport_type?: string;
}

export interface TopMatchEntry {
  id?: string;
  match?: string;
  match_id?: string;
  home_team?: string;
  away_team?: string;
  league?: string;
  country?: string;
  sport_type?: string;
  schedule?: string;
  starts_at?: string;
}

export interface PromotionBanner {
  id?: string;
  title: string;
  image_url: string;
  bonus_type?: string;
  description?: string;
  cta_url?: string;
  is_active?: boolean;
  display_order?: number;
}

export interface OperationHoursDay {
  open: string;
  close: string;
  closed?: boolean;
}

export interface OperationHoursPayload {
  open_now: boolean;
  enforce_bets: boolean;
  timezone: string;
  hours: Partial<
    Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', OperationHoursDay>
  >;
}

export function getPublicGeneral(): Promise<PublicGeneral> {
  return apiRequest<PublicGeneral>('/api/public/general');
}

export function listTopBets(): Promise<{ items: TopBetEntry[] }> {
  return apiRequest<{ items: TopBetEntry[] }>('/api/public/top-bets');
}

export function listTopMatches(): Promise<{ items: TopMatchEntry[] }> {
  return apiRequest<{ items: TopMatchEntry[] }>('/api/public/top-matches');
}

export function listPromotionBanners(): Promise<{ items: PromotionBanner[] }> {
  return apiRequest<{ items: PromotionBanner[] }>('/api/public/promotions');
}

export function getOperationHours(): Promise<OperationHoursPayload> {
  return apiRequest<OperationHoursPayload>('/api/public/operation-hours');
}
