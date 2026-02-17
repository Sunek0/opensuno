/**
 * Extension build script using esbuild.
 *
 * Usage:
 *   bun run extension/build.ts          # one-shot build
 *   bun run extension/build.ts --watch  # watch mode
 */

import { build, type BuildOptions } from 'esbuild';
import { cpSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const isWatch = process.argv.includes('--watch');
const extDir = resolve(import.meta.dir);
const distDir = resolve(extDir, 'dist');

// Ensure dist exists
mkdirSync(distDir, { recursive: true });

const commonOptions: BuildOptions = {
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  sourcemap: isWatch ? 'inline' : false,
  minify: !isWatch,
  logLevel: 'info',
};

// Build all entry points
const entryPoints: { in: string; out: string; format?: 'esm' | 'iife' }[] = [
  { in: resolve(extDir, 'src/content.ts'), out: 'content', format: 'iife' },
  { in: resolve(extDir, 'src/page-script.ts'), out: 'page-script', format: 'iife' },
  { in: resolve(extDir, 'src/background.ts'), out: 'background', format: 'iife' },
  { in: resolve(extDir, 'src/popup.ts'), out: 'popup', format: 'iife' },
];

async function runBuild() {
  const promises = entryPoints.map((entry) =>
    build({
      ...commonOptions,
      entryPoints: [entry.in],
      outfile: resolve(distDir, `${entry.out}.js`),
      format: entry.format || 'iife',
    })
  );

  await Promise.all(promises);

  // Copy static files
  cpSync(resolve(extDir, 'manifest.json'), resolve(distDir, 'manifest.json'));
  cpSync(resolve(extDir, 'popup.html'), resolve(distDir, 'popup.html'));
  cpSync(resolve(extDir, 'popup.css'), resolve(distDir, 'popup.css'));
  cpSync(resolve(extDir, 'icons'), resolve(distDir, 'icons'), { recursive: true });

  console.log('Extension built to extension/dist/');
}

if (isWatch) {
  // In watch mode, rebuild all entry points with esbuild's watch
  const contexts = await Promise.all(
    entryPoints.map((entry) =>
      require('esbuild').context({
        ...commonOptions,
        entryPoints: [entry.in],
        outfile: resolve(distDir, `${entry.out}.js`),
        format: entry.format || 'iife',
      })
    )
  );

  // Initial build + copy static files
  await runBuild();

  // Start watching
  for (const ctx of contexts) {
    await ctx.watch();
  }
  console.log('Watching for changes...');
} else {
  await runBuild();
}
