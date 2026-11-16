import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

interface NoticeSource {
  readonly name: string;
  readonly licence: string;
  readonly where: string;
}

/** Bundled runtime packages whose licence text must ship (SD-WM-11, CMP-R-01). */
const NOTICES: ReadonlyArray<NoticeSource> = [
  {
    name: '@dimforge/rapier3d-compat',
    licence: 'Apache License 2.0',
    where: 'bundled in the physics chunk',
  },
  { name: 'three', licence: 'MIT License', where: 'bundled in the renderer code' },
];

/**
 * SD-WM-11 / SD-R-4: ships every bundled package licence as one hashed asset
 * (assets/third-party-notices-<hash>.txt). Hashed, not fixed, because hosting caches every
 * non-index file immutably for a year. Packages may export only ".", so LICENSE and
 * package.json are read by file path from the package root. A missing licence fails the build.
 * The three section is emitted whenever three is a dependency, even while it is tree-shaken
 * (OI-L-3), because check-dist keys on package.json.
 */
function thirdPartyNotices(): Plugin {
  return {
    name: 'strikezone-third-party-notices',
    apply: 'build',
    generateBundle() {
      const require = createRequire(import.meta.url);
      const sections: string[] = ['StrikeZone third-party notices', ''];
      for (const n of NOTICES) {
        const root = join(dirname(require.resolve(n.name)), '..');
        const licencePath = join(root, 'LICENSE');
        const pkgPath = join(root, 'package.json');
        if (!existsSync(licencePath) || !existsSync(pkgPath)) {
          this.error(
            `third-party notices: ${licencePath} or package.json is missing; refusing to build`,
          );
        }
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
        sections.push(
          `${n.name} ${pkg.version} (${n.licence}), ${n.where}`,
          '',
          readFileSync(licencePath, 'utf8'),
          '',
        );
      }
      this.emitFile({
        type: 'asset',
        name: 'third-party-notices.txt',
        source: sections.join('\n'),
      });
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
