import type { ShortDef } from "./registry";
import { Short09Office } from "./Short09Office";
import { Short10Hands } from "./Short10Hands";

export const groupD: ShortDef[] = [
  { id: "short-09-office", durationInFrames: 660, component: Short09Office },
  { id: "short-10-hands", durationInFrames: 540, component: Short10Hands },
];
