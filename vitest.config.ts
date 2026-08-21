import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    // The ad preview renders a real facebook.com iframe; without this happy-dom
    // would try to fetch it, taking the test suite to the network.
    environmentOptions: {
      happyDOM: { settings: { disableIframePageLoading: true } },
    },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // e2e/ holds Playwright specs (run via `yarn e2e`); collecting them here
    // fails because Playwright's test.describe cannot run under Vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '#stripe': path.resolve(__dirname, './src/lib/stripe/index.ts'),
    },
  },
});
