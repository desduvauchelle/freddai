import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { DesktopApp } from "@freddai/app/desktop";
import { MobileApp } from "@freddai/app/mobile";
import { nativeCompanionClient } from "@freddai/app/mobile-client";
import "@freddai/ui/styles.css";

// Native platform owns routing; window size never unmounts active desktop work.
async function boot() {
  const platform = isTauri() ? await invoke<string>("platform") : "browser";
  const preview = new URLSearchParams(window.location.search).get("companion") === "1";
  createRoot(document.getElementById("root")!).render(<StrictMode>{platform === "ios"
    ? <MobileApp client={nativeCompanionClient} />
    : preview ? <MobileApp /> : <DesktopApp />}</StrictMode>);
}
void boot().catch(error => {
  const root = document.getElementById("root");
  if (root) root.textContent = `Freddai could not start: ${String(error)}`;
});
