import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  build: {
    // Rapier's compat build inlines its WASM, so the bundle is ~5 MB by design.
    chunkSizeWarningLimit: 6000,
  },
});
