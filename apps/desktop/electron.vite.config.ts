import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const desktopRoot = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(desktopRoot, '../web');

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ['@tuffcode/shared'] },
      rolldownOptions: {
        input: resolve(desktopRoot, 'src/main.ts'),
        output: {
          entryFileNames: 'main.js',
          chunkFileNames: 'chunks/[name]-[hash].js',
        },
      },
    },
  },
  preload: {
    build: {
      rolldownOptions: {
        input: resolve(desktopRoot, 'src/preload.ts'),
        output: {
          format: 'cjs',
          entryFileNames: 'preload.cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs',
        },
      },
    },
  },
  renderer: {
    root: webRoot,
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve(webRoot, 'dist'),
      emptyOutDir: true,
      rolldownOptions: {
        input: resolve(webRoot, 'index.html'),
      },
    },
  },
});
