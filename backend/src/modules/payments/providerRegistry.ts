import { BasePaymentProvider } from './BasePaymentProvider';

/**
 * Process-wide registry of payment providers.
 *
 * Providers are stateless singletons registered at module-load time
 * (see `index.ts` for the bootstrap). The registry is read by:
 *   - GET /api/user/payment-methods (which providers are usable now?)
 *   - POST /api/user/.../initiate    (route by `provider_slug` from DB)
 *   - admin payment-method CRUD      (validate provider_slug exists)
 */
class ProviderRegistry {
  private readonly providers = new Map<string, BasePaymentProvider>();

  register(provider: BasePaymentProvider): void {
    const slug = provider.getProviderName();
    if (!/^[a-z0-9_]+$/.test(slug)) {
      throw new Error(
        `Invalid provider slug "${slug}" — must match [a-z0-9_]+`
      );
    }
    if (this.providers.has(slug)) {
      // Re-registration is a no-op when the SAME instance is passed,
      // which lets test harnesses freely re-import the bootstrap. A
      // different instance with the same slug is treated as a coding
      // error.
      const existing = this.providers.get(slug);
      if (existing !== provider) {
        throw new Error(`Provider "${slug}" already registered`);
      }
      return;
    }
    this.providers.set(slug, provider);
  }

  get(slug: string): BasePaymentProvider | null {
    return this.providers.get(slug) ?? null;
  }

  has(slug: string): boolean {
    return this.providers.has(slug);
  }

  /** Returns providers in registration order (Map iteration order). */
  list(): BasePaymentProvider[] {
    return Array.from(this.providers.values());
  }

  /** Test helper. Not used by production code. */
  _reset(): void {
    this.providers.clear();
  }
}

export const providerRegistry = new ProviderRegistry();
