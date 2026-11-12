export const FPS = 30;
export const sec = (t: number) => Math.round(t * FPS);

// Chapter boundaries in seconds (each sits just before its first narration line). `total` is the film length.
export const T = {
  ch1: 0,        // The juggle
  ch2: 15.9,     // One app, every account
  ch3: 33.6,     // Say it, let it run
  office: 50.9,  // The Office
  computer: 68.8, // Same hands for every agent (computer use)
  phone: 84.2,   // Your desk is optional
  close: 102.3,  // Close
  total: 115.0,
};
export const TOTAL_FRAMES = sec(T.total);

// Cue points (absolute seconds) that scenes animate against: one per on-screen beat in STORY-CARD.md v2.
// Cues marked ~ sit inside a narration line (offsets estimated from the spoken order); re-check against stills.
export const CUE = {
  // 1 The juggle
  limitBanner: 0.8,      // line 01: terminal + "usage limit reached"
  oldRoutine: 3.83,      // line 02: log out / log in / reopen / re-explain, tabs pile up
  again: 10.65,          // line 03: beat of silence, tab count
  mouse: 12.7,           // line 04: dormouse peeks in
  slogan1: 13.2,         // slogan "Switch agents. Not your whole workflow."
  // 2 One app, every account
  window: 16.3,          // line 05: Freddai window opens
  chipCodex: 17.6,       // ~ provider chips in spoken order
  chipClaude: 18.5,
  chipGemini: 20.0,
  chipGrok: 20.9,
  rings: 25.08,          // line 06: usage rings, percent left, resets
  ringAmber: 26.8,       // ~ one account amber
  pickAccount: 29.2,     // line 07: new thread, choose account, start
  // 3 Say it, let it run
  voice: 34.0,           // line 08: mic, waveform, text lands, start
  threadsGrouped: 38.79, // line 09: threads grouped by project, finished dim
  worktree: 42.1,        // ~ "Give one its own worktree": toggle + branch in git graph
  schedules: 46.47,      // line 10: schedule row, next-run label
  // 4 The Office
  office: 51.27,         // line 11: office view, rooms + scoreboards
  walk: 58.1,            // line 12: characters walk to desks and type
  folderOut: 60.4,       // ~ "hand in their folder": finished agent carries folder to the in-tray
  lounge: 63.57,         // line 13: "?" agent waits in lounge
  openThread: 66.2,      // ~ click the "?" agent, its thread opens
  // 5 Same hands for every agent
  sloganHands: 69.26,    // line 14 start: slogan "Same hands for every agent."
  macWindow: 72.0,       // ~ generic Mac window, agent cursor glides
  background: 77.24,     // line 15: press happens in a background window, real cursor/focus unchanged
  // 6 Your desk is optional
  deskOptional: 84.63,   // line 16: dusk, laptop open, dots pulsing
  slogan2: 85.4,         // slogan "From your desk or your phone."
  phoneIn: 90.33,        // line 17: phones (iPhone, Android), thread flags a question
  reply: 93.6,           // ~ tap reply
  approve: 95.2,         // ~ approve
  recap: 97.96,          // line 18: Home recap card
  // 7 Close
  limitAgain: 102.74,    // line 19: opening terminal again, banner, switch, carries on
  logo: 107.19,          // line 20: logo + "Give all your agents a home."
  cta: 110.64,           // line 21: end card, URL only
};

// Narration lines: start (s) and measured duration (s) from scripts/normalize-vo.sh (Hume, Tucky voice).
export const VO: { id: string; start: number; dur: number }[] = [
  { id: "01", start: 0.80, dur: 1.83 },
  { id: "02", start: 3.83, dur: 6.02 },
  { id: "03", start: 10.65, dur: 0.65 },
  { id: "04", start: 12.70, dur: 1.60 },
  { id: "05", start: 16.30, dur: 7.58 },
  { id: "06", start: 25.08, dur: 3.12 },
  { id: "07", start: 29.20, dur: 2.80 },
  { id: "08", start: 34.00, dur: 3.59 },
  { id: "09", start: 38.79, dur: 6.68 },
  { id: "10", start: 46.47, dur: 2.60 },
  { id: "11", start: 51.27, dur: 5.03 },
  { id: "12", start: 58.10, dur: 3.87 },
  { id: "13", start: 63.57, dur: 3.29 },
  { id: "14", start: 69.26, dur: 6.38 },
  { id: "15", start: 77.24, dur: 4.79 },
  { id: "16", start: 84.63, dur: 3.90 },
  { id: "17", start: 90.33, dur: 6.43 },
  { id: "18", start: 97.96, dur: 2.58 },
  { id: "19", start: 102.74, dur: 3.05 },
  { id: "20", start: 107.19, dur: 2.45 },
  { id: "21", start: 110.64, dur: 0.69 },
];

export type Sfx = { file: "tick" | "pop" | "chime" | "whoosh" | "thump" | "hit" | "boom" | "riser"; at: number; vol: number };
const W = 0.04; // whooshes are loud: keep them almost subliminal
export const SFX: Sfx[] = [
  { file: "pop", at: CUE.limitBanner + 0.3, vol: 0.4 },
  { file: "whoosh", at: T.ch2 - 0.05, vol: W }, { file: "thump", at: T.ch2, vol: 0.5 },
  { file: "pop", at: CUE.rings, vol: 0.4 },
  { file: "whoosh", at: T.ch3 - 0.05, vol: W }, { file: "thump", at: T.ch3, vol: 0.5 },
  { file: "whoosh", at: T.office - 0.05, vol: W }, { file: "thump", at: T.office, vol: 0.5 },
  { file: "pop", at: CUE.lounge, vol: 0.4 },
  { file: "whoosh", at: T.computer - 0.05, vol: W }, { file: "thump", at: T.computer, vol: 0.5 },
  { file: "whoosh", at: T.phone - 0.05, vol: W }, { file: "thump", at: T.phone, vol: 0.5 },
  { file: "chime", at: CUE.approve, vol: 0.5 },
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
