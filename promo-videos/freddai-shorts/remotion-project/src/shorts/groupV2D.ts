import type { ShortDef } from "./registry";
import { V2_TIMELINES } from "./timelinesV2";
import { V2Short17Phone } from "./V2Short17Phone";
import { V2Short20Hands } from "./V2Short20Hands";

export const groupV2D: ShortDef[] = [
  { id: "short-17-phone", durationInFrames: V2_TIMELINES.phone.durationInFrames, component: V2Short17Phone },
  { id: "short-20-hands", durationInFrames: V2_TIMELINES.hands.durationInFrames, component: V2Short20Hands },
];
