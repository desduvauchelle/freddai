/** Synthesised Web Audio cues for Office v2. No assets. Default OFF; the toggle click provides the user gesture. */
export type SoundKind = "arrive" | "complete" | "fail" | "needs-you" | "review" | "leave" | "stuck" | "purchase" | "random-start";
export type OfficeSound = { play(kind: SoundKind): void; setEnabled(on: boolean): void; enabled(): boolean; dispose(): void };

export const SOUND_KEY = "freddai.office2.sound.v1";
const MASTER = 0.12, PER_KIND_MS = 1500, MAX_PER_SEC = 4;

export function readSoundEnabled(): boolean {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(SOUND_KEY) === "true"; } catch { return false; }
}
export function writeSoundEnabled(on: boolean) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(SOUND_KEY, String(on)); }
  catch (e) { console.warn("office2.sound.persist-failed", e); }
}

type Note = { f: number; to?: number; t: number; d: number; type: OscillatorType; gain?: number };
const CUES: Record<SoundKind, { notes: Note[]; lowpass?: number }> = {
  arrive: { notes: [{ f: 300, to: 900, t: 0, d: 0.12, type: "sine" }] },
  complete: { notes: [{ f: 880, t: 0, d: 0.09, type: "triangle" }, { f: 1320, t: 0.09, d: 0.09, type: "triangle" }] },
  "needs-you": { notes: [660, 880, 1100].map((f, i) => ({ f, t: i * 0.14, d: 0.4, type: "sine" as const })) },
  fail: { notes: [{ f: 110, t: 0, d: 0.18, type: "square" }], lowpass: 400 },
  review: { notes: [523, 659, 784, 1047].map((f, i) => ({ f, t: i * 0.07, d: 0.18, type: "sine" as const })) },
  leave: { notes: [{ f: 700, to: 200, t: 0, d: 0.2, type: "sine" }] },
  stuck: { notes: [{ f: 150, t: 0, d: 0.25, type: "sine" }] },
  purchase: { notes: [{ f: 1200, t: 0, d: 0.06, type: "square", gain: 0.5 }, { f: 1600, t: 0.06, d: 0.06, type: "square", gain: 0.5 }] },
  "random-start": { notes: [523, 659, 784].map((f, i) => ({ f, t: i * 0.12, d: 0.16, type: "triangle" as const })) },
};

export function createOfficeSound(): OfficeSound {
  let on = readSoundEnabled();
  let ctx: AudioContext | null = null, master: GainNode | null = null;
  const lastByKind = new Map<SoundKind, number>();
  let recent: number[] = [];
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  const ensure = (): AudioContext | null => {
    if (ctx) return ctx;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = MASTER;
      master.connect(ctx.destination);
    } catch (e) { console.warn("office2.sound.context-failed", e); ctx = null; return null; }
    return ctx;
  };

  return {
    enabled: () => on,
    setEnabled(v) { on = v; if (v) { const c = ensure(); void c?.resume?.(); } },
    play(kind) {
      if (!on) return;
      const t = now();
      if (t - (lastByKind.get(kind) ?? -Infinity) < PER_KIND_MS) return;
      recent = recent.filter(x => t - x < 1000);
      if (recent.length >= MAX_PER_SEC) return;
      const c = ensure();
      if (!c || !master) return;
      lastByKind.set(kind, t); recent.push(t);
      void c.resume?.();
      const cue = CUES[kind];
      let dest: AudioNode = master;
      if (cue.lowpass) { const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = cue.lowpass; lp.connect(master); dest = lp; }
      for (const n of cue.notes) {
        const start = c.currentTime + n.t, end = start + n.d;
        const osc = c.createOscillator(), g = c.createGain();
        osc.type = n.type;
        osc.frequency.setValueAtTime(n.f, start);
        if (n.to) osc.frequency.linearRampToValueAtTime(n.to, end);
        g.gain.setValueAtTime(n.gain ?? 1, start);
        g.gain.exponentialRampToValueAtTime(0.001, end);
        osc.connect(g); g.connect(dest);
        osc.start(start); osc.stop(end + 0.02);
      }
    },
    dispose() { try { void ctx?.close?.(); } catch { /* already closed */ } ctx = null; master = null; },
  };
}
