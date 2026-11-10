import type { GoogleAccount, GoogleCommand, GoogleConfig, GoogleConnectStatus, GoogleOperation, GoogleTrigger } from "../google";

/** In-memory stand-in for the host's google_* operations. Used by tests and the screenshot preview only. */
export const mockAccounts: GoogleAccount[] = [
  { email: "alex@example.com", name: "Alex Morgan", services: ["gmail", "calendar", "drive"], status: "ok", lastError: null, connectedAt: "2026-10-02T09:15:00Z" },
  { email: "alex@studio.example", name: "Alex Morgan (Studio)", services: ["gmail", "calendar"], status: "needs_reauth", lastError: null, connectedAt: "2026-09-18T14:40:00Z" },
];
const delivery = { project: "p1", account: "claude-personal", routing: "fixed", new_chat: true, thread: null, notifications: "important" as const, options: { worktree: false, permission_mode: "ask" as const } };
export const mockTriggers: GoogleTrigger[] = [
  { ...delivery, id: "t1", name: "Triage billing emails", google_account: "alex@example.com", event: "gmail_message_received", filter: "from:billing@example.com has:attachment", resource: null, enabled: true, prompt: "Summarize the invoice and add it to the expenses sheet.", created_at: 1791021600000, last_checked: 1794303000000, last_fired: 1794240720000, fire_count: 14, last_error: null },
  { ...delivery, id: "t2", name: "Prep for meetings", google_account: "alex@example.com", event: "calendar_event_changed", filter: "Standup", resource: "primary", enabled: true, prompt: "Collect context for the changed event.", created_at: 1791108000000, last_checked: 1794303000000, last_fired: null, fire_count: 0, last_error: "Google returned 403: Calendar API has not been used in project 123456 before or it is disabled." },
  { ...delivery, id: "t3", name: "Watch the contracts folder", google_account: "alex@example.com", event: "drive_file_changed", filter: null, resource: "1AbCdEfGhIjKlMnOp", enabled: false, prompt: "Review the changed contract and list what moved.", created_at: 1791194400000, last_checked: null, last_fired: 1793520000000, fire_count: 3, last_error: null },
];

export type MockHostOptions = {
  accounts?: GoogleAccount[]; triggers?: GoogleTrigger[]; config?: GoogleConfig;
  /** Operations that reject with this exact text. */
  fail?: Partial<Record<GoogleOperation, string>>;
  /** Successive google_connect_status answers; the last one repeats. */
  statuses?: GoogleConnectStatus[];
  /** Added to the account list when a status of "connected" is reported. */
  connects?: GoogleAccount;
  /** false answers google_capability like a background host that predates the Google operations. */
  hostSupportsGoogle?: boolean;
};
export function createMockGoogleHost(options: MockHostOptions = {}) {
  let accounts = [...(options.accounts ?? [])], triggers = [...(options.triggers ?? [])];
  let config: GoogleConfig = options.config ?? { clientId: null, hasClientSecret: false, secretStorage: "keychain" };
  let polls = 0;
  const calls: { operation: GoogleOperation; input: Record<string, unknown> }[] = [];
  const command: GoogleCommand = async (operation, input) => {
    calls.push({ operation, input });
    const failure = options.fail?.[operation];
    if (failure) throw failure;
    switch (operation) {
      case "google_capability": return { supported: options.hostSupportsGoogle !== false };
      case "google_config_get": return config;
      case "google_config_set": config = { ...config, clientId: input.clientId as string, hasClientSecret: config.hasClientSecret || !!input.clientSecret }; return config;
      case "google_connect_start": return { authUrl: "https://accounts.google.com/o/oauth2/v2/auth?mock=1", flowId: "flow-1" };
      case "google_connect_status": {
        const list = options.statuses ?? [{ state: "pending" }];
        const status = list[Math.min(polls++, list.length - 1)];
        if (status.state === "connected" && options.connects && !accounts.some(a => a.email === options.connects!.email)) accounts = [...accounts, options.connects];
        return status;
      }
      case "google_accounts": return { accounts };
      case "google_disconnect": accounts = accounts.filter(a => a.email !== input.email); return { ok: true };
      case "google_triggers": return { triggers };
      case "google_trigger_save": {
        const saved = { ...(input.trigger as GoogleTrigger) };
        if (!saved.id) saved.id = `t${triggers.length + 10}`;
        triggers = triggers.some(t => t.id === saved.id) ? triggers.map(t => t.id === saved.id ? saved : t) : [...triggers, saved];
        return { trigger: saved };
      }
      case "google_trigger_delete": triggers = triggers.filter(t => t.id !== input.id); return { ok: true };
    }
  };
  return { command, calls };
}

export const mockDeliveryDb = {
  projects: [{ id: "p1", name: "Freddai" }, { id: "p2", name: "Lucy Web" }],
  accounts: [{ id: "claude-personal", name: "Personal", provider: "claude" }, { id: "codex-work", name: "Work", provider: "codex" }],
};
