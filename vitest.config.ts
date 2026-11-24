import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@tuffcode/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@tuffcode/contracts': fileURLToPath(
        new URL('./packages/contracts/src/index.ts', import.meta.url),
      ),
      '@tuffcode/adapters': fileURLToPath(
        new URL('./packages/adapters/src/index.ts', import.meta.url),
      ),
      '@tuffcode/prompt': fileURLToPath(new URL('./packages/prompt/src/index.ts', import.meta.url)),
      '@tuffcode/ui': fileURLToPath(new URL('./packages/ui/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**'],
    passWithNoTests: true,
  },
});
