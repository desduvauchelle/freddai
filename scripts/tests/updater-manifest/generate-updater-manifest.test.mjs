import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildManifest, PLATFORM_ASSETS } from '../../generate-updater-manifest.mjs';

const script = path.resolve(import.meta.dirname, '../../generate-updater-manifest.mjs');

test('buildManifest maps platforms to stable asset URLs', () => {
  const m = buildManifest({ tag: 'v1.2.3', repo: 'o/r', notes: 'n', pubDate: '2026-01-01T00:00:00.000Z', readSignature: (n) => `sig-${n}\n` });
  assert.equal(m.version, '1.2.3');
  assert.deepEqual(Object.keys(m.platforms), Object.keys(PLATFORM_ASSETS));
  assert.equal(m.platforms['darwin-x86_64'].url, 'https://github.com/o/r/releases/download/v1.2.3/Freddai-macos-universal.app.tar.gz');
  assert.equal(m.platforms['linux-x86_64'].signature, 'sig-Freddai-linux-x64.AppImage.sig');
});

test('buildManifest rejects bad tag and empty signature', () => {
  assert.throws(() => buildManifest({ tag: '1.2.3', repo: 'o/r', readSignature: () => 'x' }));
  assert.throws(() => buildManifest({ tag: 'v1.2.3', repo: 'o/r', readSignature: () => ' ' }));
});

test('CLI writes latest.json and fails loudly on missing files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const out = path.join(dir, 'latest.json');
  const env = { ...process.env, RELEASE_TAG: 'v0.2.0', GITHUB_REPOSITORY: 'o/r' };
  assert.notEqual(spawnSync('node', [script, dir, out], { env }).status, 0);
  for (const asset of new Set(Object.values(PLATFORM_ASSETS))) {
    fs.writeFileSync(path.join(dir, asset), 'bin');
    fs.writeFileSync(path.join(dir, `${asset}.sig`), 'c2lnbmF0dXJl\n');
  }
  execFileSync('node', [script, dir, out], { env });
  const m = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(m.version, '0.2.0');
  assert.equal(m.platforms['darwin-aarch64'].signature, 'c2lnbmF0dXJl');
  assert.ok(!Number.isNaN(Date.parse(m.pub_date)));
});
