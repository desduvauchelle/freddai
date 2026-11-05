import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseDownloadUrl } from '../src/lib/download.ts';
import { resolveTheme, isThemePreference } from '../src/lib/theme.ts';

const base = process.env.WEB_TEST_URL;
test('download only enables an HTTPS release without embedded credentials', () => {
  for (const value of [undefined, '', '/download.dmg', 'javascript:alert(1)', 'http://example.com/app.dmg', 'https://user:secret@example.com/app.dmg']) {
    assert.equal(releaseDownloadUrl(value), null);
  }
  assert.equal(releaseDownloadUrl('https://example.com/app.dmg'), 'https://example.com/app.dmg');
});
test('system theme follows OS while an explicit choice wins', () => {
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('auto', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(isThemePreference('invalid'), false);
});
test('production home serves HTML without a redirect loop', { skip: !base }, async () => {
  const res = await fetch(base, { redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Switch agents\. Not your whole workflow\./);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});
test('default locale redirects to canonical home and unknown pages remain 404', { skip: !base }, async () => {
  const res = await fetch(`${base}/en`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(new URL(res.headers.get('location'), base).pathname, '/');
  assert.equal((await fetch(`${base}/not-a-page`)).status, 404);
});
test('unconfigured SDK reports disabled and returns empty blog content', { skip: !base }, async () => {
  const status = await (await fetch(`${base}/api/rs/sdk-status`)).json();
  assert.equal(status.disabled, true);
  assert.equal(status.structuralLinks, false);
  assert.deepEqual(await (await fetch(`${base}/api/rs/content?type=blog`)).json(), []);
});
test('SDK API rejects cross-origin requests', { skip: !base }, async () => {
  const res = await fetch(`${base}/api/rs/sdk-status`, { headers: { origin: 'https://other.example' } });
  assert.equal(res.status, 403);
});
