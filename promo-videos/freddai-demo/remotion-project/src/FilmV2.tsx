import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Ch2, Ch3 } from "./scenes";
import { OfficeScene, PhoneScene } from "./scenesB";
import { Flash, Grain } from "./fx";
import { C } from "./theme";
import { T } from "./timeline";
import { SFX2, V, VO2, musicVolume2, sec2 } from "./timelineV2";
import { AccountsIntro, CloseScene, FadeIn, HookScene, PhoneCaption, Slice, SwapScene, TitleScene } from "./scenesV2";

const Seg: React.FC<{ from: number; to: number; fade?: number; name: string; children: React.ReactNode }> = ({ from, to, fade = 0, name, children }) => (
  <Sequence from={sec2(from)} durationInFrames={sec2(to) - sec2(from)} name={name}><FadeIn frames={fade}>{children}</FadeIn></Sequence>
);

export const FilmV2: React.FC = () => {
  const frame = useCurrentFrame();
  const dark = frame < sec2(V.title) || (frame >= sec2(V.office) && frame < sec2(V.accIntro)) || (frame >= sec2(V.phone) && frame < sec2(V.close));
  return (
    <AbsoluteFill style={{ background: C.bgDark }}>
      <Seg from={V.hook} to={V.title + 0.2} name="1 Hook"><HookScene /></Seg>
      <Seg from={V.title} to={V.talk + 0.5} name="2 Title"><TitleScene /></Seg>
      {/* original Ch3: voice -> thread, threads grouped (orig 34.0-42.1) */}
      <Slice orig={T.ch3} at={V.talk} dur={V.sched - V.talk} ch={T.ch3} fade={8}><Ch3 /></Slice>
      {/* original Ch3: schedules (orig 46.47+) */}
      <Slice orig={46.47} at={V.sched} dur={V.office - V.sched + 0.3} ch={T.ch3} fade={6}><Ch3 /></Slice>
      {/* original Office chapter */}
      <Slice orig={T.office} at={V.office} dur={V.accIntro - V.office + 0.3} ch={T.office} fade={8}><OfficeScene /></Slice>
      <Seg from={V.accIntro} to={V.accounts + 0.6} fade={8} name="Accounts intro (new)"><AccountsIntro /></Seg>
      {/* original Ch2: window + provider cards, then usage spotlight */}
      <Slice orig={T.ch2} at={V.accounts} dur={V.rings - V.accounts} ch={T.ch2} fade={10}><Ch2 /></Slice>
      <Slice orig={24.6} at={V.rings} dur={V.swap - V.rings + 0.5} ch={T.ch2}><Ch2 /></Slice>
      <Seg from={V.swap} to={V.phone + 0.3} fade={12} name="Switch accounts (new)"><SwapScene /></Seg>
      {/* original phone chapter */}
      <Slice orig={90.55} at={V.phone} dur={V.close - V.phone + 0.2} ch={T.phone} fade={10}><PhoneScene /></Slice>
      <Seg from={V.phone} to={V.close} name="Phone caption (new)"><PhoneCaption /></Seg>
      <Seg from={V.close} to={V.total} name="Close (new)"><CloseScene /></Seg>
      <Flash at={sec2(V.title)} color={C.cream} max={1} length={10} />
      <Flash at={sec2(V.close)} color={C.cream} max={1} length={14} />
      <Grain opacity={dark ? 0.09 : 0.03} />
      <Audio src={staticFile("music/bed-v2.wav")} volume={(f) => musicVolume2(f)} />
      {VO2.map((l) => (
        <Sequence key={l.id} from={sec2(l.start)} name={`VO ${l.id}`}><Audio src={staticFile(`vo-v2/n-${l.id}.wav`)} volume={1} /></Sequence>
      ))}
      {SFX2.map((s, i) => (
        <Sequence key={i} from={sec2(s.at)} name={`SFX ${s.file}`}><Audio src={staticFile(`sfx/${s.file}.wav`)} volume={s.vol} /></Sequence>
      ))}
    </AbsoluteFill>
  );
};
