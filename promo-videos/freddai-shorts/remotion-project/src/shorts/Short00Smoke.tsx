import React from "react";
import { Sequence } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { TerminalPane } from "./OldWay";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { Words } from "../text";
import { C } from "../theme";
import type { ShortTimeline } from "./types";

// Demo of every shared Shorts component, with a fake timeline (no audio files).
const tl: ShortTimeline = {
  id: "short-00-smoke", fps: 30, durationInFrames: 270,
  vo: [
    { id: "01", start: 0.3, duration: 2.5, text: "Hit your limit mid-task, and you start over." },
    { id: "02", start: 4, duration: 2, text: "Pick the other account. It carries on." },
  ],
  cues: { turn: 3, endCard: 6 },
  music: { turn: 3, lift: 4, hit: 6, end: 9 },
  sfx: [],
};

export const Short00Smoke: React.FC = () => (
  <ShortShell tl={tl} audio={false} end={<EndCard at={6} />}>
    <Sequence from={0} durationInFrames={Math.round((3 + TURN_WIPE_SECONDS) * 30)}>
      <TerminalPane at={0} bannerAt={1} height={500} style={{ position: "absolute", left: 70, top: 570 }} />
    </Sequence>
    <Sequence from={0} durationInFrames={Math.round((3 + TURN_WIPE_SECONDS) * 30)}>
      <HookTitle lines={["Hit your AI limit", "mid-task?"]} accent="limit" />
    </Sequence>
    <Sequence from={120} durationInFrames={60}>
      <div style={{ position: "absolute", left: 80, width: 920, top: 420 }}>
        <Words text="Pick the other account." size={110} color={C.ink} align="left" delay={0} />
      </div>
    </Sequence>
    <Turn at={3} />
  </ShortShell>
);
