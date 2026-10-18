import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 2026-10-12: match the private routine to prevent public worker update timeouts.
    maxWorkers: 2,
    exclude: ['test/integration/**', 'node_modules/**', 'dist/**'],
    // 2026-10-04: two whole-panel tests passed alone but exceeded the 5 s default while the
    // public release check ran every file in parallel, failing the release gate at random.
    testTimeout: 15000
  }
});
