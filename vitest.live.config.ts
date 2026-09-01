import { defineConfig } from 'vitest/config';

// The paid eval layer only. Deliberately excluded from the default config's
// include so `pnpm test` can never spend model money by accident; run it with
// `pnpm test:eval:live` and a real OPENAI_API_KEY in the environment.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.live.ts'],
    testTimeout: 180_000,
  },
});
