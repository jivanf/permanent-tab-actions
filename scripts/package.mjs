import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const filename = `permanent-tab-actions-${version}.zip`;
execFileSync(
    'npx',
    [
        '--no-install',
        'web-ext',
        'build',
        '--source-dir',
        'dist/extension',
        '--artifacts-dir',
        'dist',
        '--filename',
        filename,
        '--overwrite-dest',
    ],
    { stdio: 'inherit' },
);

const entries = execFileSync('unzip', ['-Z1', `dist/${filename}`], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .sort();
const expected = ['background.js', 'icon.svg', 'manifest.json'];
if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected package contents: ${entries.join(', ')}`);
}
