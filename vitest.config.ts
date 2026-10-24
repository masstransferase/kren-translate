import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 2026-10-12: match the private routine to prevent public worker update timeouts.
    maxWorkers: 2,
    exclude: ['test/integration/**', 'node_modules/**', 'dist/**'],
    // 2026-10-04: two whole-panel tests passed alone but exceeded the 5 s default while the
    // public release check ran every file in parallel, failing the release gate at random.
    // 2026-10-24: with about 6,200 tests, heavy mounted-panel tests that take about 5 s alone
    // exceeded 15 s under full parallel load (V230, V262, productionPanel setup, Live replay),
    // failing whole runs at random; the limits only bound time and change no assertion.
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
