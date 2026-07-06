// vitest.config.ts
// Restrict test discovery to project source tests only.
// Without this, vitest scans .kilo/node_modules/zod/src/v3/tests/, .claude/,
// .hermes/ and other agent-internal directories that contain their own tests,
// which breaks CI (e.g. test job #280 failed after 58s scanning hundreds of
// foreign tests on 2026-06-29 after v3.0.0 publish).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,js}'],
    exclude: [
      'node_modules/**',
      'dist/**',
      '.kilo/**',          // kilo agent's vendored deps with their own tests
      '.claude/**',        // Claude agent's session/registry dumps
      '.hermes/**',        // Hermes agent runtime state
      'bin/**',
      '__archive__/**',
      'plans/**',
      'scratch/**',
    ],
    // CI fix: use forks, NOT threads. Test agentHermesHome.test.ts
    // calls process.chdir() which throws under vitest v4 threads pool.
    pool: 'forks',
    singleFork: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});