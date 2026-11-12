import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { OfficeWindow } from "./uiOffice";
import { ComputerBody } from "./uiComputer";
import { PhoneBody } from "./uiPhone";
import { C } from "./theme";
import { FPS, T } from "./timeline";

// Convention: each chapter is mounted inside its own <Sequence from={sec(T.chN)}>, so useCurrentFrame() is chapter-relative.
// absolute film seconds = T.chN + frame / FPS; every beat reads from CUE.
export const useChapterT = (start: number) => start + useCurrentFrame() / FPS;

export const OfficeScene: React.FC = () => {
  const t = useChapterT(T.office);
  return (
    <AbsoluteFill style={{ background: C.bgDark }}>
      <OfficeWindow t={t} />
    </AbsoluteFill>
  );
};
export const ComputerScene: React.FC = () => <ComputerBody t={useChapterT(T.computer)} />;
export const PhoneScene: React.FC = () => <PhoneBody t={useChapterT(T.phone)} />;
