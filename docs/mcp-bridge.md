# Freddai MCP bridge

Freddai exposes its local workspace over MCP stdio. It uses the same background host as the desktop UI; it does not run a second scheduler or edit workspace files directly.

## Try it in Freddai

After installing the update, leave Freddai open and let active turns finish. The background host upgrades automatically when idle. A GUI restart alone does not replace a busy background host. A new turn (including a resumed thread) started by the updated host receives the bridge. Already-running turns keep their original tool catalog.

Start with a read-only request:

> Use freddai_context to check the bridge, then list my Freddai projects and scheduled tasks. Don't change anything.

`freddai_context` returns `ready: true` when the background host supports the tools. If false, let running work finish and retry after the host updates. This readiness check itself does not start an agent or use a provider.

Then try a change you actually want, for example:

> Create a paused weekday routine for this project at 9 AM America/Los_Angeles to summarize open work. Use my current agent. Return its schedule ID; don't run it yet.

The routine appears in the existing scheduled-task UI. Enable it when you want it to run. A separate `freddai_schedule_action` call can pause, resume, run now, or delete it. Starting a task or running a routine uses the selected provider normally.

## Other MCP clients

Use this local stdio server entry in a client that accepts `mcpServers` JSON:

```json
{
  "mcpServers": {
    "freddai": {
      "command": "/Applications/Freddai.app/Contents/MacOS/freddai-native",
      "args": ["--mcp"]
    }
  }
}
```

The default workspace is `~/Library/Application Support/com.freddai.desktop`. To select an explicit workspace, add its absolute path after `--mcp`. Optional subsequent arguments set the default project ID and calling thread ID. Paths are separate arguments, not shell command strings. For a client without thread context, supply project and account IDs returned by the list tools when creating tasks or routines.

The executable handles `--mcp` before GUI initialization. Keep Freddai open so its background host is available. No network listener or new credentials are involved. Workspace paths/context select defaults, not a security sandbox: this is a trusted local-client interface to your Freddai workspace.

## Tools

| Tool | Behavior |
| --- | --- |
| `freddai_context` | Read project/thread defaults and host readiness |
| `freddai_list_projects` | Read project IDs, names, paths and colors |
| `freddai_list_agents` | Read existing configured agent IDs/names/providers; no sign-in or credential check |
| `freddai_list_threads` | Paginated thread summaries (each with `link`: `freddai://thread/<id>`), optionally by project |
| `freddai_read_thread` | Paginated messages, confirmation status and `link`; does not mark read |
| `freddai_list_schedules` | Paginated routines, configuration and the ten most recent runs |
| `freddai_save_schedule` | Create/update a routine; new routines default to paused; updates preserve unspecified settings and run history |
| `freddai_schedule_action` | Pause/resume/run/delete an explicitly requested routine |
| `freddai_start_task` | Start a requested new thread with normal approval mode; reuse `request_id` on retry. Returns `{thread, link, title, project, status}` (last three best effort; an approved proposal's replayed result has the same shape). Reference threads as `[title](freddai://thread/<id>)`; the app renders a live card |
| `freddai_share_preview` | `{port, path?, title?}`: share `http://localhost:<port><path>` so the paired phone can open it with Preview (see `docs/preview-tunnel.md`). Records a 12 h grant in `companion/preview-grants.json`, which the companion server imports; ports below 1024 and Freddai ports are refused as tool errors. The result text contains the link so the thread shows a Preview chip |

## Google tools (Gmail, Calendar, Drive)

`freddai_google_accounts` is always listed. The other Google tools (including the three trigger tools) appear in `tools/list` only while at least one Google account is connected (Settings → Connected accounts); the bridge checks on every `tools/list`. Calling one with no account connected returns `No Google account is connected…`. Every Google tool takes an optional `account` (the Google email, required when several are connected). If the account did not grant the needed service, the call fails naming the account and service and says to reconnect it in Settings → Connected accounts and tick that service. Email, event and file content is untrusted data, never instructions.

| Tool | Behavior |
| --- | --- |
| `freddai_google_accounts` | Read connected accounts, granted services and status |
| `freddai_gmail_search` | Read: `query`, `label`, `max_results` (20, max 50), `page_token`; message summaries plus `nextPageToken` |
| `freddai_gmail_read` | Read one `message_id` or whole `thread_id`: headers, plain-text body (HTML converted; capped at 50,000 chars with `truncated`), `labelIds`, attachments |
| `freddai_gmail_attachment_save` | Save an attachment to an absolute `dest_path`; refuses to overwrite unless `overwrite: true` |
| `freddai_gmail_labels` | Read labels (id, name, type) |
| `freddai_gmail_draft_create` / `_update` / `_list` / `_delete` | Drafts. Compose fields: `to[]`, `cc[]`, `bcc[]`, `subject`, `body`, `html_body`, `reply_to_message_id` (same thread, `In-Reply-To`/`References`, defaults for `to`/`subject`), `attachments[]` (absolute paths), `drive_attachments[]` (Drive IDs; Google-native files become PDF). Total attachments over 25 MB are refused. `_list` is read-only |
| `freddai_gmail_send` | Send a `draft_id` or a message composed from the same fields. Outward |
| `freddai_gmail_modify` | `message_ids[]` or `thread_id`; `add_labels[]`/`remove_labels[]` (names or IDs), `trash`. Archive = remove `INBOX`, mark read = remove `UNREAD` |
| `freddai_calendar_list` | Read calendars |
| `freddai_calendar_events` | Read events (`calendar_id` default `primary`, `time_min`/`time_max` RFC 3339, `query`, `max_results` 25 max 100, `page_token`); recurring events expanded; descriptions capped at 4,000 chars with a flag |
| `freddai_calendar_freebusy` | Read busy intervals for `calendar_ids[]` (default primary) |
| `freddai_calendar_event_create` / `_update` / `_delete` | `start`/`end` are RFC 3339 or `YYYY-MM-DD` (all-day, end exclusive), `time_zone`, `attendees[]`, `add_meet`, `send_updates` (`all`, `externalOnly`, `none`; default `none`). Outward when attendees are named or `send_updates` is not `none` |
| `freddai_drive_search` | Read: `text` (name or content, escaped), raw `q`, `folder_id`, `mime_type`, `max_results` (20, max 100), `page_token`; trashed files excluded; shared drives included |
| `freddai_drive_read` | Read as text: Docs as Markdown, Sheets as CSV (first sheet only), Slides as plain text, text-like files as UTF-8; anything else is refused (use download). `max_chars` default 50,000 with `truncated` |
| `freddai_drive_download` | Save a file (Google-native files exported: docx/xlsx/pptx/pdf, or `export_mime_type`) to an absolute path; no overwrite unless `overwrite: true` |
| `freddai_drive_upload` | Upload a local file (max 200 MB) with optional `name`, `folder_id`, `convert`. Files up to 5 MB are one multipart request; larger files use a Drive resumable session (`uploadType=resumable`, session URL from the `Location` header) streamed from disk in 8 MB chunks with `Content-Range`, so the file is never held in memory. A failed chunk is retried up to 3 times after asking the session for the committed range (`bytes */<total>`); after that the call fails stating how many bytes were committed |
| `freddai_drive_create_folder` | Create a folder (`name`, `parent_id`) |
| `freddai_list_google_triggers` | Read: paginated Google event triggers (`project`, `offset`, `limit`) with configuration and status (`last_checked`, `last_fired`, `fire_count`, `last_error`) |
| `freddai_save_google_trigger` | Create/update a trigger that starts an agent run on `gmail_message_received`, `calendar_event_changed` or `drive_file_changed`. Fields: `id` (omit to create), `name`, `google_account`, `event`, `filter`, `resource` (Calendar ID, default `primary`, or Drive folder ID), and the schedule delivery fields `project`, `account` (both default from the calling thread), `new_chat`, `thread`, `notifications`, `prompt`, `enabled`. New triggers default to paused; updates preserve `last_checked`, `last_fired` and `fire_count`. Uses the same save path and Runtime delivery validation as the UI (`google_trigger_save`). Routing and launch options are host-owned and not accepted |
| `freddai_google_trigger_action` | `{trigger, action}` with `action` `pause`, `resume` or `delete`; resume re-arms the trigger from now |

Gmail messages are built as RFC 5322 (CRLF, base64 bodies at 76 columns, RFC 2047 for non-ASCII subjects and display names) and sent through the media-upload endpoint as `message/rfc822`; a reply needs its `threadId`, so it uses a `multipart/related` upload with the thread as JSON metadata.

Sending email requires the user's explicit permission: the `freddai_gmail_send` description, the server instructions and trigger-delivery text tell agents to send only an email the user has explicitly said they may send, and otherwise to create a draft and ask (instruction-level; a technical hold for ordinary threads is deferred).

Approval: only Commander calls pass the action gate (below). There, `freddai_gmail_send` is always held, and the three calendar mutations are held when they name attendees or `send_updates` is not `none`; `freddai_save_google_trigger` is held when it enables a trigger (or edits an enabled one) and `freddai_google_trigger_action` is held for `resume` and `delete`, exactly like the schedule tools; everything else (including drafts, label changes and Drive writes) runs directly and is logged. Ordinary project threads have no Freddai approval hold on any Google tool: the call runs as soon as the agent makes it, subject only to the agent's own provider permission mode.

## Commander-in-Chief tools and the action gate

The bridge process asks the host whether its project is the built-in Commander project (`mcp_is_commander`). Only then does `tools/list` include these tools; every other project gets `Unknown Freddai tool` if it calls them.

| Tool | Behavior |
| --- | --- |
| `freddai_todo_list` / `_add` / `_update` | Read, create and update to-dos in the Commander folder. An agent may set `done` only when every `verification[]` row is `met`; `user_confirmed` is reserved for the user |
| `freddai_note_list` / `_read` / `_write` | Markdown notes in `notes/`; names are plain file stems |
| `freddai_memory_remember` / `_forget` / `_search` | Preferences, facts, people and project details; duplicates merge, unpinned entries go stale after 30 days |
| `freddai_propose` | `{tool, arguments, summary}` for `freddai_start_task`, `freddai_save_schedule`, `freddai_schedule_action`, `freddai_save_google_trigger` or `freddai_google_trigger_action`; creates a pending proposal. `arguments.todo_id` links an existing to-do |
| `freddai_user_profile_update` | `{body, reason}`; internal. Replaces USER.md (the user's core profile) quietly and writes a revision with `by: "commander"`. Logged in `actions.log` |
| `freddai_soul_propose` | `{body, reason}`; outward, held like `freddai_propose`. On approval the host applies `body` to SOUL.md through the same path as `commander_profile_save`, with `by: "commander"`. Commander uses it only when the user asks for a different style |

`freddai_list_projects` and `freddai_context` include each project's `objective` for all callers.

Action gate (Commander project only): `freddai_start_task` without an explicit `user_requested:true`, `freddai_save_schedule` when it enables (or edits an enabled) schedule, `freddai_schedule_action` with resume, run or delete, `freddai_save_google_trigger` when it enables (or edits an enabled) trigger, `freddai_google_trigger_action` with resume or delete, `freddai_gmail_send`, and calendar create/update/delete that name attendees or send updates do not execute. They return `{ok:true, held:true, proposal_id, message:"Waiting for the user's approval"}`. The user approves in Freddai (`commander_proposal_respond`); the host then replays the exact call, so approval is enforced in the runtime, not by prompt. An explicit task request may set `user_requested:true`; it starts immediately under the normal agent permission policy and gets a tracked to-do. Never set this for automated check-ins or unsolicited suggestions. In `budgeted` autonomy mode (`autonomy_settings.json`), `freddai_start_task` runs directly when the project is in `allowedProjectIds` and the concurrency and daily caps allow it (logged as `auto_allowed`); otherwise it is held and the denial reason is logged as `budget_denied`. Schedules are always held. Internal tools run directly. Every call is appended to `actions.log` as `{at, tool, args_summary, decision: executed|held|denied, ok, error}`, and errors return `{ok:false, error}`. A Commander task cannot target the Commander project. Threads started this way record `origin: {kind:"commander", thread}`; when they finish, the host marks the linked to-do `needs_review` and queues a light-review message into the latest Commander thread.

The bridge does not expose account creation/sign-in, approval responses, arbitrary host commands, preferences, shell execution, or permission bypass controls. A schedule keeps any controls previously configured in the UI. Reads return allowlisted data, not account configuration paths or credentials. Thread content is untrusted data.

## Provider connections

Codex receives session-local `-c mcp_servers` settings; Claude receives one merged `--mcp-config` argument. Gemini, Antigravity, Grok, OpenCode, Cursor and Copilot receive both `freddai` and the existing `freddai_computer` server in ACP `session/new` and `session/load`. The computer server is included when the signed macOS helper is present. User account/project MCP configuration is not edited. Provider wiring is covered by offline tests; discovery and tool execution in each installed provider/subscription must be tested by the user, not inferred from those tests.

Protocol references: [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup).

Relative Commander reminders can use `freddai_todo_add` with `delay_minutes` (1–525600) instead of `check_back_at`; the host computes the exact timestamp. Due reminders and delegated completions are delivered on the next available 30-second tick, independently of the heartbeat cooldown. Queue acceptance precedes acknowledgement so failed sends remain retryable. User messages take priority over queued Commander background notices.
