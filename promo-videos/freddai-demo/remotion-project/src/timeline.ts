export const FPS = 30;
export const sec = (t: number) => Math.round(t * FPS);

// Chapter boundaries in seconds. `total` is the film length. Fill from the approved story card.
export const T = { ch1: 0, ch2: 12.0, ch3: 30.0, close: 50.0, total: 58.0 };
export const TOTAL_FRAMES = sec(T.total);

// Cue points (absolute seconds) that scenes animate against. Name them after what happens on screen.
export const CUE = { hook: 1.0, turn: T.ch2, logo: T.close + 2.0, cta: T.close + 4.0 };

// Narration lines: start (s) and measured duration (s). Paste the durations printed by scripts/normalize-vo.sh.
export const VO: { id: string; start: number; dur: number }[] = [
  // { id: "01", start: 0.8, dur: 3.24 },
];

export type Sfx = { file: "tick" | "pop" | "chime" | "whoosh" | "thump" | "hit" | "boom" | "riser"; at: number; vol: number };
const W = 0.04; // whooshes are loud: keep them almost subliminal
export const SFX: Sfx[] = [
  { file: "whoosh", at: T.ch2 - 0.05, vol: W }, { file: "thump", at: T.ch2, vol: 0.5 },
  { file: "hit", at: CUE.logo, vol: 0.9 }, { file: "pop", at: CUE.cta, vol: 0.45 },
];

// Music bed level with narration ducking (-50% under each line, 0.25 s edges) and a fade-out at the end.
export const musicVolume = (frame: number) => {
  const t = frame / FPS;
  let v = 0.3;
  for (const l of VO) {
    const a = l.start - 0.15, b = l.start + l.dur + 0.25;
    if (t >= a && t <= b) { const edge = Math.min(1, Math.min(t - a, b - t) / 0.25); v *= 1 - 0.5 * edge; }
  }
  if (t > T.total - 1.6) v *= Math.max(0, (T.total - t) / 1.6);
  return v;
};
