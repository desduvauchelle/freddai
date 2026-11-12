import React from "react";
import { Composition, Still } from "remotion";
import { Film } from "./Film";
import { Thumbnail } from "./Thumbnail";
import { FPS, TOTAL_FRAMES } from "./timeline";
import { shorts } from "./shorts/registry";

export const Root: React.FC = () => (
  <>
    <Composition id="Film" component={Film} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
    <Still id="Thumbnail" component={Thumbnail} width={1280} height={720} />
    {shorts.map(({ id, durationInFrames, component }) => (
      <Composition key={id} id={id} component={component} durationInFrames={durationInFrames} fps={30} width={1080} height={1920} />
    ))}
  </>
);
