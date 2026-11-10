import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const css = await Promise.all(['desktop.css', 'VoiceCallBar.css'].map(name => readFile(new URL(`../src/desktop/${name}`, import.meta.url), 'utf8')));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [520, 720, 1000, 1600]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}${css.join('\n')}</style><main class="native-workspace"><div style="display:flex;flex-direction:column"><section class="voice-call-bar"><div class="voice-call-row"><span>Listening</span><span class="voice-call-spacer"></span><button>Speak</button><select><option>Interrupt</option></select><button>End call</button></div></section><form class="chat-composer"><textarea placeholder="Message your agent..."></textarea><div class="chat-composer-tools"><button>+</button></div></form></div></main>`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const bar = await page.locator('.voice-call-bar').boundingBox();
    const composer = await page.locator('.chat-composer').boundingBox();
    assert.ok(bar.y + bar.height <= composer.y, `${width}: call bar overlaps composer`);
    assert.ok(Math.abs(bar.x - composer.x) < 1 && Math.abs(bar.width - composer.width) < 1, `${width}: call bar must align with composer`);
    await page.close();
  }
  console.log('Voice call bar aligns without composer overlap at all four widths');
} finally { await browser.close(); }
