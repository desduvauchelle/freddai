import type { ShortDef } from "./registry";
import { V2_TIMELINES } from "./timelinesV2";
import { V2Short16Usage } from "./V2Short16Usage";
import { V2Short18Smooth } from "./V2Short18Smooth";

export const groupV2C: ShortDef[] = [
  { id: "short-16-usage", durationInFrames: V2_TIMELINES.usage.durationInFrames, component: V2Short16Usage },
  { id: "short-18-smooth", durationInFrames: V2_TIMELINES.smooth.durationInFrames, component: V2Short18Smooth },
];
