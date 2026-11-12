import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import type { ShortTimeline } from "./types";

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

// Same ducking as timeline.ts musicVolume: base 0.3, -50% under every VO line (0.25 s ramps), 1.6 s fade-out at the end.
export const musicGain = (frame: number, tl: ShortTimeline) => {
  const t = frame / FPS;
  const total = tl.durationInFrames / FPS;
  let v = 0.3;
  for (const l of tl.vo) {
    const a = l.start - 0.15, b = l.start + l.duration + 0.25;
    if (t >= a && t <= b) { const edge = Math.min(1, Math.min(t - a, b - t) / 0.25); v *= 1 - 0.5 * edge; }
  }
  if (t > total - 1.6) v *= Math.max(0, (total - t) / 1.6);
  return v;
};

// Files are resolved at render time only; nothing is imported, so missing files do not break the bundle.
export const ShortAudio: React.FC<{ tl: ShortTimeline }> = ({ tl }) => (
  <>
    <Audio src={staticFile(`music/${tl.id}.wav`)} volume={(fr) => musicGain(fr, tl)} />
    {tl.vo.map((l) => (
      <Sequence key={l.id} from={f(l.start)} name={`VO ${l.id}`}><Audio src={staticFile(`vo/n-${l.id}.wav`)} volume={1} /></Sequence>
    ))}
    {tl.sfx.map((s, i) => (
      <Sequence key={i} from={f(s.at)} name={`SFX ${s.name}`}><Audio src={staticFile(`sfx/${s.name}.wav`)} volume={s.gain} /></Sequence>
    ))}
  </>
);
