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
      // src/models/film.ts imports from '#muvi'; tests that drive it need the
      // same subpath alias tsconfig.json defines for the app build.
      '#muvi': path.resolve(__dirname, './src/lib/muvi/index.ts'),
      // The campaign routes import these; their tests mock them.
      '#meta': path.resolve(__dirname, './src/lib/meta/index.ts'),
      '#google': path.resolve(__dirname, './src/lib/google/index.ts'),
      '#gemini': path.resolve(__dirname, './src/lib/gemini/index.ts'),
    },
  },
});
