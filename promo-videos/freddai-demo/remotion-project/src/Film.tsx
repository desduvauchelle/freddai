import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Ch1, Ch2, Ch3, Close } from "./scenes";
import { Flash, Grain } from "./fx";
import { C } from "./theme";
import { CUE, SFX, T, VO, musicVolume, sec } from "./timeline";

const Scene: React.FC<{ from: number; to: number; children: React.ReactNode; name: string }> = ({ from, to, children, name }) => (
  <Sequence from={sec(from)} durationInFrames={sec(to) - sec(from)} name={name}>{children}</Sequence>
);

export const Film: React.FC = () => {
  const frame = useCurrentFrame();
  const dark = frame < sec(T.ch2);
  return (
    <AbsoluteFill style={{ background: C.bgDark }}>
      <Scene from={T.ch1} to={T.ch2} name="1 Hook"><Ch1 /></Scene>
      <Scene from={T.ch2} to={T.ch3} name="2 Turn"><Ch2 /></Scene>
      <Scene from={T.ch3} to={T.close} name="3 Proof"><Ch3 /></Scene>
      <Scene from={T.close} to={T.total} name="Close"><Close /></Scene>
      <Flash at={sec(CUE.logo)} color={C.cream} max={1} length={14} />
      <Grain opacity={dark ? 0.09 : 0.04} />
      <Audio src={staticFile("music/bed.wav")} volume={(f) => musicVolume(f)} />
      {VO.map((l) => (
        <Sequence key={l.id} from={sec(l.start)} name={`VO ${l.id}`}><Audio src={staticFile(`vo/n-${l.id}.wav`)} volume={1} /></Sequence>
      ))}
      {SFX.map((s, i) => (
        <Sequence key={i} from={sec(s.at)} name={`SFX ${s.file}`}><Audio src={staticFile(`sfx/${s.file}.wav`)} volume={s.vol} /></Sequence>
      ))}
    </AbsoluteFill>
  );
};
