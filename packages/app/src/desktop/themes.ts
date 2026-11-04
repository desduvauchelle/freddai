export const THEME_STORAGE_KEY = "freddai.theme";
export const themes = [
  { id: "freddai", name: "Freddai", description: "The original Freddai palette", background: "#18191c", surface: "#25262b", primary: "#e1e1e7" },
  { id: "neutral", name: "Neutral", description: "Clean neutral grays", background: "#171717", surface: "#262626", primary: "#e5e5e5" },
  { id: "slate", name: "Slate", description: "Cool blue accents", background: "#0f172a", surface: "#1e293b", primary: "#93c5fd" },
  { id: "violet", name: "Violet", description: "Soft purple accents", background: "#1c1726", surface: "#30263f", primary: "#c4b5fd" },
  { id: "rose", name: "Rose", description: "Warm rose accents", background: "#24191d", surface: "#38272f", primary: "#fda4af" },
  { id: "green", name: "Green", description: "Fresh sage and green", background: "#14201c", surface: "#24352d", primary: "#86efac" },
] as const;
export type Theme = typeof themes[number]["id"];
export function isTheme(value: unknown): value is Theme {
  return themes.some(theme => theme.id === value);
}
export function readTheme(storage: Pick<Storage, "getItem">): Theme {
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : "freddai";
  } catch {
    return "freddai";
  }
}

export const lightThemes: Record<Theme, { background: string; surface: string; primary: string }> = {
  freddai: { background: "#fafafa", surface: "#f0f0f3", primary: "#393947" },
  neutral: { background: "#fafafa", surface: "#f0f0f3", primary: "#393947" },
  slate: { background: "#f5f7fb", surface: "#eaf0f8", primary: "#1e40af" },
  violet: { background: "#faf7fd", surface: "#f0eaf7", primary: "#6d28a0" },
  rose: { background: "#fdf7f8", surface: "#f8eaf0", primary: "#a32150" },
  green: { background: "#f5faf7", surface: "#e9f2ec", primary: "#166534" },
};
