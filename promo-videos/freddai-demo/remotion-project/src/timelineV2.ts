// Vibe Coding Film (v2) timeline. Times are film seconds. Original chapters are re-used through <Slice>,
// which maps "original film time" to "v2 time"; see scenesV2.tsx.
export const FPS2 = 30;
export const sec2 = (t: number) => Math.round(t * FPS2);

export const V = {
  hook: 0,
  title: 5.7,        // cut to logo + title
  talk: 10.2,        // Ch3 re-used from here (voice demo)
  sched: 18.5,       // schedules slice
  office: 23.6,
  accIntro: 31.3,
  accounts: 36.7,    // Ch2 re-used (window opens 37.1)
  rings: 42.0,       // second Ch2 slice (usage spotlight)
  swap: 45.0,        // NEW account-switch scene
  phone: 54.55,
  close: 63.8,
  end: 66.1,         // URL end card
  total: 69.6,
};
export const TOTAL2 = sec2(V.total);

export const VO2: { id: string; start: number; dur: number }[] = [
  { id: "01", start: 0.5, dur: 3.37 },
  { id: "02", start: 4.5, dur: 0.73 },
  { id: "03", start: 5.9, dur: 2.53 },
  { id: "04", start: 10.9, dur: 1.79 },
  { id: "05", start: 13.1, dur: 3.76 },
  { id: "06", start: 17.4, dur: 5.64 },
  { id: "07", start: 23.6, dur: 5.27 },
  { id: "08", start: 32.0, dur: 3.91 },
  { id: "09", start: 36.4, dur: 7.46 },
  { id: "10", start: 44.9, dur: 2.87 },
  { id: "11", start: 49.0, dur: 3.70 },
  { id: "12", start: 54.4, dur: 1.69 },
  { id: "13", start: 56.8, dur: 4.59 },
  { id: "14", start: 63.9, dur: 1.22 },
  { id: "15", start: 66.1, dur: 0.66 },
];

export type Sfx2 = { file: "tick" | "pop" | "chime" | "whoosh" | "thump" | "hit" | "boom" | "riser"; at: number; vol: number };
const W = 0.04;
export const SFX2: Sfx2[] = [
  { file: "pop", at: 3.1, vol: 0.45 },                        // limit banner
  { file: "whoosh", at: V.title - 0.05, vol: W }, { file: "thump", at: V.title, vol: 0.5 },
  { file: "hit", at: 7.4, vol: 0.6 },                         // "Vibe coding heaven" lands
  { file: "pop", at: 11.2, vol: 0.4 },                        // mic
  { file: "chime", at: 13.9, vol: 0.4 },                      // started
  { file: "whoosh", at: V.office - 0.05, vol: W }, { file: "thump", at: V.office, vol: 0.5 },
  { file: "pop", at: V.accIntro + 1.2, vol: 0.35 },
  { file: "pop", at: 42.5, vol: 0.4 },                        // usage rings
  { file: "pop", at: V.swap + 0.5, vol: 0.45 },               // limit in thread
  { file: "chime", at: V.swap + 2.4, vol: 0.55 },            // switched
  { file: "whoosh", at: V.phone - 0.05, vol: W }, { file: "thump", at: V.phone, vol: 0.5 },
  { file: "chime", at: 59.2, vol: 0.5 },                      // approve
  { file: "hit", at: 63.9, vol: 0.9 }, { file: "pop", at: V.end, vol: 0.45 },
];

export const musicVolume2 = (frame: number) => {
  const t = frame / FPS2;
  let v = 0.3;
  for (const l of VO2) {
    const a = l.start - 0.15, b = l.start + l.dur + 0.25;
    if (t >= a && t <= b) { const edge = Math.min(1, Math.min(t - a, b - t) / 0.25); v *= 1 - 0.5 * edge; }
  }
  if (t > V.total - 1.6) v *= Math.max(0, (V.total - t) / 1.6);
  return v;
};
