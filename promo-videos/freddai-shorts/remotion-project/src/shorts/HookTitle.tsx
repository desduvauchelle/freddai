import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, clamp } from "../theme";
import { FONT_DISPLAY } from "../fonts";

export const HOOK_TOP = 260;

// Frame-0 hook. `from` is in FRAMES. With from <= 0 the title is fully legible at frame 0 (thumbnail);
// with from > 0 nothing shows before `from`, then the film's blur-in word reveal plays.
export const HookTitle: React.FC<{ lines: string[]; from?: number; accent?: string }> = ({ lines, from = 0, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const longest = Math.max(...lines.map((l) => l.length));
  const size = Math.max(72, Math.min(108, Math.floor(840 / (longest * 0.54))));
  let wi = 0;
  const plateP = from <= 0 ? 1 : interpolate(frame - from, [0, 8], [0, 1], clamp);
  if (from > 0 && frame < from) return null;
  return (
    <div style={{ position: "absolute", left: 80, top: HOOK_TOP, width: 920, boxSizing: "border-box", padding: "34px 44px 38px", borderRadius: 32, background: "rgba(250,249,245,0.86)", boxShadow: "0 24px 70px rgba(40,45,35,0.16)", opacity: plateP, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: size, lineHeight: 1.04, letterSpacing: "-0.03em", color: C.ink, textAlign: "left" }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: "flex", whiteSpace: "nowrap", gap: "0 0.26em" }}>
          {line.split(" ").map((w, i) => {
            const idx = wi++;
            const p = from <= 0 ? 1 : spring({ frame: frame - from - idx * 3, fps, config: { damping: 16, stiffness: 150, mass: 0.7 } });
            const isAccent = !!accent && w.replace(/[.,!?]/g, "").toLowerCase() === accent.toLowerCase();
            return (
              <span key={i} style={{ display: "inline-block", transform: `translateY(${interpolate(p, [0, 1], [40, 0])}px)`, opacity: interpolate(p, [0, 0.6], [0, 1], clamp), filter: `blur(${interpolate(p, [0, 1], [10, 0])}px)`, color: isAccent ? C.forest : C.ink }}>{w}</span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
