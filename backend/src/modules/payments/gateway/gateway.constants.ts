/**
 * Static definition of the "Online Payment" gateway methods.
 *
 * These are DISTINCT from the Telebirr P2P provider (`telebirr_p2p`).
 * Each maps to a `payment_methods` row (seeded per tenant) and a
 * provider registered in the shared `providerRegistry`.
 *
 * Adding a new gateway later is a two-line change here plus a seed row;
 * the user panel and admin panel pick it up automatically.
 */

export interface GatewayMethodDef {
  slug: string;
  name: string;
  currencies: string[];
  countries: string[];
}

export const GATEWAY_METHODS: GatewayMethodDef[] = [
  { slug: 'telebirr_gateway', name: 'Telebirr', currencies: ['ETB'], countries: ['ET'] },
  { slug: 'cbe_birr', name: 'CBE Birr', currencies: ['ETB'], countries: ['ET'] },
  { slug: 'mpesa', name: 'M-Pesa', currencies: ['ETB', 'KES'], countries: ['ET', 'KE'] },
];

export const GATEWAY_SLUGS: string[] = GATEWAY_METHODS.map((m) => m.slug);

export function isGatewaySlug(slug: string): boolean {
  return GATEWAY_SLUGS.includes(slug);
}

/** Settings key holding the admin Payment Configuration blob. */
export const PAYMENT_SETTINGS_KEY = 'payment.config';
