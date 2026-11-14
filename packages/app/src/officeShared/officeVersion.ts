import { useCallback, useSyncExternalStore } from "react";

export type OfficeVersion = "v1" | "v7";
export const DEFAULT_OFFICE_VERSION: OfficeVersion = "v7";
export const OFFICE_VERSION_KEY = "freddai.office.version.v1";
export const OFFICE_VERSION_EVENT = "freddai:office-version";
export const OFFICE_VERSIONS: { id: OfficeVersion; label: string; hint: string }[] = [
  { id: "v1", label: "Classic", hint: "Classic: a room per project (SVG)" },
  { id: "v7", label: "Campus", hint: "Campus: soft-shaded 3/4 town, a building per project" },
];

export function readOfficeVersion(): OfficeVersion {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_OFFICE_VERSION;
    const v = localStorage.getItem(OFFICE_VERSION_KEY);
    return OFFICE_VERSIONS.some(o => o.id === v) ? (v as OfficeVersion) : DEFAULT_OFFICE_VERSION;
  } catch { return DEFAULT_OFFICE_VERSION; }
}

export function writeOfficeVersion(v: OfficeVersion) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(OFFICE_VERSION_KEY, v); }
  catch (e) { console.warn("office.version.persist-failed", e); }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OFFICE_VERSION_EVENT, { detail: v }));
}

function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === OFFICE_VERSION_KEY) cb(); };
  window.addEventListener(OFFICE_VERSION_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(OFFICE_VERSION_EVENT, cb); window.removeEventListener("storage", onStorage); };
}

/** Persisted office version; every component in the window flips together. */
export function useOfficeVersion(): [OfficeVersion, (v: OfficeVersion) => void] {
  const version = useSyncExternalStore(subscribe, readOfficeVersion, () => DEFAULT_OFFICE_VERSION);
  const set = useCallback((v: OfficeVersion) => writeOfficeVersion(v), []);
  return [version, set];
}
