import { agentDisplayName } from "./types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@freddai/ui/components/button";
import { Input } from "@freddai/ui/components/input";
import { Textarea } from "@freddai/ui/components/textarea";
import { Switch } from "@freddai/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@freddai/ui/components/tabs";
import type { Account, Project } from "./types";

type Pair = { key: string; value: string };
export type McpServer = { name: string; scope: "user" | "project"; type: "stdio" | "http" | "sse"; command: string; args: string[]; env: Record<string, string>; url: string; headers: Record<string, string>; enabled: boolean | null; source: string };
type McpList = { servers: McpServer[]; scopes: { id: string; label: string; path: string }[]; notes: string[] };
type Hook = { scope: string; event: string; matcher: string; type: string; command: string; timeout: number | null; editable: boolean; locator: Record<string, unknown> };
type HookList = { hooks: Hook[]; events: string[]; scopes: { id: string; path: string }[] };
type Plugin = { id: string; name: string; marketplace: string; installed: boolean; enabled: boolean; version: string | null };
type PluginList = { plugins: Plugin[]; marketplaces: { name: string; source: { source?: string; repo?: string; url?: string } | null }[]; commandPrefix: string; settingsPath: string };
type MemoryFile = { id: string; label: string; path: string; exists: boolean };

const SECRET_KEY = /key|token|secret|pass|auth|credential|bearer|cookie|session/i;
const SECRET_VALUE = /^(sk-|ghp_|gho_|github_pat_|xox[a-z]-|eyJ|AKIA|Bearer\s)|^[A-Za-z0-9_\-+/=]{32,}$/;
/** Values that look like credentials are masked in lists and password-typed in forms. */
export const looksSecret = (key: string, value: string) => SECRET_KEY.test(key) || SECRET_VALUE.test(value);
export const maskValue = (key: string, value: string) => looksSecret(key, value) ? "••••••••" : value;

const toPairs = (m: Record<string, string>): Pair[] => Object.entries(m).map(([key, value]) => ({ key, value }));
const fromPairs = (p: Pair[]) => Object.fromEntries(p.filter(x => x.key.trim()).map(x => [x.key.trim(), x.value]));
const call = <T,>(request: Record<string, unknown>) => invoke<T>("agent_config", { request });
const fail = (e: unknown) => String(e instanceof Error ? e.message : e);

export function AgentConfigSettings({ native, accounts, projects }: { native: boolean; accounts: Account[]; projects: Project[] }) {
  const eligible = useMemo(() => accounts.filter(a => a.provider === "claude" || a.provider === "codex"), [accounts]);
  const [accountId, setAccountId] = useState(eligible[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  useEffect(() => { if (!eligible.some(a => a.id === accountId)) setAccountId(eligible[0]?.id ?? ""); }, [eligible, accountId]);
  const account = eligible.find(a => a.id === accountId);
  const project = projects.find(p => p.id === projectId);
  const base = useMemo(() => account ? { provider: account.provider, accountId: account.id, configHome: account.config_home ?? null, project: project?.path ?? null } : null, [account, project]);
  if (!native) return <p>Agent configuration needs the Mac app.</p>;
  if (!account || !base) return <p>Connect Claude Code or Codex in Accounts first. Other agents do not have editable configuration here.</p>;
  const claude = account.provider === "claude";
  return <section className="space-y-4">
    <p className="capture-help">These are your agent's own configuration files. Changes apply to new agent sessions, not ones already running. Freddai keeps a timestamped backup of every file before changing it.</p>
    <div className="flex flex-wrap gap-4">
      <label className="grid gap-1 text-sm">Account profile
        <select aria-label="Account profile" className="rounded-md border bg-background px-2 py-1" value={accountId} onChange={e => setAccountId(e.target.value)}>
          {eligible.map(a => <option key={a.id} value={a.id}>{agentDisplayName(a)}</option>)}
        </select></label>
      <label className="grid gap-1 text-sm">Project
        <select aria-label="Config project" className="rounded-md border bg-background px-2 py-1" value={projectId} onChange={e => setProjectId(e.target.value)}>
          <option value="">User level only</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
    </div>
    <Tabs defaultValue="mcp">
      <TabsList><TabsTrigger value="mcp">MCP servers</TabsTrigger>{claude && <TabsTrigger value="hooks">Hooks</TabsTrigger>}{claude && <TabsTrigger value="plugins">Plugins</TabsTrigger>}<TabsTrigger value="memory">Memory</TabsTrigger></TabsList>
      <TabsContent value="mcp"><McpPanel base={base} claude={claude} /></TabsContent>
      {claude && <TabsContent value="hooks"><HooksPanel base={base} /></TabsContent>}
      {claude && <TabsContent value="plugins"><PluginsPanel base={base} /></TabsContent>}
      <TabsContent value="memory"><MemoryPanel base={base} /></TabsContent>
    </Tabs>
  </section>;
}

type Base = Record<string, unknown>;
function useLoaded<T>(base: Base, op: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const key = JSON.stringify(base);
  useEffect(() => { let live = true; setData(null); setError(""); call<T>({ ...base, op }).then(d => { if (live) setData(d); }).catch(e => { if (live) setError(fail(e)); }); return () => { live = false; }; }, [key, op]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, setData, error, setError };
}
const Err = ({ error }: { error: string }) => error ? <p role="alert" className="text-sm text-destructive whitespace-pre-wrap">{error}</p> : null;

function PairEditor({ label, pairs, onChange }: { label: string; pairs: Pair[]; onChange: (p: Pair[]) => void }) {
  return <fieldset className="grid gap-1"><legend className="text-sm">{label}</legend>
    {pairs.map((p, i) => <div key={i} className="flex gap-2">
      <Input aria-label={`${label} name ${i + 1}`} value={p.key} onChange={e => onChange(pairs.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} />
      <Input aria-label={`${label} value ${i + 1}`} type={looksSecret(p.key, p.value) ? "password" : "text"} autoComplete="off" value={p.value} onChange={e => onChange(pairs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
      <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onChange(pairs.filter((_, j) => j !== i))}>Remove</Button>
    </div>)}
    <div><Button type="button" variant="outline" size="sm" onClick={() => onChange([...pairs, { key: "", value: "" }])}>Add {label.toLowerCase()}</Button></div>
  </fieldset>;
}

export function McpForm({ initial, scopes, claude, onSave, onCancel, busy }: { initial: McpServer | null; scopes: { id: string; label: string }[]; claude: boolean; busy: boolean; onSave: (server: Record<string, unknown>, scope: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<string>(initial?.type ?? "stdio");
  const [scope, setScope] = useState(initial?.scope ?? "user");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [args, setArgs] = useState((initial?.args ?? []).join("\n"));
  const [env, setEnv] = useState<Pair[]>(toPairs(initial?.env ?? {}));
  const [url, setUrl] = useState(initial?.url ?? "");
  const [headers, setHeaders] = useState<Pair[]>(toPairs(initial?.headers ?? {}));
  const stdio = type === "stdio";
  return <form className="grid gap-3 rounded-md border p-3" aria-label={initial ? `Edit ${initial.name}` : "Add MCP server"} onSubmit={e => {
    e.preventDefault();
    onSave({ name, type, ...(stdio ? { command, args: args.split("\n").map(a => a.trim()).filter(Boolean), env: fromPairs(env) } : { url, headers: fromPairs(headers) }) }, scope);
  }}>
    <label className="grid gap-1 text-sm">Name<Input aria-label="Server name" value={name} onChange={e => setName(e.target.value)} /></label>
    <div className="flex gap-4">
      <label className="grid gap-1 text-sm">Type<select aria-label="Server type" className="rounded-md border bg-background px-2 py-1" value={type} onChange={e => setType(e.target.value)}><option value="stdio">stdio (local command)</option><option value="http">http</option>{claude && <option value="sse">sse</option>}</select></label>
      {claude && !initial && scopes.length > 1 && <label className="grid gap-1 text-sm">Scope<select aria-label="Server scope" className="rounded-md border bg-background px-2 py-1" value={scope} onChange={e => setScope(e.target.value as "user" | "project")}>{scopes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>}
    </div>
    {stdio ? <>
      <label className="grid gap-1 text-sm">Command<Input aria-label="Command" className="font-mono" value={command} onChange={e => setCommand(e.target.value)} /></label>
      <label className="grid gap-1 text-sm">Arguments (one per line)<Textarea aria-label="Arguments" className="font-mono" rows={3} value={args} onChange={e => setArgs(e.target.value)} /></label>
      <PairEditor label="Environment" pairs={env} onChange={setEnv} />
    </> : <>
      <label className="grid gap-1 text-sm">URL<Input aria-label="URL" className="font-mono" value={url} onChange={e => setUrl(e.target.value)} /></label>
      <PairEditor label="Headers" pairs={headers} onChange={setHeaders} />
    </>}
    <div className="flex gap-2"><Button disabled={busy}>Save server</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
  </form>;
}

function McpPanel({ base, claude }: { base: Base; claude: boolean }) {
  const { data, setData, error, setError } = useLoaded<McpList>(base, "mcp_list");
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (request: Record<string, unknown>, done = false) => {
    setBusy(true);
    try { setData(await call<McpList>({ ...base, ...request })); setError(""); if (done) setEditing(null); } catch (e) { setError(fail(e)); } finally { setBusy(false); }
  };
  return <div className="space-y-3 pt-3">
    <Err error={error} />
    {!data && !error && <p>Loading…</p>}
    {data && <>
      {data.notes.map(n => <p key={n} className="capture-help">{n}</p>)}
      <ul className="space-y-2">{data.servers.map(s => <li key={`${s.scope}:${s.name}`} className="rounded-md border p-3">
        <div className="flex items-center gap-2">
          <strong>{s.name}</strong><span className="text-xs text-muted-foreground">{s.type} · {s.scope === "project" ? "project" : "user"}</span>
          <span className="ml-auto flex items-center gap-2">
            {s.enabled !== null && <Switch aria-label={`Enable ${s.name}`} checked={s.enabled} disabled={busy} onCheckedChange={enabled => void run({ op: "mcp_set_enabled", scope: s.scope, name: s.name, enabled })} />}
            <Button variant="outline" size="sm" onClick={() => setEditing(s)}>Edit</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => { if (window.confirm(`Remove MCP server "${s.name}" from ${s.source}?`)) void run({ op: "mcp_delete", scope: s.scope, name: s.name }); }}>Remove</Button>
          </span>
        </div>
        <p className="font-mono text-xs break-all">{s.type === "stdio" ? [s.command, ...s.args.map(a => maskValue("arg", a))].join(" ") : s.url}</p>
        {[...Object.entries(s.env), ...Object.entries(s.headers)].map(([k, v]) => <p key={k} className="font-mono text-xs">{k}={maskValue(k, v)}</p>)}
      </li>)}</ul>
      {!data.servers.length && <p className="capture-help">No MCP servers configured in {data.scopes.map(s => s.path).join(" or ")}.</p>}
      {editing ? <McpForm key={editing === "new" ? "new" : editing.name} initial={editing === "new" ? null : editing} scopes={data.scopes} claude={claude} busy={busy} onCancel={() => setEditing(null)}
        onSave={(server, scope) => void run({ op: "mcp_save", scope, originalName: editing === "new" ? null : editing.name, server }, true)} />
        : <Button variant="outline" onClick={() => setEditing("new")}>Add MCP server</Button>}
    </>}
  </div>;
}

function HooksPanel({ base }: { base: Base }) {
  const { data, setData, error, setError } = useLoaded<HookList>(base, "hooks_list");
  const [form, setForm] = useState<{ scope: string; event: string; matcher: string; command: string; timeout: string; locator: Record<string, unknown> | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (request: Record<string, unknown>, close = false) => {
    setBusy(true);
    try { setData(await call<HookList>({ ...base, ...request })); setError(""); if (close) setForm(null); } catch (e) { setError(fail(e)); } finally { setBusy(false); }
  };
  const events = useMemo(() => [...new Set([...(data?.events ?? []), ...(data?.hooks.map(h => h.event) ?? [])])], [data]);
  const grouped = useMemo(() => events.map(ev => ({ ev, hooks: data?.hooks.filter(h => h.event === ev) ?? [] })).filter(g => g.hooks.length), [events, data]);
  return <div className="space-y-3 pt-3">
    <Err error={error} />
    {!data && !error && <p>Loading…</p>}
    {data && <>
      {grouped.map(g => <div key={g.ev}><h4 className="font-medium">{g.ev}</h4><ul className="space-y-2">{g.hooks.map(h => <li key={JSON.stringify(h.locator)} className="flex items-center gap-2 rounded-md border p-2">
        <span className="min-w-0 flex-1"><span className="text-xs text-muted-foreground">{h.scope} · matcher: {h.matcher || "all"}{h.timeout ? ` · ${h.timeout}s` : ""}{h.type !== "command" ? ` · ${h.type}` : ""}</span><br /><code className="text-xs break-all">{h.command}</code></span>
        {h.editable && <Button variant="outline" size="sm" onClick={() => setForm({ scope: h.scope, event: h.event, matcher: h.matcher, command: h.command, timeout: h.timeout ? String(h.timeout) : "", locator: h.locator })}>Edit</Button>}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { if (window.confirm("Delete this hook?")) void run({ op: "hooks_delete", locator: h.locator }); }}>Delete</Button>
      </li>)}</ul></div>)}
      {!grouped.length && <p className="capture-help">No hooks configured.</p>}
      {form ? <form className="grid gap-3 rounded-md border p-3" aria-label="Hook" onSubmit={e => { e.preventDefault(); void run({ op: "hooks_save", scope: form.scope, locator: form.locator, hook: { event: form.event, matcher: form.matcher, command: form.command, timeout: form.timeout.trim() ? Number(form.timeout) : null } }, true); }}>
        <div className="flex flex-wrap gap-4">
          <label className="grid gap-1 text-sm">Settings file<select aria-label="Hook scope" disabled={!!form.locator} className="rounded-md border bg-background px-2 py-1" value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })}>{data.scopes.map(s => <option key={s.id} value={s.id}>{s.id} ({s.path})</option>)}</select></label>
          <label className="grid gap-1 text-sm">Event<select aria-label="Hook event" className="rounded-md border bg-background px-2 py-1" value={form.event} onChange={e => setForm({ ...form, event: e.target.value })}><option value="">Choose…</option>{events.map(ev => <option key={ev}>{ev}</option>)}</select></label>
        </div>
        <label className="grid gap-1 text-sm">Matcher (tool name or regex; blank matches all)<Input aria-label="Hook matcher" className="font-mono" value={form.matcher} onChange={e => setForm({ ...form, matcher: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">Command<Input aria-label="Hook command" className="font-mono" value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} /></label>
        <label className="grid gap-1 text-sm">Timeout seconds (optional)<Input aria-label="Hook timeout" inputMode="numeric" value={form.timeout} onChange={e => setForm({ ...form, timeout: e.target.value })} /></label>
        <div className="flex gap-2"><Button disabled={busy}>Save hook</Button><Button type="button" variant="ghost" onClick={() => setForm(null)}>Cancel</Button></div>
      </form> : <Button variant="outline" onClick={() => setForm({ scope: "user", event: "PreToolUse", matcher: "", command: "", timeout: "", locator: null })}>Add hook</Button>}
    </>}
  </div>;
}

function PluginsPanel({ base }: { base: Base }) {
  const { data, setData, error, setError } = useLoaded<PluginList>(base, "plugins_list");
  const [busy, setBusy] = useState(false);
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); };
  return <div className="space-y-3 pt-3">
    <Err error={error} />
    {!data && !error && <p>Loading…</p>}
    {data && <>
      <ul className="space-y-2">{data.plugins.map(p => <li key={p.id} className="rounded-md border p-3">
        <div className="flex items-center gap-2"><strong>{p.name}</strong><span className="text-xs text-muted-foreground">{p.marketplace}{p.version ? ` · ${p.version}` : ""}{p.installed ? "" : " · not installed"}</span>
          <Switch className="ml-auto" aria-label={`Enable ${p.name}`} checked={p.enabled} disabled={busy} onCheckedChange={async enabled => { setBusy(true); try { setData(await call<PluginList>({ ...base, op: "plugins_set_enabled", plugin: p.id, enabled })); setError(""); } catch (e) { setError(fail(e)); } finally { setBusy(false); } }} /></div>
        {p.installed && <div className="mt-1 flex items-center gap-2"><code className="text-xs">{data.commandPrefix}claude plugin uninstall {p.id}</code><Button variant="ghost" size="sm" onClick={() => copy(`${data.commandPrefix}claude plugin uninstall ${p.id}`)}>Copy uninstall command</Button></div>}
      </li>)}</ul>
      {!data.plugins.length && <p className="capture-help">No plugins installed.</p>}
      <h4 className="font-medium">Marketplaces</h4>
      <ul>{data.marketplaces.map(m => <li key={m.name} className="text-sm">{m.name} <span className="text-xs text-muted-foreground">{m.source?.repo ?? m.source?.url ?? m.source?.source ?? ""}</span></li>)}</ul>
      <p className="capture-help">Freddai does not install or uninstall plugins itself. Run the install command in Terminal, for example <code>{data.commandPrefix}claude plugin install &lt;name&gt;@&lt;marketplace&gt;</code>, then enable it here. Enable state is stored in {data.settingsPath}.</p>
    </>}
  </div>;
}

function MemoryPanel({ base }: { base: Base }) {
  const { data, error: listError } = useLoaded<{ files: MemoryFile[] }>(base, "memory_list");
  const [id, setId] = useState("user");
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(base);
  const load = useCallback(() => { setText(null); setError(""); call<{ content: string }>({ ...base, op: "memory_read", memory: id }).then(r => { setText(r.content); setSaved(r.content); }).catch(e => setError(fail(e))); }, [key, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  useEffect(() => { if (data && !data.files.some(f => f.id === id)) setId("user"); }, [data, id]);
  const file = data?.files.find(f => f.id === id);
  return <div className="space-y-3 pt-3">
    <Err error={listError || error} />
    {data && <label className="grid gap-1 text-sm">File<select aria-label="Memory file" className="rounded-md border bg-background px-2 py-1" value={id} onChange={e => setId(e.target.value)}>{data.files.map(f => <option key={f.id} value={f.id}>{f.label}{f.exists ? "" : " (new)"}</option>)}</select></label>}
    {file && <p className="text-xs text-muted-foreground font-mono break-all">{file.path}</p>}
    {text !== null && <>
      <Textarea aria-label="Memory contents" className="font-mono text-xs" rows={18} value={text} onChange={e => setText(e.target.value)} />
      <div className="flex items-center gap-2"><Button disabled={busy || text === saved} onClick={async () => { setBusy(true); try { const r = await call<{ content: string }>({ ...base, op: "memory_write", memory: id, content: text }); setSaved(r.content); setError(""); } catch (e) { setError(fail(e)); } finally { setBusy(false); } }}>Save</Button>{text !== saved && <span className="text-xs text-muted-foreground">Unsaved changes</span>}</div>
    </>}
  </div>;
}
