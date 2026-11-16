import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * SD-WM-11: ships the Apache-2.0 licence of @dimforge/rapier3d-compat as a hashed asset
 * (assets/third-party-notices-<hash>.txt). Hashed, not fixed, because hosting caches every
 * non-index file immutably for a year. The package exports only ".", so LICENSE and
 * package.json are read by file path from the package root. A missing licence fails the build.
 */
function thirdPartyNotices(): Plugin {
  return {
    name: 'strikezone-third-party-notices',
    apply: 'build',
    generateBundle() {
      const require = createRequire(import.meta.url);
      const root = join(dirname(require.resolve('@dimforge/rapier3d-compat')), '..');
      const licencePath = join(root, 'LICENSE');
      if (!existsSync(licencePath)) {
        this.error(`third-party notices: ${licencePath} is missing; refusing to build without it`);
      }
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        version: string;
      };
      const source = [
        'StrikeZone third-party notices',
        '',
        `@dimforge/rapier3d-compat ${pkg.version} (Apache License 2.0), bundled in the physics chunk`,
        '',
        readFileSync(licencePath, 'utf8'),
      ].join('\n');
      this.emitFile({ type: 'asset', name: 'third-party-notices.txt', source });
    },
  };
}

// contract-game-dist: index.html at dist/ root, hashed files under dist/assets/.
// Nothing goes in public/ (BR-K-59): Vite copies it unhashed and hosting caches it for a year.
export default defineConfig({
  resolve: {
    alias: { '@sz': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  publicDir: false,
  plugins: [thirdPartyNotices()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    target: 'es2022',
  },
});
