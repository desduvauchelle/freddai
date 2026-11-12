import type { ShortDef } from "./registry";
import { V2_TIMELINES } from "./timelinesV2";
import { V2Short11Talk } from "./V2Short11Talk";
import { V2Short12SetForget } from "./V2Short12SetForget";
import { V2Short19Sleep } from "./V2Short19Sleep";

export const groupV2A: ShortDef[] = [
  { id: "short-11-talk", durationInFrames: V2_TIMELINES.talk.durationInFrames, component: V2Short11Talk },
  { id: "short-12-setforget", durationInFrames: V2_TIMELINES.setforget.durationInFrames, component: V2Short12SetForget },
  { id: "short-19-sleep", durationInFrames: V2_TIMELINES.sleep.durationInFrames, component: V2Short19Sleep },
];
