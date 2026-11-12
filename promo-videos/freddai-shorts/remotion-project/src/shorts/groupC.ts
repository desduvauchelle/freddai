import type { ShortDef } from "./registry";
import { SHORT_TIMELINES } from "./timelines";
import { Short06Phone } from "./Short06Phone";
import { Short07Voice } from "./Short07Voice";

export const groupC: ShortDef[] = [
  { id: "short-06-phone", durationInFrames: SHORT_TIMELINES.phone.durationInFrames, component: Short06Phone },
  { id: "short-07-voice", durationInFrames: SHORT_TIMELINES.voice.durationInFrames, component: Short07Voice },
];
