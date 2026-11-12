import type { ShortDef } from "./registry";
import { makeDd, ddMeta } from "./ShortDd";

const dd = (id: string, key: "limit" | "usage" | "voice" | "office"): ShortDef => ({ id, durationInFrames: ddMeta(key).total, component: makeDd(key) });

export const groupE: ShortDef[] = [
  dd("short-01-limit-dd", "limit"),
  dd("short-02-usage-dd", "usage"),
  dd("short-07-voice-dd", "voice"),
  dd("short-09-office-dd", "office"),
];
