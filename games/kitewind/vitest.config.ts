import { defineConfig } from 'vitest/config';

/** Unit tests run in Node (no DOM / WebGL). Browser checks live in tools/smoke.mjs. */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    poolOptions: { threads: { maxThreads: 2, minThreads: 1 }, forks: { maxForks: 2, minForks: 1 } },
  },
});
