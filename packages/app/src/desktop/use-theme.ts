import { useLayoutEffect, useState } from "react";
import { isTheme, readTheme, THEME_STORAGE_KEY, type Theme } from "./themes";

import { useSystemAppearance } from "../appearance/use-system-appearance";

export function useTheme() {
  const appearance = useSystemAppearance();
  const [theme, setTheme] = useState<Theme>(() => {
    try { return readTheme(window.localStorage); } catch { return "freddai"; }
  });
  const [saved, setSaved] = useState(true);
  useLayoutEffect(() => {
    document.documentElement.dataset.freddaiTheme = theme;
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); setSaved(true); }
    catch { setSaved(false); }
    return () => { delete document.documentElement.dataset.freddaiTheme; };
  }, [theme]);
  useLayoutEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && (event.key === THEME_STORAGE_KEY || event.key === null)) {
        setTheme(isTheme(event.newValue) ? event.newValue : "freddai");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return { theme, setTheme, saved, appearance };
}
