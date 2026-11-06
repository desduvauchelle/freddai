import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const css = await Promise.all(['workspace.css', 'appearance/appearance.css', 'desktop/desktop.css', 'desktop/themes.css'].map(path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8')));
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
try {
  const page = await browser.newPage();
  await page.setContent(`<style>${css.join('\n')}</style><main class="dev-app native-workspace"><div class="message-queue"><button>Steer</button></div><div class="chat-attachments"><span>document.pdf</span></div><div class="toolbar-search"><input></div><div class="host-update-notice">Update ready</div><div class="account-usage-card">Account</div><div class="chat-drop-overlay">Drop files</div></main><div class="dev-popup"><div class="message-queue-menu-panel">Queue details</div></div><div id="portal">Body portal</div>`);
  for (const appearance of ['dark', 'light']) {
    for (const theme of ['neutral', 'slate', 'violet', 'rose', 'green']) {
      await page.evaluate(({ appearance, theme }) => { document.documentElement.dataset.freddaiAppearance = appearance; document.documentElement.dataset.freddaiTheme = theme; }, { appearance, theme });
      const result = await page.evaluate(() => {
        const style = selector => getComputedStyle(document.querySelector(selector));
        const probe = document.createElement('i');
        document.querySelector('main').append(probe);
        const token = name => { probe.style.backgroundColor = `var(--${name})`; return getComputedStyle(probe).backgroundColor; };
        const actual = { queue: style('.message-queue').backgroundColor, attachment: style('.chat-attachments > span').backgroundColor, search: style('.toolbar-search input').backgroundColor, update: style('.host-update-notice').backgroundColor, menu: style('.message-queue-menu-panel').backgroundColor, border: style('.account-usage-card').borderTopColor, root: style('#portal').getPropertyValue('--primary').trim() };
        const expected = { surface: token('secondary'), background: token('background'), card: token('card'), border: token('border'), primary: style('main').getPropertyValue('--primary').trim() };
        probe.remove(); return { actual, expected };
      });
      const { actual: a, expected: e } = result;
      assert.equal(a.queue, e.surface); assert.equal(a.attachment, e.surface);
      assert.equal(a.search, e.background); assert.equal(a.update, e.card);
      assert.equal(a.menu, e.surface); assert.equal(a.border, e.border);
      assert.equal(a.root, e.primary, 'body portals inherit the selected palette');
      console.log(`PASS ${appearance}/${theme}: queue, attachments, search, update, account border, popup and body portal`);
    }
  }
} finally { await browser.close(); }
