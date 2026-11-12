import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, clamp } from "../theme";
import { FONT_DISPLAY } from "../fonts";
import type { VoLine } from "./types";

export const CAPTION_CENTER_Y = 1200;
const BOX_H = 260; // 1070..1330, inside the safe band

const MAX_W = 900, PAD_X = 36, MAX_LINE_WORDS = 5, MAX_GROUP_WORDS = 9;

// Visual lines of at most 5 words, balanced; always joined with single spaces.
const balance = (words: string[]) => {
  const n = Math.max(1, Math.ceil(words.length / MAX_LINE_WORDS));
  const per = Math.ceil(words.length / n);
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += per) lines.push(words.slice(i, i + per).join(" "));
  return lines;
};

// Font 58 down to 46 so the pill (text + padding) stays within 900 px; estimates ~0.54 em per char (semibold display).
const fontFor = (lines: string[]) => {
  const longest = Math.max(...lines.map((l) => l.length));
  return Math.max(46, Math.min(58, Math.floor((MAX_W - 2 * PAD_X - 4) / (longest * 0.54))));
};

// One caption group. `at` and `duration` in SECONDS.
export const Caption: React.FC<{ text: string; at: number; duration: number }> = ({ text, at, duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = Math.round(at * fps), b = Math.round((at + duration) * fps);
  if (frame < a || frame >= b) return null;
  const p = interpolate(frame - a, [0, 6], [0, 1], clamp);
  const lines = balance(text.trim().split(/\s+/).filter(Boolean));
  const fs = fontFor(lines);
  return (
    <div style={{ position: "absolute", left: 90, width: 900, top: CAPTION_CENTER_Y - BOX_H / 2, height: BOX_H, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: MAX_W, boxSizing: "border-box", padding: `18px ${PAD_X}px`, borderRadius: 20, background: "rgba(250,249,245,0.85)", boxShadow: "0 10px 30px rgba(40,45,35,0.12)", fontFamily: FONT_DISPLAY, fontSize: fs, fontWeight: 600, lineHeight: 1.18, letterSpacing: "-0.01em", color: C.ink, textAlign: "center", opacity: p, transform: `scale(${interpolate(p, [0, 1], [0.96, 1])})` }}>
        {lines.map((l, i) => <React.Fragment key={i}>{i > 0 && <br />}<span style={{ whiteSpace: "nowrap" }}>{l}</span></React.Fragment>)}
      </div>
    </div>
  );
};

// Every VO line as a caption; lines over 9 words are split on word boundaries into balanced groups
// that share the duration by word count. Group i is visible [start_i, start_{i+1}) so the line spans exactly start..start+duration.
export const Captions: React.FC<{ vo: VoLine[] }> = ({ vo }) => (
  <>
    {vo.flatMap((l) => {
      const words = l.text.trim().split(/\s+/).filter(Boolean);
      const n = Math.max(1, Math.ceil(words.length / MAX_GROUP_WORDS));
      const per = Math.ceil(words.length / n);
      const out: React.ReactNode[] = [];
      for (let g = 0; g < n; g++) {
        const from = g * per, to = Math.min(words.length, from + per);
        const s0 = l.start + (l.duration * from) / words.length;
        const s1 = g === n - 1 ? l.start + l.duration : l.start + (l.duration * to) / words.length;
        out.push(<Caption key={`${l.id}-${g}`} text={words.slice(from, to).join(" ")} at={s0} duration={s1 - s0} />);
      }
      return out;
    })}
  </>
);
