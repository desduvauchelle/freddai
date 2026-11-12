import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, clamp } from "../theme";
import { Dormouse } from "../ui";

export const TURN_WIPE_SECONDS = 0.5;
const HOLD = 1.2, EXIT = 0.35, ENTER = 0.45;

// Chapter turn. `at` in SECONDS. Layer it ABOVE the old-way scene. It paints a paper wipe (top to bottom) over 0.5 s
// and disappears at at+TURN_WIPE_SECONDS, so the short must unmount the old-way scene at that moment
// (the ShortFrame paper ground underneath is identical, so the cut is invisible).
export const Turn: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = Math.round(at * fps);
  const wipeEnd = a + Math.round(TURN_WIPE_SECONDS * fps);
  const t = (frame - a) / fps;
  const wipe = interpolate(frame, [a, wipeEnd], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const enter = spring({ frame: frame - a, fps, config: { damping: 11, stiffness: 150, mass: 0.9 } });
  const exit = interpolate(t, [ENTER + HOLD, ENTER + HOLD + EXIT], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  // Peek in from the RIGHT edge at mid-height (head centre ~y 950), well above the caption area (starts ~1130).
  const rise = interpolate(enter, [0, 1], [380, 0]) + exit * 380;
  const showMouse = t >= 0 && t < ENTER + HOLD + EXIT;
  return (
    <>
      {frame >= a && frame < wipeEnd + 1 && (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 35%, ${C.cream} 0%, ${C.cream2} 100%)`, clipPath: `inset(0 0 ${(1 - wipe) * 100}% 0)` }}>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6, background: C.mint }} />
        </AbsoluteFill>
      )}
      {showMouse && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 760, height: 360, overflow: "hidden", pointerEvents: "none" }}>
          <div style={{ position: "absolute", right: -60, top: 0, transform: `translateX(${rise}px) rotate(${interpolate(enter, [0, 1], [8, -3])}deg)`, transformOrigin: "100% 50%" }}>
            <Dormouse size={340} />
          </div>
        </div>
      )}
    </>
  );
};
