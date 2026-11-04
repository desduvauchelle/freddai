"use client";

import { useEffect, useState } from "react";
import { DARK_MEDIA_QUERY, THEME_STORAGE_KEY, isThemePreference, resolveTheme, type ThemePreference } from "@/lib/theme";
import type { Dictionary } from "@/i18n";

export function ThemePicker({ dict }: { dict: Dictionary }) {
  const [preference, setPreference] = useState<ThemePreference>("auto");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemePreference(saved)) setPreference(saved);
    } catch { /* System theme remains available when storage is blocked. */ }
  }, []);
  useEffect(() => {
    const media = matchMedia(DARK_MEDIA_QUERY);
    const apply = () => { document.documentElement.dataset.theme = resolveTheme(preference, media.matches); };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);
  return <label className="flex items-center gap-2 text-sm">
    {dict.theme}
    <select className="select select-bordered select-sm w-28" value={preference} onChange={(event) => {
      const next = event.target.value;
      if (!isThemePreference(next)) return;
      setPreference(next);
      try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* Keep the session choice. */ }
    }}>
      <option value="auto">{dict.system}</option><option value="light">{dict.light}</option><option value="dark">{dict.dark}</option>
    </select>
  </label>;
}
