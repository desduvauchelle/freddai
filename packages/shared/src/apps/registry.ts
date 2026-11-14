import { invoke } from "@tauri-apps/api/core";

export type AppId = "freddai" | "scout" | "tucky";
export type AppDescriptor = { id: AppId; name: string; tagline: string; accent: string; status: "ready" | "soon" };

export const apps: AppDescriptor[] = [
  { id: "freddai", name: "Freddai", tagline: "Agent threads and projects", accent: "#f0582c", status: "ready" },
  { id: "scout", name: "Scout", tagline: "Your projects, items and sources in one board", accent: "#7c5cff", status: "ready" },
  { id: "tucky", name: "Tucky", tagline: "Coming soon", accent: "#2fb344", status: "soon" },
];

/** Opens (or focuses) another app's window. Rejects loudly; callers must surface the error. */
export async function openApp(id: AppId): Promise<void> {
  const app = apps.find(a => a.id === id);
  if (!app) throw new Error(`Unknown app: ${id}`);
  if (app.status === "soon") throw new Error(`${app.name} is not available yet`);
  if (id === "freddai") await invoke("focus_main_window");
  else await invoke("open_app_window", { id });
}

export function currentAppId(): AppId {
  const value = new URLSearchParams(location.search).get("app");
  return apps.some(a => a.id === value) ? (value as AppId) : "freddai";
}
