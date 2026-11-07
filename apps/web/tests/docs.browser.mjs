import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.WEB_TEST_URL || 'http://127.0.0.1:3000';
const paths = ['/docs', '/docs/onboarding', '/docs/getting-started', '/docs/use-cases', '/docs/features'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const colorScheme of ['light', 'dark']) for (const width of [375, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const footerLinks = await page.locator('footer nav a').evaluateAll(links => links.map(link => new URL(link.href).pathname));
    assert.deepEqual(footerLinks, paths);
    for (const path of paths) {
      await page.locator(`footer a[href="${path}"]`).click();
      await page.waitForURL(`${base}${path}`);
      assert.equal(await page.locator('h1').count(), 1);
      assert.ok((await page.title()).includes('Freddai'));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} overflow at ${width}`);
      await page.locator('main img').evaluateAll(imgs => imgs.forEach(img => img.loading = 'eager'));
      await page.waitForFunction(() => [...document.querySelectorAll('main img')].every(img => img.complete && img.naturalWidth > 0));
      if (path !== '/docs') {
        assert.equal(await page.locator('[aria-current="page"]').count(), 1);
        const anchor = page.locator('.docs-section h2 a').first();
        const hash = await anchor.getAttribute('href');
        await anchor.click();
        assert.equal(new URL(page.url()).hash, hash);
        await page.locator('.docs-note a').first().click();
        await page.waitForURL(url => url.pathname.startsWith('/docs/') && url.pathname !== path);
      }
    }
    await page.goto(`${base}/docs/onboarding`);
    await page.screenshot({ path: `/tmp/freddai-docs-${colorScheme}-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS documentation navigation, anchors, images, layout:', colorScheme, width);
    await page.close();
  }
  assert.equal((await fetch(`${base}/docs/does-not-exist`)).status, 404);
  const redirected = await fetch(`${base}/en/docs/features`, { redirect: 'manual' });
  assert.equal(redirected.status, 301);
  assert.equal(new URL(redirected.headers.get('location'), base).pathname, '/docs/features');
} finally { await browser.close(); }
