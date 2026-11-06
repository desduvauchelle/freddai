import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Words, Kicker } from "./text";
import { Glow, Vignette } from "./fx";
import { C } from "./theme";
import { CUE, T, sec } from "./timeline";

// Each scene is mounted inside its own <Sequence>, so useCurrentFrame() is 0 at the chapter start.
// Convert absolute cue seconds with `sec(CUE.x - T.chN)`.
export const Ch1: React.FC = () => (
  <AbsoluteFill style={{ background: C.bgDark, justifyContent: "center", alignItems: "center" }}>
    <Glow x={960} y={540} color={C.green2} opacity={0.35} drift={1} />
    <Words text="Replace this with the hook." delay={sec(CUE.hook)} size={110} />
    <Vignette />
  </AbsoluteFill>
);

export const Ch2: React.FC = () => (
  <AbsoluteFill style={{ background: C.cream, justifyContent: "center", alignItems: "center" }}>
    <Kicker text="Chapter two" color={C.green2} />
    <Words text="The turn." color={C.ink} />
  </AbsoluteFill>
);

export const Ch3: React.FC = () => (
  <AbsoluteFill style={{ background: C.cream, justifyContent: "center", alignItems: "center" }}>
    <Words text="Proof, in the product's own UI." color={C.ink} size={80} />
  </AbsoluteFill>
);

export const Close: React.FC = () => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: frame < sec(CUE.logo - T.close) ? C.bgDark : C.cream, justifyContent: "center", alignItems: "center" }}>
      {frame >= sec(CUE.logo - T.close) && <Words text="Product name" color={C.ink} delay={sec(CUE.logo - T.close)} />}
    </AbsoluteFill>
  );
};
