import React, { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../theme";
import { FONT_BODY } from "../fonts";

export const W = 1080;
export const H = 1920;
export const SAFE_TOP = 168; // platform UI (search/title bar) covers above this
export const SAFE_BOTTOM = 1330; // captions/buttons/description cover below this

// Warm paper ground. Children are laid out inside the safe zone (y 168..1330) by default.
// Set `safe={false}` to get the full 1080x1920 canvas for edge-to-edge backgrounds.
export const ShortFrame: React.FC<{ children?: ReactNode; safe?: boolean; background?: string }> = ({ children, safe = true, background = C.paper }) => (
  <AbsoluteFill style={{ background, fontFamily: FONT_BODY, color: C.ink, overflow: "hidden" }}>
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 35%, ${C.cream} 0%, ${C.cream2} 100%)` }} />
    {safe ? (
      <div style={{ position: "absolute", left: 0, right: 0, top: SAFE_TOP, height: SAFE_BOTTOM - SAFE_TOP, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    ) : (
      children
    )}
  </AbsoluteFill>
);
