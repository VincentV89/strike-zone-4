import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// contract-game-dist: index.html at dist/ root, hashed files under dist/assets/.
// Nothing goes in public/ (BR-K-59): Vite copies it unhashed and hosting caches it for a year.
export default defineConfig({
  resolve: {
    alias: { '@sz': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  publicDir: false,
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    target: 'es2022',
  },
});
