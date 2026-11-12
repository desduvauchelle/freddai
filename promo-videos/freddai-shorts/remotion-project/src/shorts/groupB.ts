import type { ShortDef } from "./registry";
import { SHORT_TIMELINES } from "./timelines";
import { Short04Thousand } from "./Short04Thousand";
import { Short05Needsyou } from "./Short05Needsyou";
import { Short08Routines } from "./Short08Routines";

export const groupB: ShortDef[] = [
  { id: "short-04-thousand", durationInFrames: SHORT_TIMELINES.thousand.durationInFrames, component: Short04Thousand },
  { id: "short-05-needsyou", durationInFrames: SHORT_TIMELINES.needsyou.durationInFrames, component: Short05Needsyou },
  { id: "short-08-routines", durationInFrames: SHORT_TIMELINES.routines.durationInFrames, component: Short08Routines },
];
