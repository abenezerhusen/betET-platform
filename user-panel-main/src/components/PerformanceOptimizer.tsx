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
    // Older SW caches were serving outdated UI (e.g. old Print button and
    // pre-fix /games behavior), so explicitly unregister all workers in dev.
    if ("serviceWorker" in navigator && process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          registrations.forEach((registration) => {
            void registration.unregister();
          });
        })
        .catch(() => {});
    } else if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("[ServiceWorker] Registered successfully:", registration.scope);
        })
        .catch((error) => {
          console.log("[ServiceWorker] Registration failed:", error);
        });
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
