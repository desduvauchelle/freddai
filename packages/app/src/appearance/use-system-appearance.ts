import { useLayoutEffect, useState } from 'react';
import { observeAppearance, type Appearance } from './system';
import './appearance.css';

export function useSystemAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.freddaiAppearance;
    const wasDark = root.classList.contains('dark');
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (value: Appearance) => {
      root.dataset.freddaiAppearance = value;
      root.classList.toggle('dark', value === 'dark');
      setAppearance(value);
    };
    const stop = observeAppearance(media, apply);
    // Recheck after the device returns from sleep or the app returns to foreground.
    const resume = () => apply(media.matches ? 'dark' : 'light');
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      stop();
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
      if (previous) root.dataset.freddaiAppearance = previous;
      else delete root.dataset.freddaiAppearance;
      root.classList.toggle('dark', wasDark);
    };
  }, []);
  return appearance;
}
