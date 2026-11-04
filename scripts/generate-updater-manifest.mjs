#!/usr/bin/env node
// Generates the Tauri v2 static updater manifest (latest.json) from staged release assets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLATFORM_ASSETS = {
  'darwin-aarch64': 'Freddai-macos-universal.app.tar.gz',
  'darwin-x86_64': 'Freddai-macos-universal.app.tar.gz',
  'linux-x86_64': 'Freddai-linux-x64.AppImage',
};

export function buildManifest({ tag, repo, notes, pubDate, readSignature }) {
  if (!/^v\d+\.\d+\.\d+/.test(tag)) throw new Error(`Tag must look like v1.2.3, got "${tag}"`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Repo must be owner/name, got "${repo}"`);
  const platforms = {};
  for (const [platform, asset] of Object.entries(PLATFORM_ASSETS)) {
    const signature = String(readSignature(`${asset}.sig`) ?? '').trim();
    if (!signature) throw new Error(`Empty signature for ${asset}`);
    platforms[platform] = {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${asset}`,
    };
  }
  return { version: tag.slice(1), notes, pub_date: pubDate, platforms };
}

function main() {
  const [dir, out] = process.argv.slice(2);
  const { RELEASE_TAG, GITHUB_REPOSITORY, RELEASE_NOTES } = process.env;
  if (!dir || !out || !RELEASE_TAG || !GITHUB_REPOSITORY) {
    throw new Error('Usage: RELEASE_TAG=vX.Y.Z GITHUB_REPOSITORY=owner/repo generate-updater-manifest.mjs <assets-dir> <output>');
  }
  const manifest = buildManifest({
    tag: RELEASE_TAG,
    repo: GITHUB_REPOSITORY,
    notes: RELEASE_NOTES || `Freddai ${RELEASE_TAG}`,
    pubDate: new Date().toISOString(),
    readSignature: (name) => {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) throw new Error(`Missing updater asset: ${file}`);
      if (!fs.existsSync(file.slice(0, -4))) throw new Error(`Missing updater asset: ${file.slice(0, -4)}`);
      return fs.readFileSync(file, 'utf8');
    },
  });
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`::error::${error.message}`); process.exit(1); }
}
