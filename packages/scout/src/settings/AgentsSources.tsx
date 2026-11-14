import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Calendar, ChevronDown, ChevronRight, Gamepad2, Hash, HardDrive, FileText, Mail, MessageCircle, Minus, Phone, Plus, Sparkles,
  Terminal, Trash2, Video, type LucideIcon,
} from "lucide-react";
import { openApp } from "@freddai/shared/apps/registry";
import { providerName, type Account } from "@freddai/shared/agent/types";
import {
  scoutDetectAccountConnectors, scoutDetectConnections, uuid,
  type AccountConnector, type AccountConnectors, type DetectedConnection, type Detection, type Source,
} from "../api";
import type { ScreenBase } from "../contracts";
import { FreddaiStatusNote } from "../freddaiLink";
import { Avatar, cx, GhostButton, Pill } from "../ui";
import "./DetectedConnections.css";
import {
  ACCESS_LABELS, InlineError, Modal, SOURCE_KINDS, STATUS_LABELS, SourceKindIcon, errorText, sourceKindLabel, useRun,
  type SourceAccess, type SourceKind,
} from "./common";

/** Shape returned by the Freddai `detect_agents` IPC (see packages/app/src/desktop/AccountSetup.tsx). */
export type Installation = { provider: string; path: string | null };

/** Provider CLIs installed on this computer, via Freddai's `detect_agents`. Errors are kept and shown. */
export function useDetectedAgents() {
  const [found, setFound] = useState<Installation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    invoke<Installation[]>("detect_agents")
      .then(list => { if (alive) setFound(Array.isArray(list) ? list.filter(i => i.path) : []); })
      .catch(e => { console.error("[scout] detect_agents failed", e); if (alive) setError(errorText(e)); });
    return () => { alive = false; };
  }, []);
  return { found, error };
}

/** Email, calendar, chat and meeting connections found on this computer, via the Rust `scout_detect_connections`.
 *  Runs on mount. A failed call is kept in `error`; per-signal failures arrive as `result.warnings`. */
export function useDetectedConnections() {
  const [result, setResult] = useState<Detection | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    scoutDetectConnections()
      .then(r => { if (alive) setResult({ connections: Array.isArray(r?.connections) ? r.connections : [], warnings: Array.isArray(r?.warnings) ? r.warnings : [] }); })
      .catch(e => { console.error("[scout] scout_detect_connections failed", e); if (alive) setError(errorText(e)); });
    return () => { alive = false; };
  }, []);
  return { result, error, loading: result === null && error === null };
}

/** Connectors each Freddai agent account already has (claude.ai connectors, MCP servers…), via `scout_detect_account_connectors`.
 *  Runs on mount. A failed call is kept in `error` (shown on the page); per-account problems arrive as `warning`. */
export function useAccountConnectors() {
  const [byAccount, setByAccount] = useState<Map<string, AccountConnectors> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    scoutDetectAccountConnectors()
      .then(r => { if (alive) setByAccount(new Map((Array.isArray(r?.accounts) ? r.accounts : []).map(a => [a.account, a]))); })
      .catch(e => { console.error("[scout] scout_detect_account_connectors failed", e); if (alive) setError(errorText(e)); });
    return () => { alive = false; };
  }, []);
  return { byAccount, error, loading: byAccount === null && error === null };
}

/** Marker stored in Source.detail for sources Scout created from a detected connector. */
export const DETECTED_PREFIX = "detected:";
export const detectedDetail = (c: Pick<AccountConnector, "key">) => DETECTED_PREFIX + c.key;
const findDetectedSource = (sources: Source[], accountId: string, c: AccountConnector) =>
  sources.find(s => s.account === accountId && s.detail === detectedDetail(c));

/** Provider id (scout-core detect) -> the closest existing Source kind; everything else is "custom". */
const PROVIDER_SOURCE_KIND: Record<string, SourceKind> = {
  gmail: "gmail", google_calendar: "calendar", google_meet: "meet", slack: "slack",
  whatsapp: "whatsapp", discord: "discord", imessage: "imessage",
};
const providerKind = (provider: string): SourceKind => PROVIDER_SOURCE_KIND[provider] ?? "custom";
const connectionKind = (c: DetectedConnection): SourceKind => providerKind(c.provider);
const connectionDetail = (c: DetectedConnection) => c.account;
const sameConnection = (c: DetectedConnection, s: Source) =>
  s.kind === connectionKind(c) && s.label.toLowerCase() === c.label.toLowerCase() && s.detail.trim().toLowerCase() === connectionDetail(c).toLowerCase();

const VIA_LABELS: Record<string, string> = { freddai_google_account: "Freddai Google account", installed_app: "installed app" };
export const viaLabel = (via: string) => VIA_LABELS[via] ?? (via.startsWith("agent_mcp:") ? `${via.slice("agent_mcp:".length)} MCP` : via);
const SIGNAL_LABELS: Record<string, string> = { freddai_google_accounts: "Freddai Google accounts", installed_apps: "installed apps" };
const signalLabel = (signal: string) => SIGNAL_LABELS[signal] ?? (signal.startsWith("agent_mcp:") ? `${signal.slice("agent_mcp:".length)} MCP config` : signal);

function DetectedConnections({ detection, sources, accounts, onAdd }: {
  detection: ReturnType<typeof useDetectedConnections>;
  sources: Source[];
  accounts: Account[];
  onAdd: (c: DetectedConnection, accountId: string) => void;
}) {
  const { result, error, loading } = detection;
  const [target, setTarget] = useState<Record<string, string>>({});
  const list = result?.connections ?? [];
  const warnings = result?.warnings ?? [];
  const canAdd = accounts.length > 0;
  return <section className="st-detected" aria-label="Also on this computer">
    <div className="st-detected__head">
      <h3 className="st-detected__title">Also on this computer</h3>
      <span className="st-muted">Email, calendar, chat and meetings found here, not tied to an agent yet</span>
    </div>
    {loading && <p className="st-muted" role="status">Checking this computer…</p>}
    {error && <div className="st-detected__warnings" role="alert"><p>Could not check for connections: {error}</p></div>}
    {warnings.length > 0 && <div className="st-detected__warnings" role="alert">
      {warnings.map((w, i) => <p key={i}>Couldn’t check {signalLabel(w.signal)}: {w.message}</p>)}
    </div>}
    {!loading && !error && list.length === 0 && <p className="st-muted">No email, calendar or chat apps found on this computer</p>}
    {list.length > 0 && <ul className="st-detected__list">
      {list.map(c => {
        const accountId = target[c.id] ?? accounts[0]?.id ?? "";
        const added = sources.some(s => s.account === accountId && sameConnection(c, s));
        const name = `${c.label}${c.account ? ` ${c.account}` : ""}`;
        return <li key={c.id} className="st-detected__row">
          <SourceKindIcon kind={connectionKind(c)} />
          <span className="st-detected__label">{c.label}</span>
          <span className="st-detected__account">{c.account}</span>
          <span className="st-detected__via">via {c.found_via.map(viaLabel).join(", ")}</span>
          {accounts.length > 1 && <select className="st-detected__pick" value={accountId} aria-label={`Account for ${name}`}
            onChange={e => setTarget(t => ({ ...t, [c.id]: e.target.value }))}>
            {accounts.map(a => <option key={a.id} value={a.id}>{providerName(a.provider)} · {a.name}</option>)}
          </select>}
          {added
            ? <Pill variant="success">Added</Pill>
            : <GhostButton icon={<Plus size={14} />} disabled={!canAdd} title={canAdd ? undefined : "Add an agent in Freddai first"}
                aria-label={`Add ${name}`} onClick={() => onAdd(c, accountId)}>Add</GhostButton>}
        </li>;
      })}
    </ul>}
  </section>;
}

const PROVIDER_ICONS: Record<string, LucideIcon> = {
  gmail: Mail, google_calendar: Calendar, google_drive: HardDrive, slack: Hash, zoom: Video, google_meet: Video,
  notion: FileText, whatsapp: Phone, discord: Gamepad2, imessage: MessageCircle,
};
function ProviderMark({ provider, label }: { provider: string; label: string }) {
  const Icon = PROVIDER_ICONS[provider];
  return Icon
    ? <Icon size={15} strokeWidth={1.9} className="st-chip__icon" aria-hidden />
    : <span className="st-chip__initial" aria-hidden>{label.trim().charAt(0).toUpperCase() || "?"}</span>;
}

/** One detected connector on an agent card. Connected ones toggle; needs_auth and failed ones cannot be switched on. */
function ConnectorChip({ connector, enabled, agent, onToggle }: {
  connector: AccountConnector;
  enabled: boolean;
  agent: string;
  onToggle: () => void;
}) {
  const { status } = connector;
  const usable = status === "connected" || status === "unknown";
  const hint = status === "needs_auth" ? `Sign in via ${agent}`
    : status === "failed" ? `Failed in ${agent}`
    : status === "unknown" ? "Status unknown" : null;
  return <button type="button" role="switch" aria-checked={usable && enabled} disabled={!usable}
    aria-label={`${connector.label}${hint ? `, ${hint}` : ""}`}
    title={hint ? `${connector.label} (${connector.raw_name}): ${hint}` : connector.raw_name}
    className={cx("st-chip", `is-${status}`, usable && enabled && "is-on")} onClick={onToggle}>
    <ProviderMark provider={connector.provider} label={connector.label} />
    <span className="st-chip__label">{connector.label}</span>
    {hint && <span className="st-chip__hint">{hint}</span>}
    {usable && <span className="st-chip__check" aria-hidden />}
  </button>;
}

/** Dev plugin MCP servers are not life sources; they are hidden and never auto-added. */
export const isLifeSourceConnector = (c: AccountConnector) => c.via !== "claude_plugin_mcp";

const KIND_ORDER: string[] = ["email", "calendar", "chat", "meetings", "files", "other"];
const STATUS_ORDER: AccountConnector["status"][] = ["connected", "unknown", "needs_auth", "failed"];
const rank = (order: string[], v: string) => { const i = order.indexOf(v); return i < 0 ? order.length : i; };
/** Chips ordered by kind (email, calendar, chat, meetings, files, other), then status, then label. */
export const sortConnectors = (list: AccountConnector[]) => [...list].sort((a, b) =>
  rank(KIND_ORDER, a.kind) - rank(KIND_ORDER, b.kind) || rank(STATUS_ORDER, a.status) - rank(STATUS_ORDER, b.status)
  || a.label.localeCompare(b.label));

/** Chips for one account: needs_auth ones sit behind a "N not signed in" toggle. */
function ConnectorChips({ connectors, agent, enabledFor, onToggle }: {
  connectors: AccountConnector[];
  agent: string;
  enabledFor: (c: AccountConnector) => boolean;
  onToggle: (c: AccountConnector) => void;
}) {
  const [open, setOpen] = useState(false);
  const sorted = sortConnectors(connectors);
  const inline = sorted.filter(c => c.status !== "needs_auth");
  const hidden = sorted.filter(c => c.status === "needs_auth");
  const shown = open ? sorted : inline;
  return <div className="st-chips">
    {shown.map(c => <ConnectorChip key={c.key} connector={c} agent={agent} enabled={enabledFor(c)} onToggle={() => onToggle(c)} />)}
    {hidden.length > 0 && <button type="button" className="st-link" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      {open ? "Hide not signed in" : `${hidden.length} not signed in`}
    </button>}
  </div>;
}

function ChipSkeleton() {
  return <div className="st-chips" role="status" aria-label="Checking connections">
    {[88, 120, 100].map(w => <span key={w} className="st-chip st-chip--skeleton" style={{ width: w }} aria-hidden />)}
  </div>;
}

/** "Use" is a UI-only preference for now: localStorage `scout.agents.use.<accountId>`, default on.
 *  It is not in ScoutState yet; move it there once scout-core grows an agents section. */
export const useKey = (accountId: string) => `scout.agents.use.${accountId}`;
export function readUse(accountId: string): boolean {
  try { return localStorage.getItem(useKey(accountId)) !== "false"; } catch { return true; }
}
function writeUse(accountId: string, value: boolean) {
  try { localStorage.setItem(useKey(accountId), String(value)); } catch (e) { console.error("[scout] could not store Use flag", e); }
}

export type SourceDraft = { kind: SourceKind; label: string; detail: string; access: SourceAccess; account: string };

export function AddSourceDialog({ accounts, initialAccount, onClose, onSave, page }: {
  accounts: Account[];
  initialAccount?: string;
  onClose: () => void;
  onSave: (draft: SourceDraft) => Promise<boolean>;
  /** Full-height variant used by onboarding step 1b ("Add a custom source"). */
  page?: boolean;
}) {
  const [draft, setDraft] = useState<SourceDraft>({
    kind: page ? "custom" : "gmail",
    label: page ? "" : "Gmail",
    detail: "",
    access: page ? "computer_use" : "direct",
    account: initialAccount ?? accounts[0]?.id ?? "",
  });
  const [labelTouched, setLabelTouched] = useState(false);
  const account = accounts.find(a => a.id === draft.account);
  const canSave = draft.label.trim() !== "" && draft.account !== "";
  const save = async () => { if (canSave && await onSave({ ...draft, label: draft.label.trim(), detail: draft.detail.trim() })) onClose(); };
  const body = <form className="st-form" onSubmit={e => { e.preventDefault(); void save(); }} id="st-add-source">
    <label className="st-field">
      <span className="st-field__label">Kind</span>
      <select value={draft.kind} onChange={e => {
        const kind = e.target.value as SourceKind;
        setDraft(d => ({ ...d, kind, label: labelTouched ? d.label : (kind === "custom" ? "" : sourceKindLabel(kind)) }));
      }}>
        {SOURCE_KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
    </label>
    <label className="st-field">
      <span className="st-field__label">Name</span>
      <input value={draft.label} placeholder="Google Meet" onChange={e => { setLabelTouched(true); setDraft(d => ({ ...d, label: e.target.value })); }} />
    </label>
    <label className="st-field">
      <span className="st-field__label">Detail</span>
      <input value={draft.detail} placeholder="you@company.example, a workspace name or a URL" onChange={e => setDraft(d => ({ ...d, detail: e.target.value }))} />
      <span className="st-field__hint">Which inbox, workspace, channel or URL this is.</span>
    </label>
    <label className="st-field">
      <span className="st-field__label">Access</span>
      <select value={draft.access} onChange={e => setDraft(d => ({ ...d, access: e.target.value as SourceAccess }))}>
        {(Object.keys(ACCESS_LABELS) as SourceAccess[]).map(a => <option key={a} value={a}>{ACCESS_LABELS[a]}</option>)}
      </select>
    </label>
    <label className="st-field">
      <span className="st-field__label">Agent</span>
      <select value={draft.account} onChange={e => setDraft(d => ({ ...d, account: e.target.value }))}>
        {accounts.length === 0 && <option value="">No Freddai agents found</option>}
        {accounts.map(a => <option key={a.id} value={a.id}>{providerName(a.provider)} · {a.name}</option>)}
      </select>
    </label>
    <p className="st-note">Scout has no live connection to this source yet. It is saved as “Not connected yet” so your agent knows it exists.</p>
  </form>;
  const footer = <>
    <span className="st-muted st-modal__foot-note">{account ? `Adds to ${providerName(account.provider)} · ${account.name}, tagged ${ACCESS_LABELS[draft.access]}` : "Pick an agent first"}</span>
    <GhostButton onClick={onClose}>Cancel</GhostButton>
    <button type="submit" form="st-add-source" className="sc-btn sc-btn--dark" disabled={!canSave}>Add source</button>
  </>;
  return <Modal wide={page} title={page ? "Add a custom source" : "Add a source manually"}
    subtitle={page ? "For anything without a ready connector. Fill it in here or describe it in the chat." : undefined}
    onClose={onClose} footer={footer}>{body}</Modal>;
}

function SourceRow({ source, removeAlways, onToggle, onRemove, onAccess }: {
  source: Source;
  removeAlways: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onAccess: (access: SourceAccess) => void;
}) {
  const [open, setOpen] = useState(false);
  const statusVariant = source.status === "connected" ? "success" : source.status === "needs_sign_in" ? "danger" : "backlog";
  return <li className={cx("st-source", open && "is-open", !source.enabled && "is-off")}>
    <div className="st-source__row">
      <input type="checkbox" checked={source.enabled} onChange={onToggle} aria-label={`Use ${source.label} ${source.detail}`.trim()} />
      <SourceKindIcon kind={source.kind} />
      <span className="st-source__label">{source.label}</span>
      <span className="st-source__detail">{source.detail}</span>
      <span className="st-source__pills">
        <Pill variant={statusVariant}>{STATUS_LABELS[source.status]}</Pill>
        <Pill variant={source.access === "direct" ? "backlog" : "purple"}>{ACCESS_LABELS[source.access]}</Pill>
      </span>
      <button type="button" className="st-icon-btn" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} details for ${source.label}`} onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      <button type="button" className={cx("st-remove", removeAlways && "is-always")} aria-label={`Remove ${source.label} ${source.detail}`.trim()} onClick={onRemove}>
        {removeAlways ? <Minus size={11} strokeWidth={3} /> : <Trash2 size={13} />}
      </button>
    </div>
    {open && <div className="st-source__more">
      <p>{source.status === "connected"
        ? "Connected."
        : `Not connected yet. Scout has no live ${sourceKindLabel(source.kind)} connection; this entry tells your agent the source exists.`}</p>
      <label className="st-inline-field">
        Access
        <select value={source.access} onChange={e => onAccess(e.target.value as SourceAccess)}>
          {(Object.keys(ACCESS_LABELS) as SourceAccess[]).map(a => <option key={a} value={a}>{ACCESS_LABELS[a]}</option>)}
        </select>
      </label>
    </div>}
  </li>;
}

export function AgentsSources({ state, db, actions, variant }: ScreenBase & { variant: "settings" | "onboarding" }) {
  const { run, error, clearError } = useRun();
  const detected = useDetectedAgents();
  const connections = useDetectedConnections();
  const accountConnectors = useAccountConnectors();
  const [dialog, setDialog] = useState<{ account?: string; page?: boolean } | null>(null);
  const [agentNote, setAgentNote] = useState<string | null>(null);
  const [use, setUse] = useState<Record<string, boolean>>({});
  const accounts = db?.accounts ?? [];
  const isUsed = (id: string) => use[id] ?? readUse(id);

  // Auto-add: the first time a connected connector shows up for an account with no Source for it, create one (enabled).
  // `attempted` makes this once-only per account+connector even before the store refreshes, so a Source the user
  // switched off (enabled:false, never deleted) is never re-created and the choice sticks.
  const attempted = useRef(new Set<string>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const sourcesRef = useRef(state.sources);
  sourcesRef.current = state.sources;
  const connectorSource = (accountId: string, c: AccountConnector): Source => ({
    id: uuid(), account: accountId, kind: providerKind(c.provider), label: c.label, detail: detectedDetail(c),
    access: "direct", enabled: true, status: "not_connected",
  });
  useEffect(() => {
    const found = accountConnectors.byAccount;
    if (!found) return;
    for (const account of accounts) {
      for (const c of (found.get(account.id)?.connectors ?? []).filter(isLifeSourceConnector)) {
        if (c.status !== "connected") continue;
        const id = `${account.id}|${c.key}`;
        if (attempted.current.has(id) || findDetectedSource(state.sources, account.id, c)) continue;
        attempted.current.add(id);
        queue.current = queue.current.then(() => {
          if (findDetectedSource(sourcesRef.current, account.id, c)) return;
          return run(() => actions.sourceSave(connectorSource(account.id, c)));
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountConnectors.byAccount, accounts, state.sources]);

  const toggleConnector = (accountId: string, c: AccountConnector) => {
    const existing = findDetectedSource(state.sources, accountId, c);
    void run(() => actions.sourceSave(existing ? { ...existing, enabled: !existing.enabled } : connectorSource(accountId, c)));
  };

  // Detected sources that no connector currently explains still need a row so they can be turned off or removed.
  const sourcesFor = (accountId: string) => state.sources.filter(s => s.account === accountId && !(
    s.detail.startsWith(DETECTED_PREFIX) && (accountConnectors.byAccount?.get(accountId)?.connectors ?? []).filter(isLifeSourceConnector).some(c => detectedDetail(c) === s.detail)));
  const orphans = state.sources.filter(s => !accounts.some(a => a.id === s.account));
  const enabledCount = state.sources.filter(s => s.enabled).length;

  const addAgent = () => {
    setAgentNote("Add agents in Freddai › Settings. Scout lists them here as soon as they exist.");
    void run(() => openApp("freddai"));
  };
  const saveDraft = (draft: SourceDraft) => run(() => actions.sourceSave({
    id: uuid(), account: draft.account, kind: draft.kind, label: draft.label, detail: draft.detail,
    access: draft.access, enabled: true, status: "not_connected",
  }));

  const addConnection = (c: DetectedConnection, accountId: string) => {
    if (!accounts.some(a => a.id === accountId)) return;
    void run(() => actions.sourceSave({
      id: uuid(), account: accountId, kind: connectionKind(c), label: c.label, detail: connectionDetail(c),
      access: c.found_via.includes("freddai_google_account") ? "direct" : "computer_use", enabled: true, status: "not_connected",
    }));
  };

  const connectorBlock = (account: Account) => {
    const title = providerName(account.provider);
    if (accountConnectors.error) return null;
    if (accountConnectors.loading) return <ChipSkeleton />;
    const entry = accountConnectors.byAccount?.get(account.id);
    const list = (entry?.connectors ?? []).filter(isLifeSourceConnector);
    return <>
      {entry?.warning && <p className="st-detected__warnings st-agent__warning" role="alert">Couldn’t fully check this account: {entry.warning}</p>}
      {list.length > 0
        ? <ConnectorChips connectors={list} agent={title}
            enabledFor={c => findDetectedSource(state.sources, account.id, c)?.enabled ?? c.status === "connected"}
            onToggle={c => toggleConnector(account.id, c)} />
        : !entry?.warning && <p className="st-muted st-agent__none">No connectors found for this account</p>}
    </>;
  };

  const card = (account: Account | null, sources: Source[]) => {
    const id = account?.id ?? "orphans";
    const title = account ? providerName(account.provider) : "Unknown agent";
    const detectedCount = account ? state.sources.filter(s => s.account === account.id && s.enabled).length : sources.length;
    return <section key={id} className={cx("st-agent", account && !isUsed(account.id) && "is-unused")} aria-label={account ? `${title} · ${account.name}` : title}>
      <header className="st-agent__head">
        <Avatar name={title} color={account?.color} size={34} />
        <div className="st-agent__name">
          <div className="st-agent__title">{title}{account && <Pill>{account.name}</Pill>}</div>
          <div className="st-muted">{account
            ? (detectedCount ? `${detectedCount} source${detectedCount === 1 ? "" : "s"} in use` : "No sources in use")
            : "These sources point at an agent that is no longer in Freddai."}</div>
        </div>
        {account && <label className="st-use">
          <input type="checkbox" checked={isUsed(account.id)} onChange={e => {
            writeUse(account.id, e.target.checked);
            setUse(u => ({ ...u, [account.id]: e.target.checked }));
          }} /> Use
        </label>}
      </header>
      {account && connectorBlock(account)}
      {sources.length > 0 && <ul className="st-sources">
        {sources.map(s => <SourceRow key={s.id} source={s} removeAlways={variant === "onboarding"}
          onToggle={() => void run(() => actions.sourceSave({ ...s, enabled: !s.enabled }))}
          onAccess={access => void run(() => actions.sourceSave({ ...s, access }))}
          onRemove={() => void run(() => actions.sourceDelete(s.id))} />)}
      </ul>}
      {account && <button type="button" className="st-link" onClick={() => setDialog({ account: account.id })}>
        Add a source to {title} · {account.name}
      </button>}
    </section>;
  };

  return <div className="st-agents">
    <div className="st-toolbar">
      <div className="st-toolbar__pills">
        <Pill>{accounts.length} agent{accounts.length === 1 ? "" : "s"}</Pill>
        <Pill>{enabledCount} source{enabledCount === 1 ? "" : "s"}</Pill>
        {detected.found && detected.found.length > 0 && <Pill icon={<Terminal size={12} />} title={detected.found.map(i => `${providerName(i.provider)}: ${i.path}`).join("\n")}>Found on this computer</Pill>}
        {detected.error && <Pill variant="danger" title={detected.error}>Could not check this computer</Pill>}
      </div>
      <div className="st-toolbar__actions">
        {variant === "onboarding" && <GhostButton icon={<Sparkles size={14} />} onClick={() => setDialog({ page: true })}>Custom source</GhostButton>}
        <GhostButton icon={<Plus size={14} />} onClick={addAgent}>Add an agent</GhostButton>
      </div>
    </div>
    {agentNote && <p className="st-note" role="status">{agentNote}</p>}
    <InlineError error={error} onDismiss={clearError} />
    {accountConnectors.error && <div className="st-detected__warnings" role="alert"><p>Could not check your agents’ connections: {accountConnectors.error}</p></div>}
    <FreddaiStatusNote db={db} className="st-note" />
    {db && accounts.length === 0 && <p className="st-note">No agents in Freddai yet. Add one in Freddai › Settings, then come back.</p>}
    <div className="st-agent-grid">
      {accounts.map(a => card(a, sourcesFor(a.id)))}
      {orphans.length > 0 && card(null, orphans)}
    </div>
    <DetectedConnections detection={connections} sources={state.sources} accounts={accounts} onAdd={addConnection} />
    <button type="button" className="st-link st-link--page" onClick={() => setDialog({})}>Add a source manually</button>
    {dialog && <AddSourceDialog accounts={accounts} initialAccount={dialog.account} page={dialog.page}
      onClose={() => setDialog(null)} onSave={saveDraft} />}
  </div>;
}
