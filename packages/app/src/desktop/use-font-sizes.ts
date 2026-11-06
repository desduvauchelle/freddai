import { useEffect, useLayoutEffect, useState } from "react";

export const FONT_SIZE_KEY = "freddai.font-sizes";
export const DEFAULT_FONT_SIZES = { threads: 12, chat: 14 };
export type FontSizes = typeof DEFAULT_FONT_SIZES;
export type FontRegion = keyof FontSizes;
export function normalizeFontSizes(value: unknown): FontSizes {
  const sizes = value as Partial<FontSizes> | null;
  const size = (region: FontRegion) => typeof sizes?.[region] === "number" && Number.isFinite(sizes[region])
    ? Math.min(24, Math.max(10, Math.round(sizes[region]!))) : DEFAULT_FONT_SIZES[region];
  return { threads: size("threads"), chat: size("chat") };
}
export function fontRegion(element: Element | null): FontRegion | undefined {
  if (element?.closest(".thread-browser")) return "threads";
  if (element?.closest(".chat-surface")) return "chat";
}
export function useFontSizes() {
  const [sizes, setSizes] = useState<FontSizes>(() => {
    try { return normalizeFontSizes(JSON.parse(localStorage.getItem(FONT_SIZE_KEY) || "null")); }
    catch { return { ...DEFAULT_FONT_SIZES }; }
  });
  const [saved, setSaved] = useState(true);
  useLayoutEffect(() => {
    for (const region of ["threads", "chat"] as const) document.documentElement.style.setProperty(`--${region}-font-size`, `${sizes[region]}px`);
    try { localStorage.setItem(FONT_SIZE_KEY, JSON.stringify(sizes)); setSaved(true); } catch { setSaved(false); }
    return () => { for (const region of ["threads", "chat"]) document.documentElement.style.removeProperty(`--${region}-font-size`); };
  }, [sizes]);
  useEffect(() => {
    let pointer: { x: number; y: number } | undefined;
    const move = (event: MouseEvent) => { pointer = { x: event.clientX, y: event.clientY }; };
    const leave = () => { pointer = undefined; };
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || !["+", "=", "-", "0"].includes(event.key)) return;
      const region = (pointer && fontRegion(document.elementFromPoint(pointer.x, pointer.y))) || fontRegion(document.activeElement);
      if (!region) return;
      event.preventDefault();
      setSizes(previous => normalizeFontSizes({ ...previous, [region]: event.key === "0" ? DEFAULT_FONT_SIZES[region] : previous[region] + (event.key === "-" ? -1 : 1) }));
    };
    const sync = (event: StorageEvent) => {
      if (event.key !== FONT_SIZE_KEY && event.key !== null) return;
      try { setSizes(normalizeFontSizes(JSON.parse(event.newValue || "null"))); } catch { /* Ignore malformed external preferences. */ }
    };
    document.addEventListener("mousemove", move);
    document.documentElement.addEventListener("mouseleave", leave);
    window.addEventListener("blur", leave);
    window.addEventListener("keydown", key);
    window.addEventListener("storage", sync);
    return () => {
      document.removeEventListener("mousemove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
      window.removeEventListener("blur", leave);
      window.removeEventListener("keydown", key);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return { sizes, saved, setSize: (region: FontRegion, value: number) => setSizes(previous => normalizeFontSizes({ ...previous, [region]: value })) };
}
