import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run TypeScript specs from src — never the compiled copies in dist,
    // which are CJS output and cannot import vitest.
    include: ['src/**/*.spec.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
