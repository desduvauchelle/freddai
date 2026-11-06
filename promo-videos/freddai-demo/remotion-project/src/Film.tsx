import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Ch1, Ch2, Ch3, Close } from "./scenes";
import { ComputerScene, OfficeScene, PhoneScene } from "./scenesB";
import { Flash, Grain } from "./fx";
import { C } from "./theme";
import { CUE, SFX, T, VO, musicVolume, sec } from "./timeline";

const Scene: React.FC<{ from: number; to: number; children: React.ReactNode; name: string }> = ({ from, to, children, name }) => (
  <Sequence from={sec(from)} durationInFrames={sec(to) - sec(from)} name={name}>{children}</Sequence>
);

export const Film: React.FC = () => {
  const frame = useCurrentFrame();
  const dark = frame < sec(T.ch2) || (frame >= sec(T.close) && frame < sec(CUE.logo));
  return (
    <AbsoluteFill style={{ background: C.bgDark }}>
      <Scene from={T.ch1} to={T.ch2} name="1 Juggle"><Ch1 /></Scene>
      <Scene from={T.ch2} to={T.ch3} name="2 Accounts"><Ch2 /></Scene>
      <Scene from={T.ch3} to={T.office} name="3 Say it, let it run"><Ch3 /></Scene>
      <Scene from={T.office} to={T.computer} name="4 Office"><OfficeScene /></Scene>
      <Scene from={T.computer} to={T.phone} name="5 Computer use"><ComputerScene /></Scene>
      <Scene from={T.phone} to={T.close} name="6 Phone"><PhoneScene /></Scene>
      <Scene from={T.close} to={T.total} name="7 Close"><Close /></Scene>
      <Flash at={sec(CUE.logo)} color={C.cream} max={1} length={14} />
      <Grain opacity={dark ? 0.09 : 0.03} />
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
