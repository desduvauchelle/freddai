import { useEffect, useRef, useState } from "react";
import { CircleAlert, Copy, RotateCcw } from "lucide-react";
import { commanderApi, type CommanderProfileData, type ProfileFile, type ProfileRevision } from "./api";
import { MemoryTab, msg } from "./CommanderMemory";

export const PRESETS: { id: string; label: string; blurb: string; soul: string }[] = [
  { id: "friendly", label: "Friendly & brief", blurb: "Warm, short answers, proactive yes/no offers.",
    soul: "Friendly, warm and brief. Short answers, no filler, no long lists unless asked. Proactive: notice what would help the user next and offer it as a yes/no proposal. Plain language. Celebrate finished work in one line." },
  { id: "warm", label: "Warm & detailed", blurb: "Explains its reasoning and gives fuller context.",
    soul: "Warm, encouraging and thorough. Explain what you did and why, give useful context and options, and check in on how the user is doing. Stay in plain language and keep structure light. Proactively suggest next steps as yes/no proposals." },
  { id: "direct", label: "Direct & no-nonsense", blurb: "Bottom line first, no pleasantries.",
    soul: "Direct and no-nonsense. Lead with the answer or the decision needed. No pleasantries, no filler, no praise. Flag problems plainly. Only offer next steps when they matter." },
  { id: "playful", label: "Playful", blurb: "Light humor and personality, still useful.",
    soul: "Playful and upbeat, with light humor and personality, but never at the cost of clarity. Keep answers short. Celebrate wins with a bit of flair. Proactively offer next steps as yes/no proposals." },
];

const FILE_LABEL: Record<ProfileFile, string> = { soul: "Attitude", user: "About you" };
const when = (at: string) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? at : d.toLocaleString(); };

export function CommanderProfile({ onSaved, onDirtyChange }: { onSaved?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [profile, setProfile] = useState<CommanderProfileData | null>(null);
  const [name, setName] = useState(""), [soul, setSoul] = useState(""), [user, setUser] = useState("");
  const [soulReason, setSoulReason] = useState(""), [userReason, setUserReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState(""), [saved, setSaved] = useState("");
  const [restoring, setRestoring] = useState<ProfileRevision | null>(null), [copied, setCopied] = useState(false);
  const loaded = useRef(false);
  const setErr = (k: string, v: string) => setErrors(e => ({ ...e, [k]: v }));

  function adopt(p: CommanderProfileData, keep: Partial<Record<"name" | "soul" | "user", boolean>> = {}) {
    setProfile(p);
    if (!keep.name) setName(p.name);
    if (!keep.soul) setSoul(p.soul);
    if (!keep.user) setUser(p.user);
  }
  useEffect(() => {
    let alive = true;
    commanderApi.profile().then(p => { if (alive) { adopt(p); loaded.current = true; } }).catch(e => alive && setErr("load", `Couldn't load personality settings: ${msg(e)}`));
    return () => { alive = false; };
  }, []);

  const dirty = !!profile && (name !== profile.name || soul !== profile.soul || user !== profile.user);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  async function run(key: string, call: () => Promise<CommanderProfileData>, after: (p: CommanderProfileData) => void) {
    setBusy(key); setErr(key, ""); setSaved("");
    try { const p = await call(); after(p); setSaved(key); onSaved?.(); }
    catch (e) { setErr(key, `Couldn't ${key === "restore" ? "restore" : "save"}: ${msg(e)}`); }
    finally { setBusy(""); }
  }
  const saveName = () => run("name", () => commanderApi.profileSave({ name: name.trim() }), p => adopt(p, { soul: soul !== profile?.soul, user: user !== profile?.user }));
  const saveSoul = () => run("soul", () => commanderApi.profileSave(soulReason.trim() ? { soul, reason: soulReason.trim() } : { soul }), p => { adopt(p, { name: name !== profile?.name, user: user !== profile?.user }); setSoulReason(""); });
  const saveUser = () => run("user", () => commanderApi.profileSave(userReason.trim() ? { user, reason: userReason.trim() } : { user }), p => { adopt(p, { name: name !== profile?.name, soul: soul !== profile?.soul }); setUserReason(""); });
  const restore = (r: ProfileRevision) => run("restore", () => commanderApi.revisionRestore(r.file, r.at), p => { adopt(p); setRestoring(null); });

  async function copy() {
    try { await navigator.clipboard.writeText(profile?.prompt_preview ?? ""); setCopied(true); setErr("copy", ""); setTimeout(() => setCopied(false), 1500); }
    catch (e) { setErr("copy", `Couldn't copy: ${msg(e)}`); }
  }
  const Err = ({ k }: { k: string }) => errors[k] ? <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{errors[k]}</p> : null;
  const Saved = ({ k }: { k: string }) => saved === k ? <span role="status" className="commander-muted">Saved</span> : null;

  if (!profile) return <div className="commander-profile"><Err k="load" />{!errors.load && <p className="commander-empty">Loading…</p>}</div>;
  return <div className="commander-profile">
    {dirty && <p className="commander-muted" role="status">You have unsaved changes.</p>}

    <section aria-labelledby="cp-name">
      <h3 id="cp-name">Name</h3>
      <p className="commander-muted">What your assistant is called everywhere in Freddai.</p>
      <input type="text" aria-label="Assistant name" value={name} onChange={e => { setName(e.target.value); setSaved(""); }} />
      <div className="commander-card-actions">
        <button type="button" className="commander-btn" data-variant="yes" disabled={!!busy || !name.trim() || name.trim() === profile.name} onClick={() => void saveName()}>{busy === "name" ? "Saving…" : "Save name"}</button>
        <Saved k="name" />
      </div>
      <Err k="name" />
    </section>

    <section aria-labelledby="cp-attitude">
      <h3 id="cp-attitude">Attitude</h3>
      <div className="commander-presets" role="group" aria-label="Attitude presets">
        {PRESETS.map(p => <button key={p.id} type="button" className="commander-preset" aria-pressed={soul === p.soul} onClick={() => { setSoul(p.soul); setSaved(""); }}><strong>{p.label}</strong><small>{p.blurb}</small></button>)}
      </div>
      <textarea aria-label="Attitude (SOUL.md)" value={soul} spellCheck onChange={e => { setSoul(e.target.value); setSaved(""); }} />
      <input type="text" className="commander-reason" aria-label="Reason for change (optional)" placeholder="Reason for this change (optional)" value={soulReason} onChange={e => setSoulReason(e.target.value)} />
      <div className="commander-card-actions">
        <button type="button" className="commander-btn" data-variant="yes" disabled={!!busy || soul === profile.soul} onClick={() => void saveSoul()}>{busy === "soul" ? "Saving…" : "Save attitude"}</button>
        {soul !== profile.soul && <button type="button" className="commander-btn" data-variant="ghost" onClick={() => setSoul(profile.soul)}>Discard changes</button>}
        <Saved k="soul" />
      </div>
      <Err k="soul" />
    </section>

    <section aria-labelledby="cp-user">
      <h3 id="cp-user">About you</h3>
      <p className="commander-muted">Commander keeps this up to date quietly as it learns how you work. You can edit it too.</p>
      <textarea aria-label="About you (USER.md)" value={user} spellCheck onChange={e => { setUser(e.target.value); setSaved(""); }} />
      <input type="text" className="commander-reason" aria-label="Reason for change to About you (optional)" placeholder="Reason for this change (optional)" value={userReason} onChange={e => setUserReason(e.target.value)} />
      <div className="commander-card-actions">
        <button type="button" className="commander-btn" data-variant="yes" disabled={!!busy || user === profile.user} onClick={() => void saveUser()}>{busy === "user" ? "Saving…" : "Save about you"}</button>
        {user !== profile.user && <button type="button" className="commander-btn" data-variant="ghost" onClick={() => setUser(profile.user)}>Discard changes</button>}
        <Saved k="user" />
      </div>
      <Err k="user" />
    </section>

    <section aria-labelledby="cp-memories">
      <h3 id="cp-memories">Memories</h3>
      <MemoryTab />
    </section>

    <section aria-labelledby="cp-history">
      <h3 id="cp-history">History</h3>
      {!profile.revisions.length && <p className="commander-empty">No changes yet.</p>}
      <ul className="commander-revisions" aria-label="Revisions">
        {profile.revisions.map(r => <li key={`${r.file}-${r.at}`}>
          <strong>{FILE_LABEL[r.file]}</strong><span>{when(r.at)}</span>
          <span className="commander-chip" data-muted>{r.by === "user" ? "You" : "Commander"}</span>
          {r.reason && <span className="commander-muted">{r.reason}</span>}
          {restoring?.file === r.file && restoring.at === r.at
            ? <span className="commander-card-actions" role="group" aria-label="Confirm restore">
                <span>Restore {FILE_LABEL[r.file]} to this version?{dirty ? " Unsaved edits will be replaced." : ""}</span>
                <button type="button" className="commander-btn" data-variant="yes" disabled={!!busy} onClick={() => void restore(r)}>{busy === "restore" ? "Restoring…" : "Confirm restore"}</button>
                <button type="button" className="commander-btn" data-variant="ghost" onClick={() => setRestoring(null)}>Cancel</button>
              </span>
            : <button type="button" className="commander-btn" data-variant="ghost" aria-label={`Restore ${FILE_LABEL[r.file]} from ${when(r.at)}`} onClick={() => setRestoring(r)}><RotateCcw size={12} aria-hidden="true" />Restore</button>}
        </li>)}
      </ul>
      <Err k="restore" />
    </section>

    <details className="commander-dev">
      <summary>What Commander sees (developer)</summary>
      <pre aria-label="Prompt preview">{profile.prompt_preview}</pre>
      <button type="button" className="commander-btn" data-variant="ghost" onClick={() => void copy()}><Copy size={12} aria-hidden="true" />{copied ? "Copied" : "Copy"}</button>
      <Err k="copy" />
    </details>
  </div>;
}
