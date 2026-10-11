import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The keeper statistics play a few hundred simulated penalties.
    testTimeout: 120_000,
  },
});
