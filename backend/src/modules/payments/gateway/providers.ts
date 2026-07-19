import { GATEWAY_METHODS } from './gateway.constants';
import { GatewayProvider } from './GatewayProvider';

/**
 * One GatewayProvider instance per configured gateway slug. Registered
 * at boot from the payments barrel (`../index.ts`).
 */
export const gatewayProviders: GatewayProvider[] = GATEWAY_METHODS.map(
  (m) => new GatewayProvider(m.slug, m.currencies, m.countries)
);
