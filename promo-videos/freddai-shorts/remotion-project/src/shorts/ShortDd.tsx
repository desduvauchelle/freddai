import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, interpolate, useCurrentFrame } from "remotion";
import { C, clamp } from "../theme";
import { FONT_DISPLAY } from "../fonts";
import { HookTitle } from "./HookTitle";
import { SHORT_TIMELINES } from "./timelines";
import clips from "../../public/denis/clips.json";
import { Short01Limit } from "./Short01Limit";
import { Short02Usage } from "./Short02Usage";
import { Short07Voice } from "./Short07Voice";
import { Short09Office } from "./Short09Office";

const FPS = 30;
type Word = { text: string; start: number; end: number };
type Clip = { duration: number; words: Word[] };

type Cfg = { clip: keyof typeof clips; base: keyof typeof SHORT_TIMELINES; Base: React.FC; lines: string[]; accent?: string };
const CFG: Record<string, Cfg> = {
  limit: { clip: "limit", base: "limit", Base: Short01Limit, lines: ["Hit your AI limit", "mid-task?"], accent: "limit" },
  usage: { clip: "usage", base: "usage", Base: Short02Usage, lines: ["How much AI", "is left?"], accent: "left" },
  voice: { clip: "voice", base: "voice", Base: Short07Voice, lines: ["Just say it."] },
  office: { clip: "office", base: "office", Base: Short09Office, lines: ["Watch your agents", "work. Literally."], accent: "Literally" },
};

// Groups of 2-4 words, split greedily; each group visible until the next one starts.
const groupWords = (words: Word[]) => {
  const groups: Word[][] = [];
  let i = 0;
  while (i < words.length) {
    const left = words.length - i;
    const n = left <= 4 ? left : left === 5 ? 3 : 3;
    groups.push(words.slice(i, i + n));
    i += n;
  }
  return groups;
};

const DennisCaption: React.FC<{ text: string; from: number; to: number }> = ({ text, from, to }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) return null;
  const p = interpolate(frame - from, [0, 5], [0, 1], clamp);
  const fs = text.length > 22 ? 52 : 60;
  return (
    <div style={{ position: "absolute", left: 90, width: 900, top: 1070, height: 260, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 900, boxSizing: "border-box", padding: "18px 36px", borderRadius: 20, background: "rgba(250,249,245,0.85)", boxShadow: "0 10px 30px rgba(40,45,35,0.12)", fontFamily: FONT_DISPLAY, fontSize: fs, fontWeight: 600, lineHeight: 1.18, letterSpacing: "-0.01em", color: C.ink, textAlign: "center", whiteSpace: "nowrap", opacity: p, transform: `scale(${interpolate(p, [0, 1], [0.96, 1])})` }}>
        {text}
      </div>
    </div>
  );
};

export const ddMeta = (key: keyof typeof CFG) => {
  const c = CFG[key];
  const clip = (clips as unknown as Record<string, Clip>)[c.clip];
  const tl = SHORT_TIMELINES[c.base];
  const last = clip.words[clip.words.length - 1];
  const cut = Math.round(Math.min(clip.duration, last.end + 0.15) * FPS);
  const skip = Math.round((tl.vo[1].start - 0.25) * FPS);
  return { cut, skip, total: cut + (tl.durationInFrames - skip) };
};

export const ShortDd: React.FC<{ variant: keyof typeof CFG }> = ({ variant }) => {
  const c = CFG[variant];
  const clip = (clips as unknown as Record<string, Clip>)[c.clip];
  const { cut, skip } = ddMeta(variant);
  const groups = groupWords(clip.words);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence from={0} durationInFrames={cut}>
        <AbsoluteFill>
          <OffthreadVideo src={staticFile(`denis/${c.clip}.mp4`)} style={{ width: 1080, height: 1920, objectFit: "cover" }} />
          <HookTitle lines={c.lines} accent={c.accent} />
          {groups.map((g, i) => {
            const from = Math.round(g[0].start * FPS);
            const to = i + 1 < groups.length ? Math.round(groups[i + 1][0].start * FPS) : cut;
            return <DennisCaption key={i} text={g.map((w) => w.text).join(" ")} from={from} to={Math.max(to, from + 6)} />;
          })}
        </AbsoluteFill>
      </Sequence>
      <Sequence from={cut}>
        {/* The base short keeps its own HookTitle plate up for the whole pain scene; Denis already said the hook, so hide it (plate = absolute, top 260, width 920). */}
        <style>{`.dd-base div[style*="top: 260px"][style*="width: 920px"]{display:none !important}`}</style>
        <AbsoluteFill className="dd-base">
          <Sequence from={-skip}>
            <c.Base />
          </Sequence>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

export const makeDd = (variant: keyof typeof CFG): React.FC => () => <ShortDd variant={variant} />;
