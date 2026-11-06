import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { BrowserContext } from '../conversation/browser-context';
import './browser.css';

type Profile = { id: string; name: string };
const storageKey = 'freddai.browser.sessions.v1';
const ToggleContext = createContext({ visible: false, toggle: () => {} });
export function BrowserToggle() {
  const { visible, toggle } = useContext(ToggleContext);
  return <button className="browser-thread-toggle" aria-label="Toggle browser" title="Toggle browser" aria-pressed={visible} onClick={toggle}>Browser</button>;
}
const threadPages = new Map<string, { profile: string; url: string; address: string; visible: boolean }>();
let nativeQueue: Promise<unknown> = Promise.resolve();
export function readBrowserProfiles(threadId = ''): Profile[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(threadId ? `${storageKey}.${threadId}` : storageKey) || 'null');
    if (Array.isArray(value) && value.length && value.every(p => p && typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 128 && typeof p.name === 'string')) return value;
  } catch { /* Use the stable default store when preferences are unavailable. */ }
  return [{ id: 'default', name: 'Personal' }];
}
export function BrowserWorkspace({ children, threadId = '' }: { children: ReactNode; threadId?: string }) {
  const [profiles, setProfiles] = useState(() => readBrowserProfiles(threadId));
  const [profile, setProfile] = useState(() => threadPages.get(threadId)?.profile ?? readBrowserProfiles(threadId)[0].id);
  const [url, setUrl] = useState(() => threadPages.get(threadId)?.url ?? '');
  const [address, setAddress] = useState(() => threadPages.get(threadId)?.address ?? '');
  const [visible, setVisible] = useState(() => threadPages.get(threadId)?.visible ?? false);
  useEffect(() => { threadPages.set(threadId, { profile, url, address, visible }); }, [threadId, profile, url, address, visible]);
  const [navigation, setNavigation] = useState(0);
  const handledNavigation = useRef(0);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const native = isTauri();
  const command = useCallback((action: string, id: string, target?: string, bounds?: number[]) => {
    const next = nativeQueue.catch(() => {}).then(() => invoke<string | null>('browser_view', { action, profile: threadId ? `thread:${threadId}:${id}` : id, url: target ?? null, bounds: bounds ?? null }));
    nativeQueue = next;
    return next;
  }, [threadId]);
  const open = useCallback((value: string) => {
    setAddress(value); setUrl(value); setError(''); setVisible(true); setNavigation(n => n + 1);
  }, []);
  useEffect(() => {
    if (!native || !visible || !url || !area.current) return;
    let disposed = false;
    const id = profile;
    let lastLayout = "";
    const update = (navigate: boolean) => {
      const rect = area.current?.getBoundingClientRect();
      if (!rect || rect.width < 1 || rect.height < 1) return;
      // Native child views sit above HTML: hide while an application dialog is open.
      const modal = !!document.querySelector('[role="dialog"], [role="alertdialog"]');
      const layout = JSON.stringify([modal, rect.x, rect.y, rect.width, rect.height]);
      if (!navigate && layout === lastLayout) return;
      lastLayout = layout;
      void command(modal ? 'hide' : navigate ? 'navigate' : 'show', id, url, [rect.x, rect.y, rect.width, rect.height]).catch(e => { if (!disposed) setError(String(e)); });
    };
    update(navigation !== handledNavigation.current);
    handledNavigation.current = navigation;
    const resize = new ResizeObserver(() => update(false)); resize.observe(area.current);
    const mutations = new MutationObserver(() => update(false)); mutations.observe(document.body, { childList: true, subtree: true });
    const timer = setInterval(() => {
      void command('status', id).then(current => {
        if (!disposed && current) setAddress(previous => document.activeElement?.id === 'browser-address' ? previous : current);
      }).catch(() => {});
    }, 1500);
    return () => { disposed = true; resize.disconnect(); mutations.disconnect(); clearInterval(timer); void command('hide', id).catch(() => {}); };
  }, [native, visible, profile, url, navigation, command]);
  const act = (action: string) => { setError(''); void command(action, profile).catch(e => setError(String(e))); };
  const add = () => {
    if (!newName.trim()) return;
    const p = { id: crypto.randomUUID(), name: newName.trim().slice(0, 60) };
    const next = [...profiles, p];
    try { localStorage.setItem(threadId ? `${storageKey}.${threadId}` : storageKey, JSON.stringify(next)); }
    catch { setError('Could not save the session. Check available storage.'); return; }
    setProfiles(next); setProfile(p.id); setNewName(''); setAdding(false);
  };
  return <ToggleContext.Provider value={{ visible, toggle: () => setVisible(v => !v) }}><BrowserContext.Provider value={native ? open : null}>
    <div className="browser-workspace"><div className="browser-app">{children}</div>
    {visible && <aside className="browser-panel" aria-label="Browser">
      <div className="browser-toolbar"><strong>Browser</strong><label>Session <select aria-label="Browser session" value={profile} onChange={e => { setProfile(e.target.value); setError(''); }}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button onClick={() => setAdding(v => !v)}>New session</button><button aria-label="Close browser" onClick={() => setVisible(false)}>×</button></div>
      {adding && <form className="browser-toolbar" onSubmit={e => { e.preventDefault(); add(); }}><input aria-label="New session name" placeholder="Admin, User, Work…" value={newName} onChange={e => setNewName(e.target.value)} maxLength={60}/><button type="submit" disabled={!newName.trim()}>Create</button></form>}
      <form className="browser-toolbar" onSubmit={e => { e.preventDefault(); try { const u = new URL(address); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); open(u.href); } catch { setError('Enter a complete http:// or https:// URL.'); } }}>
        <button type="button" aria-label="Back" disabled={!url} onClick={() => act('back')}>←</button><button type="button" aria-label="Forward" disabled={!url} onClick={() => act('forward')}>→</button><button type="button" aria-label="Reload" disabled={!url} onClick={() => act('reload')}>↻</button><input id="browser-address" aria-label="Browser address" placeholder="http://localhost:3000" value={address} onChange={e => setAddress(e.target.value)}/><button type="submit">Go</button>
      </form>
      <div className="browser-toolbar browser-hint"><span>Logins stay separate in each session.</span><button disabled={!address} onClick={() => void openUrl(address).catch(e => setError(String(e)))}>Open externally</button></div>
      {error && <p className="browser-error" role="alert">{error}</p>}
      <div className="browser-surface" ref={area}>{!url && <p>Open a link in a conversation or enter a URL above. Sign in once per session to keep accounts separate.</p>}</div>
    </aside>}
    </div>
  </BrowserContext.Provider></ToggleContext.Provider>;
}
