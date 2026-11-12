import { useEffect, useState } from 'react';

const read = (query: string) => typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? true : window.matchMedia(query).matches;

/** Live `matchMedia` result. Defaults to true where matchMedia is unavailable (jsdom), so the wide layout is the baseline. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query), update = () => setMatches(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}
