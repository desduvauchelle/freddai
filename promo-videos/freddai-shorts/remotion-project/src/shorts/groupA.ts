import type { ShortDef } from "./registry";
import { SHORT_TIMELINES } from "./timelines";
import { Short01Limit } from "./Short01Limit";
import { Short02Usage } from "./Short02Usage";
import { Short03Reexplain } from "./Short03Reexplain";

export const groupA: ShortDef[] = [
  { id: "short-01-limit", durationInFrames: SHORT_TIMELINES.limit.durationInFrames, component: Short01Limit },
  { id: "short-02-usage", durationInFrames: SHORT_TIMELINES.usage.durationInFrames, component: Short02Usage },
  { id: "short-03-reexplain", durationInFrames: SHORT_TIMELINES.reexplain.durationInFrames, component: Short03Reexplain },
];
