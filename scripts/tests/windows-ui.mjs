// Inspect only the installed app's WebView2 instance in an empty CI profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const deadline = Date.now() + 60_000;
let page;
while (Date.now() < deadline) {
  try {
    const targets = await fetch('http://127.0.0.1:9223/json/list').then(r => r.json());
    page = targets.find(p => p.type === 'page' && /tauri|localhost/.test(p.url));
    if (page?.webSocketDebuggerUrl) break;
  } catch {}
  await new Promise(r => setTimeout(r, 300));
}
assert(page?.webSocketDebuggerUrl, 'Installed app did not expose its test WebView');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let next = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  const callback = pending.get(message.id);
  if (callback) { pending.delete(message.id); message.error ? callback.reject(message.error) : callback.resolve(message.result); }
};
function send(method, params = {}) {
  const id = ++next;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
try {
  let ui;
  while (Date.now() < deadline) {
    const result = await send('Runtime.evaluate', {
      expression: `JSON.stringify({ready:!!document.querySelector('.native-workspace'),text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText,label:b.getAttribute('aria-label'),disabled:b.disabled}))})`,
      returnByValue: true,
    });
    if (result.result.value) ui = JSON.parse(result.result.value);
    if (ui?.ready && ui.buttons.length > 3) break;
    await new Promise(r => setTimeout(r, 300));
  }
  assert(ui?.ready, `Workspace did not render: ${ui?.text}`);
  assert(ui.buttons.length > 3, 'Workspace has no usable controls');
  assert(!/Background host (exited|did not start)|host is unavailable/.test(ui.text), ui.text);
  await fs.mkdir('output/windows-validation', { recursive: true });
  await fs.writeFile('output/windows-validation/ui.json', JSON.stringify(ui, null, 2));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile('output/windows-validation/app.png', Buffer.from(shot.data, 'base64'));
  console.log('PASS: installed WebView2 rendered the workspace and controls');
} finally { ws.close(); }
