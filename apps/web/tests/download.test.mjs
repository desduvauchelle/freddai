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

test('platform downloads only activate for uploaded stable release assets', async () => {
  const { latestDownloads, testFlightUrl } = await import('../src/lib/download.ts');
  const originalFetch = globalThis.fetch;
  const keys = ['RELEASES_REPOSITORY', 'MACOS_DOWNLOAD_URL', 'TESTFLIGHT_PUBLIC_URL', 'ANDROID_DOWNLOAD_URL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.RELEASES_REPOSITORY = 'example/releases';
    delete process.env.MACOS_DOWNLOAD_URL;
    process.env.ANDROID_DOWNLOAD_URL = 'https://github.com/example/releases/releases/download/android-beta-0.1.0/Freddai-android-arm64.apk';
    process.env.TESTFLIGHT_PUBLIC_URL = 'https://testflight.apple.com/join/Ab123';
    const names = ['Freddai-macos-universal.dmg', 'Freddai-linux-x64.AppImage', 'Freddai-linux-x64.deb', 'Freddai-windows-x64-setup.exe'];
    const assets = names.map(name => ({name, state: 'uploaded', browser_download_url: `https://github.com/example/releases/releases/download/v1/${name}`}));
    globalThis.fetch = async () => ({ok: true, json: async () => ({draft: false, prerelease: false, assets})});
    const downloads = await latestDownloads();
    assert.deepEqual([downloads.mac, downloads.linux, downloads.linuxDeb, downloads.windows], assets.map(asset => asset.browser_download_url));
    assert.equal(downloads.android, process.env.ANDROID_DOWNLOAD_URL);
    assert.equal(downloads.ios, process.env.TESTFLIGHT_PUBLIC_URL);
    globalThis.fetch = async () => ({ok: true, json: async () => ({draft: true, prerelease: false, assets})});
    assert.deepEqual(await latestDownloads(), {mac: null, linux: null, linuxDeb: null, windows: null, ios: process.env.TESTFLIGHT_PUBLIC_URL, android: process.env.ANDROID_DOWNLOAD_URL});
    for (const value of ['https://evil.example/join/Ab123', 'https://testflight.apple.com.evil.example/join/Ab123', 'http://testflight.apple.com/join/Ab123', 'https://testflight.apple.com/', 'https://testflight.apple.com/join/Ab123?redirect=other']) assert.equal(testFlightUrl(value), null);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});
