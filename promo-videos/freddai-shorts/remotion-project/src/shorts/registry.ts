import React from "react";
import { Short00Smoke } from "./Short00Smoke";
import { groupA } from "./groupA";
import { groupB } from "./groupB";
import { groupC } from "./groupC";
import { groupD } from "./groupD";
import { groupV2A } from "./groupV2A";
import { groupV2B } from "./groupV2B";
import { groupV2C } from "./groupV2C";
import { groupV2D } from "./groupV2D";
import { groupE } from "./groupE";

export type ShortDef = { id: string; durationInFrames: number; component: React.FC };

// 30 fps, 1080x1920. Each build group owns its own groupX.ts file.
export const shorts: ShortDef[] = [
  { id: "short-00-smoke", durationInFrames: 270, component: Short00Smoke },
  ...groupA,
  ...groupB,
  ...groupC,
  ...groupD,
  ...groupV2A,
  ...groupV2B,
  ...groupV2C,
  ...groupV2D,
  ...groupE,
];
