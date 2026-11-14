import { invoke } from "@tauri-apps/api/core";
import { Sparkles } from "lucide-react";
import { ThreadTranscript } from "@freddai/app/conversation/ThreadTranscript";
import { Permission } from "@freddai/app/desktop/AgentRequest";
import type { Database } from "@freddai/shared/agent/types";
import type { ScoutChat } from "./useScoutChat";
import "./chat.css";

/** ThreadTranscript wired exactly like DesktopApp (tool_text / generated_file / preview_file_url with `thread`),
 *  plus the approval card and a working pill. */
export function ScoutTranscript({ chat, db, density = "comfortable", agentName = "The agent" }: {
  chat: ScoutChat; db: Database | null; density?: "comfortable" | "compact"; agentName?: string;
}) {
  const thread = chat.thread;
  const id = thread?.id;
  const provider = (thread && db?.accounts.find(a => a.id === thread.account)?.provider) || "codex";
  return <ThreadTranscript
    density={density}
    messages={chat.messages}
    pending={chat.pending}
    tasks={thread?.tasks}
    active={chat.busy}
    readToolText={id ? (message, offset, hash) => invoke("tool_text", { thread: id, message, offset, hash }) : undefined}
    readGeneratedFile={id ? (href, offset, length) => invoke("generated_file", { thread: id, href, offset, length }) : undefined}
    resolveLocalPage={id ? href => invoke("preview_file_url", { thread: id, href }) : undefined}
  >
    {thread?.error && <p className="sc-chat-error" role="alert">{thread.error}</p>}
    {chat.approval && thread && <div className="sc-approval">
      <Permission
        key={`${thread.id}:${JSON.stringify(chat.approval.request_id ?? chat.approval.id)}`}
        pending={chat.approval}
        provider={provider}
        onReply={(allow, answers) => chat.approve(allow, answers)}
      />
    </div>}
    {chat.busy && !chat.approval && <p className="sc-working" role="status"><Sparkles size={12} aria-hidden /> {agentName} is on it</p>}
  </ThreadTranscript>;
}
