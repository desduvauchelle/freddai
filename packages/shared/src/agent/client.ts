import { invoke } from "@tauri-apps/api/core";
import type { LaunchOptions } from "./types";

/** Starts a new thread (or resumes `existing`) and resolves with the session id. */
export async function launchThread(input: { project: string; account?: string | null; prompt: string; existing?: string | null; options?: LaunchOptions }): Promise<string> {
  const result = await invoke<unknown>("launch", {
    project: input.project,
    account: input.account ?? null,
    prompt: input.prompt,
    existing: input.existing ?? null,
    options: input.options ?? null,
  });
  if (typeof result === "string") return result;
  const id = (result as { id?: unknown; session?: unknown } | null);
  const session = id?.id ?? id?.session;
  if (typeof session !== "string") throw new Error(`launch returned no session id: ${JSON.stringify(result)}`);
  return session;
}

export function queueMessage(session: string, prompt: string, options: LaunchOptions = {}): Promise<unknown> {
  return invoke("queue_message", { session, prompt, options: { request_id: crypto.randomUUID(), ...options } });
}

export function respond(session: string, requestId: string, allow: boolean, answers: unknown = {}): Promise<unknown> {
  return invoke("respond", { session, requestId, allow, answers });
}

export function stop(session: string): Promise<unknown> {
  return invoke("stop", { session });
}
