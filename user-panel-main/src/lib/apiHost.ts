/**
 * Resolve the backend base URL for the current runtime.
 *
 * The build-time default is `http://localhost:4000`. That is correct when
 * the panel is opened on the same machine that runs the backend, but it
 * breaks the moment the panel is loaded from another device — e.g. a phone
 * on the same Wi-Fi opening `http://<pc-ip>:3001`. There `localhost` points
 * the phone at *itself*, so every request (register, login, wallet…) fails
 * with a bare "fetch failed" network error.
 *
 * When the configured backend host is a loopback address but the page is
 * being served from a real hostname/IP, we reuse that hostname (keeping the
 * backend's port) so the API is reachable from whatever device loaded the
 * panel. An explicit, non-loopback `NEXT_PUBLIC_API_BASE_URL` (e.g. a real
 * production domain) is always honoured untouched.
 */

const CONFIGURED_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || 'http://localhost:4000';

const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

export function resolveApiBaseUrl(): string {
  if (typeof window === 'undefined') return CONFIGURED_API_BASE_URL;
  try {
    const configured = new URL(CONFIGURED_API_BASE_URL);
    const pageHost = window.location.hostname;
    if (LOOPBACK_HOSTS.has(configured.hostname) && !LOOPBACK_HOSTS.has(pageHost)) {
      configured.hostname = pageHost;
      return configured.toString().replace(/\/+$/u, '');
    }
  } catch {
    /* fall through to the configured value */
  }
  return CONFIGURED_API_BASE_URL.replace(/\/+$/u, '');
}
