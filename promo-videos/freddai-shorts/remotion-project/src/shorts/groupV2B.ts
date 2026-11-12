import type { ShortDef } from "./registry";
import { V2_TIMELINES } from "./timelinesV2";
import { V2Short13Picker } from "./V2Short13Picker";
import { V2Short14TwoAcc } from "./V2Short14TwoAcc";
import { V2Short15Limit } from "./V2Short15Limit";

export const groupV2B: ShortDef[] = [
  { id: "short-13-picker", durationInFrames: V2_TIMELINES.picker.durationInFrames, component: V2Short13Picker },
  { id: "short-14-twoacc", durationInFrames: V2_TIMELINES.twoacc.durationInFrames, component: V2Short14TwoAcc },
  { id: "short-15-limit", durationInFrames: V2_TIMELINES.limit.durationInFrames, component: V2Short15Limit },
];
