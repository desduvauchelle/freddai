import React, { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { ShortFrame } from "./ShortFrame";
import { ShortAudio } from "./ShortAudio";
import { Captions } from "./Captions";
import type { ShortTimeline } from "./types";

// ShortFrame (full canvas, scenes position themselves absolutely) + audio + captions on top.
// Scenes (incl. HookTitle, Turn) go in children, under the captions. Pass <EndCard/> as `end` so it covers the captions.
// `audio={false}` skips <Audio> (demo shorts without wav files).
export const ShortShell: React.FC<{ tl: ShortTimeline; children?: ReactNode; end?: ReactNode; audio?: boolean }> = ({ tl, children, end, audio = true }) => (
  <ShortFrame safe={false}>
    {audio && <ShortAudio tl={tl} />}
    <AbsoluteFill>{children}</AbsoluteFill>
    <Captions vo={tl.vo} />
    {end}
  </ShortFrame>
);
