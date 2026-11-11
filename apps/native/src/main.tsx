import { SatelliteApp } from "./SatelliteApp";
import { RoleOnboarding } from "./RoleOnboarding";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { DesktopApp } from "@freddai/app/desktop";
import { RecordingPill } from "@freddai/app/bug-walk-pill";
import { MobileApp } from "@freddai/app/mobile";
import { nativeCompanionClient } from "@freddai/app/mobile-client";
import "@freddai/ui/styles.css";

function LocalEntry({ onboarding }: { onboarding: boolean }) {
  const [choosing, setChoosing] = useState(onboarding);
  return choosing ? <RoleOnboarding onLocal={() => setChoosing(false)} /> : <DesktopApp />;
}

// Native platform owns routing; window size never unmounts active desktop work.
async function boot() {
  // The bug walk recording pill is its own always-on-top window that loads this same page.
  if (new URLSearchParams(window.location.search).get("bug-walk-pill") === "1") {
    createRoot(document.getElementById("root")!).render(<RecordingPill />);
    return;
  }
  const platform = isTauri() ? await invoke<string>("platform") : "browser";
  const satellite = isTauri() && await invoke<boolean>("satellite_mode").catch(() => false);
  const onboarding = platform === "macos" && !satellite && await invoke<boolean>("satellite_onboarding_needed");
  const preview = new URLSearchParams(window.location.search).get("companion") === "1";
  createRoot(document.getElementById("root")!).render(<StrictMode>{satellite ? <SatelliteApp /> : (platform === "ios" || platform === "android")
    ? <MobileApp client={nativeCompanionClient} />
    : preview ? <MobileApp /> : <LocalEntry onboarding={onboarding} />}</StrictMode>);
}
void boot().catch(error => {
  const root = document.getElementById("root");
  if (root) root.textContent = `Freddai could not start: ${String(error)}`;
});
