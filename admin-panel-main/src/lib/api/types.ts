/**
 * Shared response shapes that the backend uses across modules. Anything
 * domain-specific lives next to its endpoint wrapper.
 */

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages?: number;
}

export interface OffsetPaged<T> {
  items: T[];
  total?: number;
  limit?: number;
  offset?: number;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  user: {
    id: string;
    tenant_id: string;
    role: string;
    email: string | null;
    phone: string | null;
    /**
     * Section 22 — permission IDs the backend resolved from the role
     * row. Super admin carries ['*']; the admin panel `hasPermission`
     * helper treats it as a wildcard.
     */
    permissions?: string[];
  };
}

export interface AdminUser {
  id: string;
  tenant_id: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: 'active' | 'suspended' | 'disabled' | 'pending' | 'banned' | string;
  kyc_status: 'pending' | 'submitted' | 'verified' | 'rejected' | 'expired' | string;
  metadata: Record<string, unknown>;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  /** Present when listUsers is called with `with_balance=true`. */
  balance?: string | null;
  bonus_balance?: string | null;
  locked_balance?: string | null;
  currency?: string | null;
  /** Present when listUsers is called with `with_activity=true`. */
  total_won?: string | null;
  last_bet_at?: string | null;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  config?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Wallet {
  id: string;
  tenant_id: string;
  user_id: string;
  currency: string;
  balance: string;
  bonus_balance?: string | null;
  locked_balance?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Bonus {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  amount?: string | null;
  percentage?: number | null;
  currency?: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  rules?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface GameRow {
  id: string;
  tenant_id: string;
  provider: string;
  name: string;
  slug?: string | null;
  type: string;
  is_iframe: boolean;
  iframe_url?: string | null;
  is_active: boolean;
  status: string;
  rtp?: number | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  tenant_id: string | null;
  actor_id: string | null;
  actor_type: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  payload: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  status: string;
  occurred_at: string;
}
