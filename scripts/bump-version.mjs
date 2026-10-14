import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const type = process.argv[2];
if (!['patch', 'minor', 'major'].includes(type)) throw new Error('Version type must be patch, minor, or major.');

execFileSync('npm', ['version', type, '--no-git-tag-version'], { stdio: 'inherit' });
const packageJSON = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
manifest.version = packageJSON.version;
writeFileSync('extension/manifest.json', `${JSON.stringify(manifest, null, 4)}\n`);
process.stdout.write(`${packageJSON.version}\n`);
