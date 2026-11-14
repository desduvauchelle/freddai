import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { launchThread } from "@freddai/shared/agent/client";
import { agentDisplayName, resolveAccount, type Database, type Project as FreddaiProject } from "@freddai/shared/agent/types";
import type { ChatContext, ChatPanelProps } from "../contracts";
import type { ScoutState } from "../api";
import { FreddaiLinkNotice } from "./FreddaiLinkNotice";
import { ScoutComposer } from "./ScoutComposer";
import { ScoutTranscript } from "./ScoutTranscript";
import { useScoutChat } from "./useScoutChat";
import "./chat.css";

export const CHAT_ACCOUNT_KEY = "scout.chat.account";
export const chatSessionKey = (projectId: string | null) => `scout.chat.session.${projectId ?? "home"}`;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* storage unavailable: the choice just isn't remembered */ }
}

/** The Scout project the page is about, if any. */
export function contextProjectId(state: ScoutState, context: ChatContext): string | null {
  if (context.projectId) return context.projectId;
  if (context.view.kind === "project") return context.view.projectId;
  const itemId = context.itemId ?? (context.view.kind === "item" ? context.view.itemId : undefined);
  return (itemId && state.items.find(i => i.id === itemId)?.project) || null;
}

/** `Scout context · <view kind>[ · project <name>][ · item <title>]` (Figma dev note: the chat always knows the page). */
export function contextLine(state: ScoutState, context: ChatContext): string {
  const projectId = contextProjectId(state, context);
  const project = projectId ? state.projects.find(p => p.id === projectId) : undefined;
  const itemId = context.itemId ?? (context.view.kind === "item" ? context.view.itemId : undefined);
  const item = itemId ? state.items.find(i => i.id === itemId) : undefined;
  return ["Scout context", context.view.kind, ...(project ? [`project ${project.name}`] : []), ...(item ? [`item ${item.title}`] : [])].join(" · ");
}

/** Which Freddai project the side chat launches in: the linked project, else Commander, else none. */
export function chatFreddaiProject(db: Database | null, state: ScoutState, projectId: string | null): FreddaiProject | undefined {
  if (!db) return undefined;
  const linked = projectId ? state.projects.find(p => p.id === projectId)?.freddai_project : null;
  if (linked) return db.projects.find(p => p.id === linked);
  return db.projects.find(p => p.kind === "commander");
}

/** 360px right rail (Figma 51:630): one Freddai session per page context. */
export function ChatPanel({ state, db, actions, context, onClose }: ChatPanelProps) {
  const projectId = contextProjectId(state, context);
  const scoutProject = projectId ? state.projects.find(p => p.id === projectId) : undefined;
  const sessionKey = chatSessionKey(projectId);
  const [session, setSession] = useState<string | null>(() => read(sessionKey));
  useEffect(() => { setSession(read(sessionKey)); }, [sessionKey]);
  const [account, setAccount] = useState<string>(() => read(CHAT_ACCOUNT_KEY) ?? "");
  const target = chatFreddaiProject(db, state, projectId);
  const linkedMissing = !!scoutProject?.freddai_project && !!db && !target;

  const accountId = useMemo(() => {
    if (!db) return "";
    if (account && db.accounts.some(a => a.id === account)) return account;
    return target ? resolveAccount(db, target) : db.preferences.fallback || "";
  }, [account, db, target]);

  const launch = useCallback(async (prompt: string) => {
    if (!db) throw new Error("Freddai is not reachable, so the agent cannot start.");
    if (!target) throw new Error("Link this project to a Freddai project to chat.");
    return launchThread({ project: target.id, account: accountId || null, prompt });
  }, [db, target, accountId]);
  const onSessionCreated = useCallback((id: string) => { write(sessionKey, id); setSession(id); }, [sessionKey]);
  const line = contextLine(state, context);
  const format = useCallback((text: string) => `${line}\n\n${text}`, [line]);
  const chat = useScoutChat({ db, session, onSessionCreated, launch, format });

  const chips = ["What needs me?", ...(scoutProject ? ["Summarise this project"] : [])];
  const canChat = !!session || !!target;
  const agentShort = db?.accounts.find(a => a.id === (chat.thread?.account || accountId));

  return <aside className="sc-chat" aria-label="Chat">
    <header className="sc-chat__header">
      <select className="sc-chat__agent" aria-label="Agent" value={accountId} disabled={!db || !db.accounts.length}
        onChange={e => { setAccount(e.target.value); write(CHAT_ACCOUNT_KEY, e.target.value); }}>
        {!db?.accounts.length && <option value="">No agents</option>}
        {db?.accounts.map(a => <option key={a.id} value={a.id}>{agentDisplayName(a)}</option>)}
      </select>
      {session && chat.thread && chat.thread.account !== accountId && <span className="sc-muted" title="This conversation already runs on another agent; start a new chat to switch.">
        on {agentShort ? agentDisplayName(agentShort) : "another agent"}</span>}
      <span className="sc-chat__live sc-muted">Updates this page live</span>
      {session && <button type="button" className="sc-icon-btn sc-icon-btn--bare" aria-label="New chat" title="New chat" onClick={() => { write(sessionKey, null); setSession(null); chat.clearError(); }}><RotateCcw size={14} /></button>}
      <button type="button" className="sc-icon-btn sc-icon-btn--bare" aria-label="Close chat" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="sc-chat__body">
      {session && db && !chat.thread && <p className="sc-notice" role="alert">This chat's Freddai thread was not found. Start a new chat.</p>}
      <ScoutTranscript chat={chat} db={db} density="compact" agentName={agentShort ? agentDisplayName(agentShort).split(" · ")[0] : "The agent"} />
    </div>
    {chat.error && <p className="sc-chat-error" role="alert">{chat.error}</p>}
    <div className="sc-chat__footer">
      {canChat
        ? <>
            {!chat.messages.length && <div className="sc-chat__chips">
              {chips.map(chip => <button key={chip} type="button" className="sc-chip" disabled={!db || chat.busy} onClick={() => void chat.send(chip)}>{chip}</button>)}
            </div>}
            <ScoutComposer placeholder="Type, drop a file, or hold to talk" disabled={!db} onSend={chat.send} busy={chat.busy} onStop={() => void chat.stop()} />
          </>
        : scoutProject
          ? <FreddaiLinkNotice db={db} message={linkedMissing ? "The linked Freddai project no longer exists. Link another one to chat." : "Link this project to a Freddai project to chat"}
              onLink={id => actions.projectSave({ ...scoutProject, freddai_project: id })} />
          : <FreddaiLinkNotice db={db} message="Freddai has no Commander project to chat in. Open a project linked to Freddai to chat about it." />}
    </div>
  </aside>;
}
