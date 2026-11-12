import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, clamp } from "../theme";
import { FONT_DISPLAY } from "../fonts";
import { Dormouse, Pop, usePop } from "../ui";
import { Words } from "../text";
import { Glow } from "../fx";

const ease = (frame: number, a: number, b: number) => interpolate(frame, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

const LOGO = 150; // film close proportions (dormouse S, wordmark 0.92 S); lockup ~55% of frame width

// End card, `at` in SECONDS. Staged over 1.2 s: ground, lockup, line, URL + underline.
export const EndCard: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = Math.round(at * fps);
  const urlAt = a + 21; // 0.7 s
  const urlP = usePop(urlAt, { damping: 16, stiffness: 160, mass: 0.9 });
  if (frame < a) return null;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 35%, ${C.cream} 0%, ${C.cream2} 100%)`, opacity: ease(frame, a, a + 5) }}>
      <Glow x={540} y={760} color={C.mint} opacity={0.5} size={1300} drift={1} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 760 - LOGO / 2 - 20, display: "flex", justifyContent: "center" }}>
        <Pop at={a + 3} y={30} from={0.85} origin="50% 50%">
          <div style={{ display: "flex", alignItems: "center", gap: 22, justifyContent: "center" }}>
            <Dormouse size={LOGO} />
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: LOGO * 0.92, letterSpacing: "-0.04em", color: C.ink }}>freddai</div>
          </div>
        </Pop>
      </div>
      <div style={{ position: "absolute", left: 90, width: 900, top: 760 + LOGO / 2 + 50, display: "flex", justifyContent: "center" }}>
        <Words text="Give all your agents a home." delay={a + 9} size={64} color={C.forest} weight={700} style={{ maxWidth: 900 }} />
      </div>
      {frame >= urlAt && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 1090, display: "flex", justifyContent: "center" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 62, letterSpacing: "-0.035em", color: C.ink, opacity: interpolate(urlP, [0, 0.5], [0, 1], clamp), transform: `translateY(${interpolate(urlP, [0, 1], [30, 0])}px)` }}>
            freddai.ai-juicing.com
            <div style={{ height: 7, borderRadius: 4, background: C.forest, marginTop: 10, width: `${ease(frame, urlAt + 4, urlAt + 15) * 100}%` }} />
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
