import type { DeliveryFields } from "./desktop/DeliveryControls";

export type GoogleService = "gmail" | "calendar" | "drive";
export const GOOGLE_SERVICES: GoogleService[] = ["gmail", "calendar", "drive"];
export const SERVICE_LABEL: Record<GoogleService, string> = { gmail: "Gmail", calendar: "Calendar", drive: "Drive" };

export type GoogleConfig = { clientId: string | null; hasClientSecret: boolean; secretStorage: "keychain" | "file" };
export type GoogleAccountStatus = "ok" | "needs_reauth" | "error";
export type GoogleAccount = { email: string; name: string; services: GoogleService[]; status: GoogleAccountStatus; lastError: string | null; connectedAt: string };
export type GoogleConnectStart = { authUrl: string; flowId: string };
export type GoogleConnectStatus = { state: "pending" | "connected" | "failed" | "expired"; email?: string; error?: string };

export type GoogleTriggerEvent = "gmail_message_received" | "calendar_event_changed" | "drive_file_changed";
/** Delivery fields are identical to Schedule's; the rest mirrors the host's snake_case serialization. */
export type GoogleTrigger = DeliveryFields & {
  id: string;
  name: string;
  google_account: string;
  event: GoogleTriggerEvent;
  filter: string | null;
  resource: string | null;
  enabled: boolean;
  /** Epoch milliseconds, as the host serializes them. */
  created_at?: number | null;
  last_checked?: number | null;
  last_fired?: number | null;
  fire_count?: number;
  last_error?: string | null;
};

export type GoogleOperation =
  | "google_config_get" | "google_config_set" | "google_connect_start" | "google_connect_status"
  | "google_capability" | "google_accounts" | "google_disconnect" | "google_triggers" | "google_trigger_save" | "google_trigger_delete";
/** Same shape on desktop (Tauri commands) and mobile (paired-Mac composer). Rejections carry the host's text. */
export type GoogleCommand = (operation: GoogleOperation, input: Record<string, unknown>) => Promise<unknown>;

export const EVENT_LABEL: Record<GoogleTriggerEvent, string> = {
  gmail_message_received: "A new email arrives",
  calendar_event_changed: "A calendar event changes",
  drive_file_changed: "A Drive file changes",
};
export const EVENT_SERVICE: Record<GoogleTriggerEvent, GoogleService> = {
  gmail_message_received: "gmail",
  calendar_event_changed: "calendar",
  drive_file_changed: "drive",
};
export const EVENT_FIELDS: Record<GoogleTriggerEvent, { filterLabel: string; filterPlaceholder: string; filterHelp: string; resourceLabel?: string; resourcePlaceholder?: string; resourceHelp?: string }> = {
  gmail_message_received: {
    filterLabel: "Gmail search",
    filterPlaceholder: "from:billing@example.com has:attachment",
    filterHelp: "Only emails matching this Gmail search start a run. Leave blank to match every new email.",
  },
  calendar_event_changed: {
    filterLabel: "Matching text",
    filterPlaceholder: "Standup",
    filterHelp: "Matched against the event title, organizer and attendees. Leave blank to match every change.",
    resourceLabel: "Calendar ID",
    resourcePlaceholder: "primary",
    resourceHelp: "Leave blank to watch your primary calendar.",
  },
  drive_file_changed: {
    filterLabel: "File name contains",
    filterPlaceholder: "Invoice",
    filterHelp: "Matched against the file name. Leave blank to match every file.",
    resourceLabel: "Folder ID",
    resourcePlaceholder: "Any folder",
    resourceHelp: "Paste the ID from the folder’s URL to watch only that folder. Leave blank to watch all of Drive.",
  },
};

/** Host errors are shown as the host wrote them: Tauri rejects with strings, the companion with Errors. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

const WHEN_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

/** Trigger times are epoch milliseconds (the host's unit); null, 0 and unusable values show as nothing. */
export function formatWhen(epochMs: number | null | undefined): string | null {
  if (epochMs == null || !Number.isFinite(epochMs) || epochMs <= 0) return null;
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(undefined, WHEN_FORMAT);
}

/** Account `connectedAt` is an RFC 3339 string. */
export function formatIsoWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, WHEN_FORMAT);
}

export type GoogleHostSupport = { supported: boolean };
/** Shown instead of the Google controls when the running background host predates the google_* operations. */
export const GOOGLE_HOST_OUTDATED_NOTICE = "The background host is still running the previous version and does not support Google accounts yet. Save your draft, quit Freddai (⌘Q), then reopen it from Applications.";
export const GOOGLE_HOST_OUTDATED_NOTICE_MOBILE = "The background host on your Mac is still running the previous version and does not support Google accounts yet. On your Mac, save your draft, quit Freddai (⌘Q), then reopen it from Applications.";
