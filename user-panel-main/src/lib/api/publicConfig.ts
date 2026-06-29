/**
 * Section 19 — read-only public configuration consumed by the user panel.
 *
 * Backed by /api/public/{general,top-bets,top-matches,promotions,operation-hours}.
 * These endpoints require only the tenant header (no auth) so they can
 * be called on landing pages, in the splash screen, etc.
 */

import { apiRequest } from './client';

// Branding / config / navigation rarely changes within a session, so it is
// safe to cache for a few minutes. Curated lists (top bets/matches, banners)
// use a shorter window. Real-time-sensitive endpoints (maintenance,
// operation hours) are deliberately left uncached so they always re-fetch.
const CONFIG_TTL = 5 * 60 * 1000;
const LIST_TTL = 60 * 1000;

export interface PublicGeneral {
  platform_name: string;
  logo_url: string;
  header_logo_url?: string;
  footer_logo_url?: string;
  logo_width?: number;
  logo_height?: number;
  footer_logo_width?: number;
  footer_logo_height?: number;
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
  static_banner_image_url?: string;
  static_banner_mobile_image_url?: string;
  static_banner_title?: string;
  static_banner_subtitle?: string;
  static_banner_width?: number;
  static_banner_height?: number;
  slider_banner_width?: number;
  slider_banner_height?: number;
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
  mobile_image_url?: string;
  image_width?: number;
  image_height?: number;
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
  return apiRequest<PublicGeneral>('/api/public/general', { cacheTtl: CONFIG_TTL });
}

export function listTopBets(): Promise<{ items: TopBetEntry[] }> {
  return apiRequest<{ items: TopBetEntry[] }>('/api/public/top-bets', { cacheTtl: LIST_TTL });
}

export function listTopMatches(): Promise<{ items: TopMatchEntry[] }> {
  return apiRequest<{ items: TopMatchEntry[] }>('/api/public/top-matches', { cacheTtl: LIST_TTL });
}

export function listPromotionBanners(): Promise<{ items: PromotionBanner[] }> {
  return apiRequest<{ items: PromotionBanner[] }>('/api/public/promotions', { cacheTtl: LIST_TTL });
}

export function getOperationHours(): Promise<OperationHoursPayload> {
  return apiRequest<OperationHoursPayload>('/api/public/operation-hours');
}

/* -------------------------------------------------------------------------- */
/* Footer Links                                                               */
/* -------------------------------------------------------------------------- */

export interface FooterLinkItem {
  name: string;
  href: string;
}

export interface FooterLinks {
  company_links?: FooterLinkItem[];
  legal_links?: FooterLinkItem[];
  sports_links?: FooterLinkItem[];
  copyright_text?: string;
  company_description?: string;
  live_chat_text?: string;
  support_email?: string;
  telegram_link?: string;
  social_links?: FooterLinkItem[];
  show_18_plus_notice?: boolean;
  notice_18_plus_text?: string;
}

export function getFooterLinks(): Promise<FooterLinks> {
  return apiRequest<FooterLinks>('/api/public/footer-links', { cacheTtl: CONFIG_TTL });
}

/* -------------------------------------------------------------------------- */
/* Game Thumbnails                                                             */
/* -------------------------------------------------------------------------- */

export interface GameThumbnailOverride {
  game_id: string;
  game_name?: string;
  thumbnail_url: string;
  promo_url?: string;
  is_active?: boolean;
}

export function listGameThumbnails(): Promise<{ items: GameThumbnailOverride[] }> {
  return apiRequest<{ items: GameThumbnailOverride[] }>('/api/public/game-thumbnails', {
    cacheTtl: CONFIG_TTL,
  });
}

export interface NavbarItem {
  id?: string;
  label: string;
  href: string;
  bucket?: 'main' | 'more';
  is_active?: boolean;
  display_order?: number;
}

export function listNavbarItems(): Promise<{ items: NavbarItem[] }> {
  return apiRequest<{ items: NavbarItem[] }>('/api/public/navbar', { cacheTtl: CONFIG_TTL });
}

/* -------------------------------------------------------------------------- */
/* Public Feature Flags — admin-controlled toggles the user panel needs       */
/* -------------------------------------------------------------------------- */

export interface PublicFeatures {
  /** Whether the cashout feature is globally enabled by the admin. */
  cashout_enabled: boolean;
  /** Whether users may self-cancel pending tickets. Defaults to false. */
  user_cancel_enabled: boolean;
  /** Cancel window (minutes before kickoff) — display-only; backend
   * always re-validates on the actual cancel request. */
  cancel_window_minutes: number;
}

export function getPublicFeatures(): Promise<PublicFeatures> {
  return apiRequest<PublicFeatures>('/api/public/features', { cacheTtl: CONFIG_TTL });
}

export interface PublicMaintenance {
  active: boolean;
  enabled: boolean;
  message: string;
}

export function getPublicMaintenance(): Promise<PublicMaintenance> {
  return apiRequest<PublicMaintenance>('/api/public/maintenance');
}
