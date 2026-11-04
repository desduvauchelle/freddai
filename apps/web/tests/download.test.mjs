import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseDownloadUrl, macDownloadFromRelease, latestMacDownloadUrl } from '../src/lib/download.ts';

test('only published stable universal installers from the configured repository are offered', () => {
  const url = 'https://github.com/example/releases/releases/download/v0.1.0/Freddai-macos-universal.dmg';
  const asset = {name: 'Freddai-macos-universal.dmg', state: 'uploaded', browser_download_url: url};
  const release = {draft: false, prerelease: false, assets: [asset]};
  assert.equal(macDownloadFromRelease(release, 'example/releases'), url);
  for (const invalid of [null, {}, {...release, draft: true}, {...release, prerelease: true}, {...release, assets: []}, {...release, assets: [{...asset, browser_download_url: 'https://evil.example/file.dmg'}]}]) {
    assert.equal(macDownloadFromRelease(invalid, 'example/releases'), null);
  }
  assert.equal(releaseDownloadUrl('http://example.com'), null);
  assert.equal(releaseDownloadUrl('https://user:password@example.com'), null);
});

test('discovery handles unpublished releases, failures, and explicit overrides', async () => {
  const originalFetch = globalThis.fetch;
  const previous = {...process.env};
  try {
    delete process.env.MACOS_DOWNLOAD_URL;
    process.env.RELEASES_REPOSITORY = 'example/releases';
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.github.com/repos/example/releases/releases/latest');
      assert.equal(options.next.revalidate, 300);
      return {ok: false};
    };
    assert.equal(await latestMacDownloadUrl(), null);
    globalThis.fetch = async () => {throw new Error('offline');};
    assert.equal(await latestMacDownloadUrl(), null);
    process.env.MACOS_DOWNLOAD_URL = 'https://example.com/installer.dmg';
    assert.equal(await latestMacDownloadUrl(), process.env.MACOS_DOWNLOAD_URL);
    delete process.env.MACOS_DOWNLOAD_URL;
    process.env.RELEASES_REPOSITORY = '../invalid';
    assert.equal(await latestMacDownloadUrl(), null);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ['MACOS_DOWNLOAD_URL', 'RELEASES_REPOSITORY']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
