import { useCallback, useSyncExternalStore } from "react";

export type CharacterStyle = "blob" | "bot" | "sprout" | "wisp";
export type CharacterColorMode = "project" | "pastel" | "vivid";
export const DEFAULT_CHARACTER_STYLE: CharacterStyle = "blob";
export const DEFAULT_CHARACTER_COLOR: CharacterColorMode = "project";
export const CHARACTER_STYLE_KEY = "freddai.office.characters.style.v1";
export const CHARACTER_COLOR_KEY = "freddai.office.characters.color.v1";
export const CHARACTER_STYLE_EVENT = "freddai:office-character-style";
export const CHARACTER_COLOR_EVENT = "freddai:office-character-color";
export const CHARACTER_STYLES: { id: CharacterStyle; label: string; hint: string }[] = [
  { id: "blob", label: "Blob", hint: "Blob: a soft pebble with one big eye" },
  { id: "bot", label: "Bot", hint: "Bot: a tidy little robot with a visor eye" },
  { id: "sprout", label: "Sprout", hint: "Sprout: a leafy pear with two bright eyes" },
  { id: "wisp", label: "Wisp", hint: "Wisp: a hovering flame-ghost with a swishy tail" },
];
export const CHARACTER_COLORS: { id: CharacterColorMode; label: string; hint: string }[] = [
  { id: "project", label: "Project", hint: "Project: each character wears its project color" },
  { id: "pastel", label: "Pastel", hint: "Pastel: soft colors, with a small project-colored accent" },
  { id: "vivid", label: "Vivid", hint: "Vivid: bold colors, with a small project-colored accent" },
];

export function readCharacterStyle(): CharacterStyle {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_CHARACTER_STYLE;
    const v = localStorage.getItem(CHARACTER_STYLE_KEY);
    return CHARACTER_STYLES.some(o => o.id === v) ? (v as CharacterStyle) : DEFAULT_CHARACTER_STYLE;
  } catch { return DEFAULT_CHARACTER_STYLE; }
}
export function readCharacterColorMode(): CharacterColorMode {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_CHARACTER_COLOR;
    const v = localStorage.getItem(CHARACTER_COLOR_KEY);
    return CHARACTER_COLORS.some(o => o.id === v) ? (v as CharacterColorMode) : DEFAULT_CHARACTER_COLOR;
  } catch { return DEFAULT_CHARACTER_COLOR; }
}

function write(key: string, event: string, value: string) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, value); }
  catch (e) { console.warn("office.characters.persist-failed", e); }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(event, { detail: value }));
}
export const writeCharacterStyle = (v: CharacterStyle) => write(CHARACTER_STYLE_KEY, CHARACTER_STYLE_EVENT, v);
export const writeCharacterColorMode = (v: CharacterColorMode) => write(CHARACTER_COLOR_KEY, CHARACTER_COLOR_EVENT, v);

function subscribeTo(key: string, event: string) {
  return (cb: () => void) => {
    if (typeof window === "undefined") return () => {};
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === key) cb(); };
    window.addEventListener(event, cb);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener(event, cb); window.removeEventListener("storage", onStorage); };
  };
}
const subscribeStyle = subscribeTo(CHARACTER_STYLE_KEY, CHARACTER_STYLE_EVENT);
const subscribeColor = subscribeTo(CHARACTER_COLOR_KEY, CHARACTER_COLOR_EVENT);

/** Persisted Campus character settings; every component in the window flips together. */
export function useCharacterSettings() {
  const style = useSyncExternalStore(subscribeStyle, readCharacterStyle, () => DEFAULT_CHARACTER_STYLE);
  const color = useSyncExternalStore(subscribeColor, readCharacterColorMode, () => DEFAULT_CHARACTER_COLOR);
  const setStyle = useCallback((v: CharacterStyle) => writeCharacterStyle(v), []);
  const setColor = useCallback((v: CharacterColorMode) => writeCharacterColorMode(v), []);
  return { style, color, setStyle, setColor };
}
