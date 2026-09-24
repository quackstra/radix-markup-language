import { defineConfig } from 'vite';

// Reader SPA. root = reader/. Imports the shared core from ../src (repo root),
// so dev-server fs access to the parent is allowed. Relative base so the static
// build can be served from any path.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022', emptyOutDir: true },
  server: { fs: { allow: ['..'] } },
});
