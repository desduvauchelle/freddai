import { expect, it } from 'vitest';
import { productUsageCards } from './product-usage';
const now = Date.UTC(2026, 10, 10, 12, 0, 0);
const sec = (ms: number) => Math.floor((now + ms) / 1000);
it('marks a recent reading stale immediately when refresh fails and exposes the reason', () => {
  const [card] = productUsageCards([{id:'a',name:'Work',provider:'codex',color:'blue',error:'Reconnect this account',usage:{checked_at:1000,windows:[{label:'Week',used_percent:20,resets_at:2000}]}}],1001);
  expect(card.remaining).toBe(80);
  expect(card.stale).toBe(true);
  expect(card.details).toContain('Reconnect this account');
});
it('distinguishes unsupported providers from a temporary missing reading', () => {
  const [card] = productUsageCards([{id:'a',name:'Work',provider:'antigravity',color:'blue',error:'Usage is not supported'}]);
  expect(card.status).toBe('Usage not supported');
  expect(card.capacity).toBe('Usage not supported');
});
it('splits Claude usage into labelled session and weekly rows', () => {
  const [card] = productUsageCards([{id:'c',name:'Me',provider:'claude',color:'blue',usage:{checked_at:now,windows:[
    {label:'Session',window:'session',used_percent:39,resets_at:sec(3 * 3600000)},
    {label:'All models',window:'weekly',used_percent:12,resets_at:sec(2 * 86400000)},
    {label:'Fable only',window:'weekly',used_percent:11,resets_at:sec(2 * 86400000)}]}}], now);
  expect(card.session).toMatch(/^61% left · resets \d{2}:\d{2}$/);
  expect(card.weekly).toMatch(/^88% left · resets \w{3} \d{2}:\d{2}$/);
  expect(card.sessionRemaining).toBe(61);
  expect(card.weeklyRemaining).toBe(88);
  expect(card.status).toBeNull();
  expect(card.stale).toBe(false);
  expect(card.details.split('\n')).toContainEqual(expect.stringMatching(/^Session · 61% left · resets/));
});
it('shows a short reason when Codex sign-in expired', () => {
  const [card] = productUsageCards([{id:'x',name:'Work',provider:'codex',color:'blue',error:'Codex sign-in expired. Reconnect this account in Manage accounts.'}], now);
  expect(card.status).toBe('Sign-in expired · reconnect');
  expect(card.capacity).toBe('Sign-in expired · reconnect');
  expect(card.session).toBeNull();
  expect(card.weekly).toBeNull();
});
