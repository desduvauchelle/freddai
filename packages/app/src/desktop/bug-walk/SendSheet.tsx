import { useEffect, useMemo, useState } from "react";
import { Button } from "@freddai/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@freddai/ui/components/dialog";
import { AgentControls } from "../AgentControls";
import { defaultSelection, type AgentSelection } from "../agent-selection";
import { PermissionSelect, effectivePermissionMode } from "../PermissionSelect";
import { agentDisplayName, resolveAccount, type Database, type PermissionMode } from "../types";
import { voice, useVoice, type VoiceController } from "../voice";
import { bugWalk, formatClock, type BugWalk, type BugWalkSendOpts, type BugWalkSplit, type BugWalkStore } from "./bugWalk";
import "./bug-walk.css";

export type SendSheetProps = {
  walk: BugWalk;
  db: Pick<Database, "accounts" | "projects" | "sessions" | "preferences">;
  native?: boolean;
  defaultPermission?: PermissionMode;
  /** False while another dialog (Voice settings) is on screen. */
  open?: boolean;
  onOpenVoiceSettings?: () => void;
  store?: BugWalkStore;
  voiceController?: VoiceController;
};

/** Pure: the options `bug_walk_send` receives for the sheet's current choices. */
export function buildSendOpts(input: { project: string; account: string; provider?: string; selection: AgentSelection; permission: PermissionMode; replyTo?: string; split?: BugWalkSplit }): BugWalkSendOpts {
  const tunable = input.provider === "codex" || input.provider === "claude";
  return {
    project: input.project, account: input.account,
    model: input.selection.model.trim() || null,
    effort: tunable && input.selection.effort !== "default" ? input.selection.effort : null,
    permission_mode: effectivePermissionMode(input.provider, input.permission),
    split: input.replyTo ? "single" : input.split ?? "single",
    ...(input.replyTo ? { reply_to_thread: input.replyTo } : {}),
  };
}

export function SendSheet({ walk, db, native = true, defaultPermission = "ask", open = true, onOpenVoiceSettings, store = bugWalk, voiceController = voice }: SendSheetProps) {
  const projects = useMemo(() => db.projects.filter(p => p.kind !== "commander"), [db.projects]);
  const thread = walk.origin?.thread ? db.sessions.find(s => s.id === walk.origin!.thread) : undefined;
  const replyTo = thread?.id;
  const accountFor = (project: string) => {
    const p = db.projects.find(x => x.id === project);
    const id = resolveAccount(db as Database, p);
    return db.accounts.some(a => a.id === id) ? id : db.accounts[0]?.id ?? "";
  };
  const [project, setProject] = useState(() => thread?.project ?? walk.origin?.project ?? projects[0]?.id ?? "");
  const [account, setAccount] = useState(() => thread?.account ?? accountFor(thread?.project ?? walk.origin?.project ?? projects[0]?.id ?? ""));
  const [selection, setSelection] = useState<AgentSelection>(() => ({ model: thread?.options?.model ?? "", effort: thread?.options?.effort ?? "default" }));
  const [permission, setPermission] = useState<PermissionMode>(thread?.options?.permission_mode ?? defaultPermission);
  const [split, setSplit] = useState<BugWalkSplit>("single");
  // Default from the remembered choice, unless the user already picked one while settings were loading.
  const [splitTouched, setSplitTouched] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.resolve(store.settings.get()).then(s => { if (live && s?.last_split) setSplit(cur => (splitTouched ? cur : s.last_split!)); }).catch(e => console.error("[bug-walk] settings load failed", e));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  const pickSplit = (next: BugWalkSplit) => { setSplitTouched(true); setSplit(next); };
  const acct = db.accounts.find(a => a.id === account);
  const { status } = useVoice(voiceController);
  useEffect(() => { void voiceController.refresh(); }, [voiceController]);
  const noModel = !!status && !status.models.some(m => m.installed);
  const ready = !!status && !noModel;
  const canSend = ready && !!project && !!account;
  const changeProject = (next: string) => { setProject(next); setAccount(accountFor(next)); setSelection(defaultSelection); };
  const send = () => void store.send(buildSendOpts({ project, account, provider: acct?.provider, selection, permission, replyTo, split }));
  const region = walk.region;
  return <Dialog open={open}>
    <DialogContent className="dark capture-panel bug-walk-sheet" showCloseButton={false} onEscapeKeyDown={e => e.preventDefault()} onInteractOutside={e => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Send bug walk</DialogTitle>
        <DialogDescription>{formatClock(walk.elapsed)} recorded{region ? ` · ${Math.round(region.width * region.scale)}×${Math.round(region.height * region.scale)} px region` : ""}{walk.orphan ? " · unfinished walk from an earlier session" : ""}{walk.notice ? ` · ${walk.notice}` : ""}</DialogDescription>
      </DialogHeader>
      <div className="bug-walk-fields">
        <label>Project
          <select aria-label="Project" value={project} disabled={!!replyTo} onChange={e => changeProject(e.target.value)}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>Agent
          <select aria-label="Agent" value={account} disabled={!!replyTo} onChange={e => { setAccount(e.target.value); setSelection(defaultSelection); }}>
            {db.accounts.map(a => <option key={a.id} value={a.id}>{agentDisplayName(a)}</option>)}
          </select>
        </label>
        {replyTo && <p className="bug-walk-hint">Replying in “{thread?.title}”. Project and agent follow that thread.</p>}
        <div className="bug-walk-row">
          <AgentControls account={acct} native={native} value={selection} onChange={setSelection} disabled={!acct} context="this bug walk" />
          {!replyTo && <div className="bug-walk-split" role="group" aria-label="Threads">
            <span className="bug-walk-split-label">Threads</span>
            {([["single", "One thread"], ["per_item", "One per bug"]] as const).map(([value, label]) =>
              <button key={value} type="button" aria-pressed={split === value} data-active={split === value} onClick={() => pickSplit(value)}>{label}</button>)}
          </div>}
          <PermissionSelect provider={acct?.provider} value={permission} onChange={setPermission} />
        </div>
      </div>
      {noModel && <p className="bug-walk-error" role="alert">Download a voice model first. <button type="button" className="bug-walk-link" onClick={onOpenVoiceSettings}>Open Voice settings</button></p>}
      {!status && <p className="bug-walk-hint" role="status">Checking voice model…</p>}
      <div className="bug-walk-actions">
        <Button type="button" variant="ghost" onClick={() => void store.cancel()}>Cancel</Button>
        <Button type="button" disabled={!canSend} onClick={send}>Send</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
