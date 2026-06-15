"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  dnsPrefetch,
  prefetchPage,
  preconnect,
  lazyLoadImages,
  measureWebVitals
} from "@/lib/performance";

export function PerformanceOptimizer() {
  const pathname = usePathname();

  useEffect(() => {
    // In local development we must avoid stale cached bundles/API responses.
    // Older SW installs aggressively cached Next.js chunks under their old
    // hashes — after the next `next dev` run those chunks return 404 and
    // the page dies with "client-side exception". So in dev:
    //   1. Unregister every active service worker.
    //   2. Wipe every CacheStorage entry, not just the SW registration —
    //      otherwise the cached responses survive the unregister.
    //   3. Reload once if we actually killed a worker, so the next request
    //      bypasses the now-defunct controller and hits the dev server.
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      const isProd = process.env.NODE_ENV === "production";
      if (!isProd) {
        const wipeCaches = async () => {
          if (!("caches" in window)) return;
          try {
            const keys = await window.caches.keys();
            await Promise.all(keys.map((k) => window.caches.delete(k)));
          } catch {
            /* ignore */
          }
        };
        navigator.serviceWorker
          .getRegistrations()
          .then(async (registrations) => {
            const hadWorker = registrations.length > 0;
            await Promise.all(registrations.map((r) => r.unregister()));
            await wipeCaches();
            if (hadWorker) {
              // One-shot reload so the no-controller dev page is what
              // actually runs, instead of whatever the SW just served.
              const flag = "1birr-sw-cleared";
              if (!sessionStorage.getItem(flag)) {
                sessionStorage.setItem(flag, "1");
                window.location.reload();
              }
            }
          })
          .catch(() => undefined);
      } else {
        navigator.serviceWorker
          .register("/sw.js")
          .catch(() => undefined);
      }
    }

    // DNS Prefetching for external domains
    dnsPrefetch('//ext.same-assets.com');
    dnsPrefetch('//fonts.googleapis.com');
    dnsPrefetch('//fonts.gstatic.com');

    // Preconnect to critical domains
    preconnect('https://ext.same-assets.com');

    // Prefetch likely next pages based on current page
    const prefetchRoutes = {
      '/': ['/sport', '/live', '/deposit'],
      '/sport': ['/live', '/deposit', '/sport-history'],
      '/live': ['/sport', '/deposit'],
      '/deposit': ['/withdraw', '/sport'],
      '/withdraw': ['/deposit', '/transaction-history'],
    };

    const routesToPrefetch = prefetchRoutes[pathname as keyof typeof prefetchRoutes] || [];
    routesToPrefetch.forEach((route) => {
      setTimeout(() => prefetchPage(route), 1000); // Prefetch after 1 second
    });

    // Initialize lazy loading for images
    setTimeout(() => {
      lazyLoadImages();
    }, 100);

    // Measure Web Vitals (only in development)
    if (process.env.NODE_ENV === 'development') {
      measureWebVitals();
    }

    // Preload critical resources
    const criticalResources = [
      { url: '/api/matches', as: 'fetch' },
      { url: '/api/odds', as: 'fetch' },
    ];

    // Note: In a real app, these would be actual API endpoints
    // For now, this sets up the pattern

  }, [pathname]);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      console.log('[Network] Back online');
      // Trigger sync of offline actions
      if ('serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype) {
        navigator.serviceWorker.ready.then((registration: any) => {
          return registration.sync.register('sync-bets');
        });
      }
    };

    const handleOffline = () => {
      console.log('[Network] Gone offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return null; // This component doesn't render anything
}
