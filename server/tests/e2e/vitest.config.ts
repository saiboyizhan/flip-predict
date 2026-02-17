import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 60000,
    root: path.resolve(__dirname),
    globalSetup: './setup/global-setup.ts',
    include: ['suites/**/*.test.ts'],
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    env: {
      E2E_BASE_URL: 'http://localhost:3099',
    },
  },
});
