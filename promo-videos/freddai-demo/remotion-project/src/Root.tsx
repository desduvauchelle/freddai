import React from "react";
import { Composition, Still } from "remotion";
import { Film } from "./Film";
import { Thumbnail } from "./Thumbnail";
import { FPS, TOTAL_FRAMES } from "./timeline";
import { ThumbnailV2 } from "./ThumbnailV2";
import { FilmV2 } from "./FilmV2";
import { FPS2, TOTAL2 } from "./timelineV2";

export const Root: React.FC = () => (
  <>
    <Composition id="Film" component={Film} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
    <Composition id="FreddaiVibeCoding" component={FilmV2} durationInFrames={TOTAL2} fps={FPS2} width={1920} height={1080} />
    <Still id="VibeThumbnail" component={ThumbnailV2} width={1280} height={720} />
    <Still id="Thumbnail" component={Thumbnail} width={1280} height={720} />
  </>
);
