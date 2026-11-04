export type Appearance = 'light' | 'dark';
type AppearanceMedia = Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;

// Keep the listener independent of React so subscription and cleanup are testable.
export function observeAppearance(media: AppearanceMedia, apply: (value: Appearance) => void) {
  const update = () => apply(media.matches ? 'dark' : 'light');
  update();
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}
