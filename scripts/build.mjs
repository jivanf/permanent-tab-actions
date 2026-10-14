import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

await rm('dist/extension', { recursive: true, force: true });
await mkdir('dist/extension', { recursive: true });
await build({
    entryPoints: ['extension/background.ts'],
    outfile: 'dist/extension/background.js',
    bundle: true,
    target: 'firefox142',
    format: 'iife',
    legalComments: 'none',
    sourcemap: false,
});
await Promise.all(
    ['manifest.json', 'icon.svg'].map((file) => copyFile(`extension/${file}`, `dist/extension/${file}`)),
);
