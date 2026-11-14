import { ColorField } from "./ColorField";
import { removeConnection } from "./account-removal";
import { canReconnect } from "./reconnect";
import { ReconnectButton } from "./ReconnectButton";
import { checkAccountAuth, needsReconnect, reportLoginSuccess, useAccountAuthStore, type AccountAuth } from "./accountAuth";
import { agentDisplayName } from "./types";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@freddai/ui/components/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from "@freddai/ui/components/dropdown-menu";
import { Input } from "@freddai/ui/components/input";
import { Code2, Terminal, Plus, RefreshCw, MoreHorizontal, GripVertical } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import "./AccountSetup.css";
import type { Account, Database } from "./types";
const colors = [
  "#b59ae9",
  "#77b9df",
  "#8ec6a2",
  "#e7a17d",
  "#e89cbd",
  "#d9c079",
];
type ExistingSignIn = { provider: string; signed_in: boolean; error: string | null };
type Installation = { provider: string; path: string | null };
const names: Record<string, string> = { codex: "Codex", claude: "Claude Code", antigravity: "Antigravity CLI", gemini: "Gemini CLI (legacy)", grok: "Grok", opencode: "OpenCode", cursor: "Cursor CLI", copilot: "Copilot CLI" };
const SHARED_CLI_PROVIDERS = ["antigravity", "opencode", "cursor", "copilot"];
const SIGNED_LABEL: Record<string, string> = { gemini: "Credentials saved", opencode: "CLI connected", cursor: "CLI connected", copilot: "CLI connected" };
/** Status text for a row. Derived only from the auth store, so it can never disagree with the Reconnect button. */
function authLabel(auth: AccountAuth, provider: string) {
  if (auth.status === "valid") return SIGNED_LABEL[provider] ?? "Signed in";
  if (auth.status === "expired" || auth.status === "unverified") return auth.message;
  return "Checking sign-in…";
}
function SortableAccount({ id, name, onAltMove, children }: { id: string; name: string; onAltMove: (offset: -1 | 1) => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, transition: { duration: 200, easing: "ease" } });
  return (
    <li ref={setNodeRef} className="setup-account" data-dragging={isDragging ? "true" : undefined}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}>
      <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} className="project-drag-handle setup-account-handle"
        aria-label={`Reorder ${name}`} title="Drag to reorder · Alt+↑/↓ to move"
        onKeyDown={e => {
          if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); onAltMove(e.key === "ArrowUp" ? -1 : 1); return; }
          listeners?.onKeyDown?.(e);
        }}><GripVertical size={13} /></button>
      {children}
    </li>
  );
}
export function AccountSetup({
  db,
  native,
  onRefresh,
  onDone,
}: {
  db: Database;
  native: boolean;
  onRefresh: () => Promise<void>;
  onDone?: () => void;
}) {
  const [installed, setInstalled] = useState<Installation[] | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [notes, setNotes] = useState<Record<string, string>>({}); // transient sign-in progress/errors; auth state itself lives in accountAuth
  const [adding, setAdding] = useState(""),
    [name, setName] = useState(""),
    [color, setColor] = useState(colors[0]);
  const [removing, setRemoving] = useState("");
  const [renaming, setRenaming] = useState("");
  const [connectionName, setConnectionName] = useState("");
  // Optimistic account order while the save is in flight; db.accounts comes back already sorted after onRefresh.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [orderError, setOrderError] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const orderedAccounts = localOrder
    ? [...db.accounts].sort((x, y) => (localOrder.indexOf(x.id) + 1 || Infinity) - (localOrder.indexOf(y.id) + 1 || Infinity))
    : db.accounts;
  async function saveOrder(order: string[]) {
    setLocalOrder(order);
    setOrderError("");
    try {
      await invoke("save_account_order", { order });
      await onRefresh();
    } catch (e) {
      console.error("[save_account_order] failed", e);
      setOrderError(`Could not save account order: ${String(e)}`);
    } finally {
      if (mounted.current) setLocalOrder(null);
    }
  }
  function moveAccount(id: string, offset: -1 | 1) {
    const ids = orderedAccounts.map(a => a.id);
    const from = ids.indexOf(id), to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    void saveOrder(arrayMove(ids, from, to));
  }
  function accountDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = orderedAccounts.map(a => a.id);
    const from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void saveOrder(arrayMove(ids, from, to));
  }
  const renameTrigger = useRef<HTMLButtonElement | null>(null);
  const menuTriggers = useRef<Record<string, HTMLButtonElement | null>>({});
  function finishRename() {
    setRenaming("");
    requestAnimationFrame(() => renameTrigger.current?.focus());
  }
  function saveName(account: string) {
    void run(async () => {
      await invoke("rename_account", { account, name: connectionName });
      await onRefresh();
      finishRename();
    });
  }
  const [existing, setExisting] = useState<ExistingSignIn[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [connecting, setConnecting] = useState("");
  const [connectionError, setConnectionError] = useState<{ provider: string; message: string } | null>(null);
  const lock = useRef(false);
  const authOf = useAccountAuthStore();
  const [loginProgress, setLoginProgress] = useState<Record<string, string>>(
    {},
  );
  const requestSerial = useRef<Record<string, number>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function clearNote(id: string) {
    setNotes((s) => { const rest = { ...s }; delete rest[id]; return rest; });
  }
  async function checkAccount(id: string) {
    const serial = (requestSerial.current[id] || 0) + 1;
    requestSerial.current[id] = serial;
    setError("");
    try {
      const progress = await invoke<{
        status: string;
        error: string | null;
      } | null>("login_state", { account: id });
      if (progress?.status === "pending") {
        if (mounted.current && requestSerial.current[id] === serial) {
          setLoginProgress((s) => ({ ...s, [id]: "pending" }));
          setNotes((s) => ({ ...s, [id]: "Complete sign-in in your browser. Freddai will confirm automatically." }));
        }
        return;
      }
    } catch (e) {
      console.error("[login_state] failed", id, e);
    }
    if (mounted.current && requestSerial.current[id] === serial) clearNote(id);
    await checkAccountAuth(id);
  }

  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function scan() {
    setInstalled(await invoke<Installation[]>("detect_agents"));
    setExisting(null);
    setExisting(await invoke<ExistingSignIn[]>("detect_existing_sign_ins"));
    for (const a of db.accounts) void checkAccount(a.id);
  }
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    void invoke<ExistingSignIn[]>("detect_existing_sign_ins").then((v) => {
      if (!disposed) setExisting(v);
    }).catch((e) => { if (!disposed) setError(String(e)); });
    void invoke<Installation[]>("detect_agents")
      .then((v) => {
        if (!disposed) setInstalled(v);
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
    };
  }, [native]);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const seen: Record<string, string> = {};
    for (const a of db.accounts) void checkAccount(a.id);
    async function poll() {
      await Promise.all(
        db.accounts
          .filter((a) => a.provider === "codex" || a.provider === "grok")
          .map(async (a) => {
            try {
              const progress = await invoke<{
                status: string;
                error: string | null;
              } | null>("login_state", { account: a.id });
              const key = JSON.stringify(progress);
              if (disposed || seen[a.id] === key) return;
              seen[a.id] = key;
              if (!progress) return;
              requestSerial.current[a.id] =
                (requestSerial.current[a.id] || 0) + 1;
              setLoginProgress((s) => ({ ...s, [a.id]: progress.status }));
              if (progress.status === "ready") {
                // "ready" only proves credentials were written. Verify live; the row text comes from the auth store.
                clearNote(a.id);
                void reportLoginSuccess(a.id);
              } else setNotes((s) => ({
                ...s,
                [a.id]:
                  progress.status === "pending"
                    ? "Complete sign-in in your browser. Freddai will confirm automatically."
                    : progress.error ||
                      "Sign-in did not complete. Try again.",
              }));
            } catch (e) {
              if (!disposed)
                setError(`Could not monitor sign-in: ${String(e)}`);
            }
          }),
      );
      if (!disposed) timer = setTimeout(poll, 1000);
    }
    void poll();
    function focus() {
      for (const a of db.accounts) void checkAccount(a.id);
    }
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
    };
  }, [native, db.accounts.map((a) => a.id).join("|")]);
  function add(provider: string, separate = false) {
    setImporting(false);
    const current = existing?.find((a) => a.provider === provider);
    if (provider === "claude" && !separate && current?.signed_in) {
      setImporting(true); setAdding(provider);
      const previous = db.accounts.find(a => a.provider === provider && a.config_home);
      setName(previous?.name || `Claude Code ${db.accounts.filter(a => a.provider === provider).length + 1}`);
      setColor(previous?.color || colors[db.accounts.length % colors.length]);
      return;
    }
    if (!separate && (current?.signed_in || SHARED_CLI_PROVIDERS.includes(provider))) {
      void run(async () => {
        setConnecting(provider);
        setConnectionError(null);
        try {
          await invoke<Account>("connect_existing", { provider });
          await onRefresh();
        } catch (e) {
          setConnectionError({ provider, message: String(e) });
        } finally {
          setConnecting("");
        }
      });
      return;
    }
    setAdding(provider);
    const n = db.accounts.filter((a) => a.provider === provider).length + 1;
    setName(`${names[provider]} ${n}`);
    setColor(colors[db.accounts.length % colors.length]);
  }
  async function login(id: string, provider?: string) {
    requestSerial.current[id] = (requestSerial.current[id] || 0) + 1;
    setNotes((s) => ({ ...s, [id]: "Opening sign-in…" }));
    await invoke("login", { account: id });
    const codex =
      ["codex","grok"].includes(provider || db.accounts.find((a) => a.id === id)?.provider || "");
    if (codex) setLoginProgress((s) => ({ ...s, [id]: "pending" }));
    setNotes((s) => ({
      ...s,
      [id]: codex
        ? "Complete sign-in in your browser. Freddai will confirm automatically."
        : "Complete sign-in in Terminal, then return here.",
    }));
  }
  const readyAccounts = db.accounts.filter((a) => authOf(a.id).status === "valid");
  const defaultAccount = db.preferences.prefer_last
    ? undefined
    : db.accounts.find((a) => a.id === db.preferences.fallback);
  const summary = readyAccounts.length
    ? `${readyAccounts.length} account${readyAccounts.length === 1 ? "" : "s"} ready${
        defaultAccount && authOf(defaultAccount.id).status === "valid"
          ? ` · New threads use ${agentDisplayName(defaultAccount)}`
          : ""
      }`
    : "No accounts ready yet. Connect an existing sign-in or add an account below.";
  function accountRow(a: Account) {
    const auth = authOf(a.id);
    const signed = auth.status === "valid";
    const checking = auth.status === "checking";
    const isPending = loginProgress[a.id] === "pending";
    const status = notes[a.id] || authLabel(auth, a.provider);
    // Inline Reconnect only when the sign-in is known-bad; a valid sign-in gets "Reconnect…" in the menu instead.
    const inlineReconnect = canReconnect(a.provider) && !isPending && needsReconnect(auth);
    const inlineSignIn = !canReconnect(a.provider) && !a.config_home && !isPending && needsReconnect(auth);
    const showSignIn = !signed || canReconnect(a.provider);
    const busy = isPending || db.sessions.some(
      (s) => s.account === a.id && ["starting", "running", "waiting"].includes(s.status),
    );
    return (
      <SortableAccount key={a.id} id={a.id} name={a.name} onAltMove={offset => moveAccount(a.id, offset)}>
        <span className="account-color" style={{ background: a.color }} />
        <div className="setup-account-main">
          <div className="setup-account-name">
            <strong>{agentDisplayName(a)}</strong>
            <span className="setup-tag">{names[a.provider] ?? a.provider}</span>
            <span className="setup-tag">
              {a.config_home ? "Uses CLI sign-in" : "Separate login"}
            </span>
          </div>
                    <p
            role="status"
            className={`setup-account-status${signed ? " is-ready" : needsReconnect(auth) ? " is-expired inline-error" : ""}`}
            title={
              auth.checkedAt && !checking
                ? `Last checked at ${new Date(auth.checkedAt).toLocaleTimeString()}`
                : undefined
            }
          >
            {status}
          </p>
        </div>
        <div className="setup-account-actions">
          {!db.preferences.prefer_last && db.preferences.fallback === a.id && <span className="setup-default-badge">Default</span>}
          {inlineReconnect && <ReconnectButton account={a.id} provider={a.provider} variant="default"
            onReconnected={() => { void onRefresh(); }} />}
          {inlineSignIn && <Button type="button" size="sm" variant="default" disabled={pending || !native}
            onClick={() => void run(() => login(a.id))}>Sign in</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm"
                ref={el => { menuTriggers.current[a.id] = el; }}
                aria-label={`Actions for ${a.name}`} title={`Actions for ${a.name}`}>
                <MoreHorizontal size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="dev-popup account-menu" onEscapeKeyDown={e => e.stopPropagation()} align="end" aria-label={`Actions for ${a.name}`}>
              <DropdownMenuLabel className="thread-menu-label">{agentDisplayName(a)}</DropdownMenuLabel>
              <DropdownMenuItem disabled={pending || !native}
                onSelect={() => {
                  renameTrigger.current = menuTriggers.current[a.id];
                  setConnectionName(a.name); setError("");
                  requestAnimationFrame(() => setRenaming(a.id));
                }}>Rename…</DropdownMenuItem>
              <DropdownMenuItem disabled={pending || !native || checking}
                onSelect={() => void checkAccount(a.id)}>{checking ? "Checking…" : "Check connection"}</DropdownMenuItem>
              {a.config_home ? (
                <DropdownMenuLabel className="thread-menu-label">Sign-in managed in {names[a.provider]}</DropdownMenuLabel>
              ) : isPending ? (
                ["codex", "grok"].includes(a.provider) && <DropdownMenuItem disabled={pending || !native}
                  onSelect={() => void run(async () => { await invoke("cancel_login", { account: a.id }); })}>Cancel sign-in</DropdownMenuItem>
              ) : showSignIn && <DropdownMenuItem disabled={pending || !native}
                onSelect={() => void run(() => login(a.id))}>
                {signed ? (canReconnect(a.provider) ? "Reconnect…" : "Sign in again") : ["codex", "grok"].includes(a.provider) ? "Sign in with browser" : "Sign in in Terminal"}
              </DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={pending || !native || !signed || (!db.preferences.prefer_last && db.preferences.fallback === a.id)}
                onSelect={() => void run(async () => {
                  await invoke("save_preferences", { patch: { prefer_last: false, fallback: a.id } });
                  await onRefresh();
                })}>Set as default</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="thread-menu-danger" disabled={pending || !native}
                onSelect={() => { setRenaming(""); setRemoving(a.id); }}>Remove connection…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {renaming === a.id && (
          <div className="setup-rename-connection" role="group" aria-label={`Rename ${a.name} connection`}>
            <label htmlFor={`connection-name-${a.id}`}>Connection name</label>
            <Input id={`connection-name-${a.id}`} autoFocus value={connectionName}
              disabled={pending} onChange={e => setConnectionName(e.target.value)}
              onKeyDown={e => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (!pending && connectionName.trim()) saveName(a.id); }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!pending) finishRename(); }
              }} />
            <div className="setup-actions">
              <Button type="button" size="sm" disabled={pending || !connectionName.trim()}
                onClick={() => saveName(a.id)}>Save name</Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending}
                onClick={finishRename}>Cancel</Button>
            </div>
          </div>
        )}
        {removing === a.id && (
          <div className="setup-remove-confirm" role="group" aria-label={`Remove ${a.name} connection`}>
            <p>Remove {a.name} from Freddai? CLI sign-in and conversation history are kept.
              Any active work and pending sign-in on this connection will be stopped. Threads and schedules using this connection will need your attention; they will not switch accounts.</p>
            <Button size="sm" variant="outline" disabled={pending || !native}
              onClick={() => void run(async () => {
                await removeConnection(a.id, invoke);
                requestSerial.current[a.id] = (requestSerial.current[a.id] || 0) + 1;
                setRemoving("");
                await onRefresh();
              })}>{pending ? "Removing…" : busy ? "Stop work and remove connection" : "Remove connection"}</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRemoving("")}>Cancel</Button>
          </div>
        )}
      </SortableAccount>
    );
  }
  return (
    <div className="account-setup" aria-label="Agent accounts">
      <div className="setup-summary">
        <p role="status">{summary}</p>
        <Button
          size="sm"
          variant="ghost"
          disabled={!native || pending}
          onClick={() => void run(scan)}
        >
          <RefreshCw size={13} />
          Scan again
        </Button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {!native && (
        <p className="capture-help">
          Agent detection is available in the installed macOS app.
        </p>
      )}
      {!!orderedAccounts.length && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={accountDragEnd}>
          <SortableContext items={orderedAccounts.map(a => a.id)} strategy={verticalListSortingStrategy}>
            <ul className="setup-accounts" aria-label="Accounts, in display order">{orderedAccounts.map(accountRow)}</ul>
          </SortableContext>
        </DndContext>
      )}
      {orderError && <p role="alert" className="inline-error">{orderError}</p>}
      {["codex", "claude", "antigravity", "grok", "opencode", "cursor", "copilot", ...(db.accounts.some(a => a.provider === "gemini") ? ["gemini"] : [])].map((provider) => {
        const agent = installed?.find((a) => a.provider === provider);
        const accounts = db.accounts.filter((a) => a.provider === provider);
        const exist = existing?.find((a) => a.provider === provider);
        const hasCli = accounts.some((a) => a.config_home);
        const missing = native && !!installed && !agent?.path;
        return (
          <section key={provider} className="setup-provider">
            <header>
              {provider === "codex" ? (
                <Code2 size={18} />
              ) : (
                <Terminal size={18} />
              )}
              <h3>{names[provider]}</h3>
              <span className="setup-chip" data-state={agent?.path ? "ok" : "off"}>
                {!native
                  ? "Open desktop app"
                  : !installed
                    ? "Checking…"
                    : agent?.path
                      ? "Installed"
                      : "Not found"}
              </span>
            </header>
            {["opencode", "cursor"].includes(provider) && <p className="capture-help">Uses shared CLI configuration. Sign in with {provider === "cursor" ? "agent login" : "opencode auth login"} in Terminal, then connect it here. Separate logins are unsupported. Connection checks confirm ACP session access; provider credentials and model access are verified when you send a message.</p>}
            <details className="setup-provider-details">
              <summary>Setup details</summary>
              {agent?.path && <p className="capture-help">Installation: <code>{agent.path}</code></p>}
              {provider === "antigravity" && <p className="capture-help">Install with <code>brew install --cask antigravity-cli</code>. Sign in with <code>agy</code> in Terminal, then add the current connection. Uses the CLI’s shared Keychain sign-in; switching accounts in Antigravity changes this connection too. Separate subscription logins are not supported. Requires a version supporting <code>agy acp</code>.</p>}
              {provider === "copilot" && <p className="capture-help">Install with <code>npm install -g @github/copilot</code> (or <code>brew install copilot-cli</code>). Sign in with <code>copilot login</code> in Terminal, then add the current connection. State lives in <code>~/.copilot</code>. Uses the CLI’s shared sign-in; separate subscription logins are not supported. Usage shows your monthly premium-request allowance and needs the GitHub CLI (<code>gh</code>) signed in with <code>gh auth login</code>. Each prompt costs premium requests × the model multiplier shown by Copilot.</p>}
              {provider === "gemini" && <p className="capture-help">Gemini is experimental. Check sign-in detects saved OAuth credentials; the agent verifies them when starting a thread. Sign in using Google in its CLI, then exit the CLI and return here.</p>}
              {!SHARED_CLI_PROVIDERS.includes(provider) && provider !== "gemini" && <p className="capture-help">Connect the current CLI sign-in or add a separate login for another subscription. {provider === "claude" ? "Saving your Terminal login creates an independent profile, so later Terminal logins do not replace it." : "Shared connections follow account changes in the CLI."}</p>}
            </details>
            {missing && (
              <p className="capture-help">
                Install the official {names[provider]} CLI, then scan again.
                Freddai does not install software automatically.
              </p>
            )}
            {agent?.path && (
              <>
                {!accounts.length && !exist?.signed_in && existing && (
                  <p className="capture-help">
                    No {names[provider]} accounts yet.
                  </p>
                )}
                {adding !== provider && (!SHARED_CLI_PROVIDERS.includes(provider) || !hasCli) && <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="setup-add-button" variant="ghost" size="sm"
                      disabled={pending || !native || !existing} aria-label={`Add ${names[provider]} account`}>
                      <Plus size={13} />{connecting === provider ? "Connecting…" : "Add account"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="dev-popup account-menu" onEscapeKeyDown={e => e.stopPropagation()} align="start" aria-label={`Add ${names[provider]} account`}>
                    <DropdownMenuLabel className="thread-menu-label">{names[provider]}</DropdownMenuLabel>
                    <DropdownMenuItem disabled={pending || (hasCli && provider !== "claude") || (!exist?.signed_in && !SHARED_CLI_PROVIDERS.includes(provider))}
                      onSelect={() => requestAnimationFrame(() => add(provider))}>{provider === "claude" ? "Save current Terminal login…" : "Use current CLI sign-in"}</DropdownMenuItem>
                    {hasCli && provider === "claude" && <DropdownMenuLabel className="thread-menu-label">Save your current login before adding another account</DropdownMenuLabel>}
                    {hasCli && provider !== "claude" && <DropdownMenuLabel className="thread-menu-label">Current CLI sign-in is already connected</DropdownMenuLabel>}
                    {!SHARED_CLI_PROVIDERS.includes(provider) && <DropdownMenuItem disabled={pending || (provider === "claude" && hasCli)}
                      onSelect={() => requestAnimationFrame(() => add(provider, true))}>Add separate account…</DropdownMenuItem>}
                    {SHARED_CLI_PROVIDERS.includes(provider) && <DropdownMenuLabel className="thread-menu-label">Sign in in the official CLI in Terminal first</DropdownMenuLabel>}
                  </DropdownMenuContent>
                </DropdownMenu>}
                {connectionError?.provider === provider && (
                  <p role="alert" className="inline-error">{connectionError.message}</p>
                )}
                {!existing && (
                  <p role="status" className="capture-help">
                    Checking existing CLI sign-in…
                  </p>
                )}
                {existing && exist?.error && (
                  <p role="status" className="capture-help">
                    Could not check existing CLI sign-in. Try Scan again.
                  </p>
                )}
                {existing &&
                  !SHARED_CLI_PROVIDERS.includes(provider) &&
                  !exist?.error &&
                  !exist?.signed_in &&
                  !accounts.length && (
                    <p role="status" className="capture-help">
                      No existing CLI sign-in found.
                    </p>
                  )}
                {!SHARED_CLI_PROVIDERS.includes(provider) && adding === provider && (
                  <form
                    className="setup-add-account"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        const account = await invoke<Account>(importing ? "save_claude_login" : "add_account", {
                          name,
                          provider: adding,
                          color,
                        });
                        setAdding("");
                        setName("");
                        await onRefresh();
                        if (!importing) await login(account.id, account.provider);
                      });
                    }}
                  >
                    <p>
                      {importing ? "Save this Terminal login as an independent account. Later Terminal sign-ins will not replace it." : "This creates a separate login for another subscription."}{" "}
                      {!importing && (exist?.signed_in && !hasCli
                        ? "To reuse your current CLI sign-in, cancel and choose Use current CLI sign-in from Add account."
                        : hasCli ? "Your current CLI sign-in is already connected." : "A provider sign-in is required for this separate profile.")}
                    </p>
                    <label>
                      Account name
                      <Input
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Personal or Work"
                      />
                    </label>
                    <label>
                      Account color
                      <ColorField label="Account color" value={color} onChange={setColor} />
                    </label>
                    <div className="setup-actions">
                      <Button disabled={!native || pending || !name.trim()}>
                        {importing ? "Save account" : "Add separate account & sign in"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => setAdding("")}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </>
            )}
          </section>
        );
      })}
      {onDone && <Button
        variant={readyAccounts.length ? "default" : "outline"}
        disabled={pending}
        onClick={onDone}
      >
        {readyAccounts.length ? "Done" : "Set up later"}
      </Button>}
    </div>
  );
}
