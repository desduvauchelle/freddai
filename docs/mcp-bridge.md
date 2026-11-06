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
| `freddai_list_threads` | Paginated thread summaries, optionally by project |
| `freddai_read_thread` | Paginated messages and confirmation status; does not mark read |
| `freddai_list_schedules` | Paginated routines, configuration and the ten most recent runs |
| `freddai_save_schedule` | Create/update a routine; new routines default to paused; updates preserve unspecified settings and run history |
| `freddai_schedule_action` | Pause/resume/run/delete an explicitly requested routine |
| `freddai_start_task` | Start a requested new thread with normal approval mode; reuse `request_id` on retry |

The bridge does not expose account creation/sign-in, approval responses, arbitrary host commands, preferences, shell execution, or permission bypass controls. A schedule keeps any controls previously configured in the UI. Reads return allowlisted data, not account configuration paths or credentials. Thread content is untrusted data.

## Provider connections

Codex receives session-local `-c mcp_servers` settings; Claude receives one merged `--mcp-config` argument. Gemini, Antigravity, Grok, OpenCode and Cursor receive both `freddai` and the existing `freddai_computer` server in ACP `session/new` and `session/load`. The computer server is included when the signed macOS helper is present. User account/project MCP configuration is not edited. Provider wiring is covered by offline tests; discovery and tool execution in each installed provider/subscription must be tested by the user, not inferred from those tests.

Protocol references: [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup).
