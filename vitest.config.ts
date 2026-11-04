import { defineConfig } from 'vitest/config';

/**
 * Unit + headless-sim tests (Node, no DOM/WebGL). Browser-level checks live in tools/smoke.mjs,
 * tools/playtest-bot.mjs and tools/perf.mjs (Playwright), which are not part of `npm test`.
 */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // the balance sims are CPU-heavy; keep CI deterministic and avoid starving parallel agents
    poolOptions: { threads: { maxThreads: 2, minThreads: 1 }, forks: { maxForks: 2, minForks: 1 } },
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'production/qa/junit.xml' },
  },
});
