// Account-free native bridge fixture: scoped navigation and bounded output paging.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.stack); });
  await page.addInitScript(() => {
    window.memoryCalls = [];
    let revision = 0;
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, invoke: async (command, args = {}) => {
      if (command === 'platform') return 'macos';
      if (command.startsWith('plugin:event|')) return 1;
      if (command === 'snapshot_since') {
        window.memoryCalls.push({ command, args });
        const sessions = ['one', 'two'].map(id => {
          const loaded = args.openThreads?.includes(id) ?? true;
          return { id, title: `Memory ${id}`, project: 'p', account: '', status: 'done', updated: 1,
            provider_id: null, pending: null, error: null, transcriptLoaded: loaded,
            messages: [{ id: `user-${id}`, role: 'user', text: `Question ${id}` },
              ...(loaded ? [{ id: `tool-${id}`, role: 'tool', text: '{}', toolTextBytes: 100000, toolTextHash: id }] : []),
              { id: `answer-${id}`, role: 'assistant', text: `Answer ${id}` }] };
        });
        return { revision: ++revision, hostId: 'memory-fixture', full: true, desktopProjection: true, sessions,
          accounts: [], projects: [{ id: 'p', name: 'Memory project', path: '/offline', color: '#aaa', policy: 'inherit', account: null, last: null }],
          preferences: { prefer_last: false, fallback: null, last: null } };
      }
      if (command === 'tool_text') {
        window.memoryCalls.push({ command, args });
        return { text: args.offset ? 'Second output page' : 'First output page', offset: args.offset, nextOffset: args.offset ? null : 65536, totalBytes: 100000, hash: args.hash };
      }
      if (command === 'merge_read') return [];
      if (['save_thread_list', 'mark_read'].includes(command)) return null;
      if (command === 'provider_installations') return [];
      throw new Error(`Offline memory fixture blocks ${command}`);
    } };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
  await page.goto(process.env.MEMORY_URL || 'http://127.0.0.1:1436/');
  await page.waitForFunction(() => window.memoryCalls?.length > 0);
  const setup = page.getByRole('button', { name: 'Back to threads', exact: true });
  await setup.waitFor();
  await setup.click();
  await page.getByText('Memory one', { exact: true }).first().waitFor();
  const back = page.getByRole('button', { name: 'Back to threads', exact: true });
  if (await back.count()) await back.click();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => memoryCalls.filter(c => c.command === 'tool_text').length), 0);
  await page.getByText('Memory one', { exact: true }).first().click();
  await page.waitForFunction(() => memoryCalls.some(c => c.command === 'snapshot_since' && c.args.openThreads?.includes('one')));
  await page.getByText('Tool activity · 1 call', { exact: true }).click();
  await page.getByText('Call 1', { exact: true }).click();
  await page.getByText('First output page', { exact: true }).waitFor();
  await page.getByText('More output', { exact: true }).click();
  await page.getByText('Second output page', { exact: true }).waitFor();
  assert.equal(await page.getByText('First output page', { exact: true }).count(), 0);
  const readsAfterPaging = await page.evaluate(() => memoryCalls.filter(c => c.command === 'tool_text').length);
  await page.getByText('Memory two', { exact: true }).first().click();
  await page.waitForFunction(() => memoryCalls.filter(c => c.command === 'snapshot_since').at(-1).args.openThreads?.includes('two'));
  assert.equal(await page.getByText('Second output page', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.waitForFunction(() => memoryCalls.filter(c => c.command === 'snapshot_since').at(-1).args.openThreads?.length === 0);
  assert.equal(await page.evaluate(() => memoryCalls.filter(c => c.command === 'tool_text').length), readsAfterPaging);
  assert.deepEqual(errors, []);
  console.log('PASS: Home stays scoped, navigation hydrates selected thread, tool results load on demand one page at a time, leaving releases output; no accounts or provider turns.');
} catch (error) { console.error('Fixture diagnostics:', await page.locator('body').innerText(), await page.evaluate(() => window.memoryCalls?.slice(-2))); throw error; } finally { await browser.close(); }
