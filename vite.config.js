import { defineConfig } from 'vite';

export default defineConfig({
  // Use relative base by default so assets resolve correctly on GitHub Pages
  base: process.env.VITE_BASE_PATH || './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: true
  }
});
