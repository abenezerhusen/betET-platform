/**
 * Backwards-compatible thin shim.
 *
 * The real client now lives in `./api/`. We keep the original
 * `apiLogin`, `apiRefresh`, `apiAdminUsers`, and `AuthTokens` exports here so
 * existing imports (e.g. `import { apiAdminUsers } from '../lib/api'`) keep
 * working while new code uses the typed modules in `./api/`.
 */

import { listUsers, type ListUsersQuery } from './api/users';
import { login, refresh } from './api/auth';

export type { AuthTokens } from './api/types';

export const apiLogin = login;
export const apiRefresh = refresh;

export async function apiAdminUsers(
  _accessToken: string,
  query: ListUsersQuery = { page: 1, limit: 100 }
) {
  // The token is already injected by the new client from the auth store; the
  // parameter is kept for backwards compatibility with existing callers.
  return listUsers({ page: query.page ?? 1, limit: query.limit ?? 100, ...query });
}

// Re-export the full new client from the explicit index path so this file
// doesn't accidentally self-import via './api'.
export * from './api/index';
