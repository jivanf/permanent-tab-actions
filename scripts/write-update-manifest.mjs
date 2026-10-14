import { mkdirSync, writeFileSync } from 'node:fs';

const [version, updateLink, sha256] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Expected a semantic version.');
const url = new URL(updateLink);
if (url.protocol !== 'https:') throw new Error('Update links must use HTTPS.');
if (!/^[a-f0-9]{64}$/.test(sha256 || '')) throw new Error('Expected a SHA-256 digest.');

const update = {
    addons: {
        '@permanent-tab-actions.jivanf': {
            updates: [{ version, update_link: url.href, update_hash: `sha256:${sha256}` }],
        },
    },
};
mkdirSync('docs', { recursive: true });
writeFileSync('docs/updates.json', `${JSON.stringify(update, null, 4)}\n`);
