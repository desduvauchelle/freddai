import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { EndCard } from "./EndCard";
import { V2_TIMELINES } from "./timelinesV2";
import { A, Dormouse, Icon, PROJECTS } from "../ui";
import { C, clamp } from "../theme";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";

const tl = V2_TIMELINES.sleep;
const f = (s: number) => Math.round(s * 30);
const END = f(tl.cues.endcard);
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: e });

const T_PLATE_OUT = 7.7;
const T_CHIP1 = 4.9; // "Update the dependencies"
const T_CHIP2 = 6.5; // "Triage the issues"
const T_CHIP_OUT = 8.6;
const T_CARD1 = 9.0; // "Give them a schedule" / "Weekdays, nine a.m."
const T_CARD2 = 9.6;
const T_NEXT = 13.6; // "the next run is right there on the card"
const T_DAWN = 15.4;
const T_DAWN_END = 17.4;
const T_DONE1 = 16.9;
const T_DONE2 = 17.3;

const CARD_TOPS = [550, 810];

// seeded stars
const STARS = Array.from({ length: 46 }, (_, i) => {
  const r = (n: number) => { const x = Math.sin(i * 91.7 + n * 17.3) * 43758.5453; return x - Math.floor(x); };
  return { x: r(1) * 1080, y: 20 + r(2) * 1500, s: 3 + r(3) * 5, ph: r(4) * 6 };
});

const Sky: React.FC<{ dawn: number }> = ({ dawn }) => {
  const frame = useCurrentFrame();
  const top = interpolateColors(dawn, [0, 1], ["#0d1322", "#f2c98f"]);
  const bot = interpolateColors(dawn, [0, 1], ["#1d2b33", "#faf9f5"]);
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${top} 0%, ${bot} 100%)` }}>
      {STARS.map((s, i) => (
        <div key={i} style={{ position: "absolute", left: s.x, top: s.y, width: s.s, height: s.s, borderRadius: s.s, background: "#f4efd9", opacity: (1 - dawn) * (0.45 + 0.4 * Math.sin(frame / 14 + s.ph)) }} />
      ))}
    </AbsoluteFill>
  );
};

const Orb: React.FC<{ dawn: number }> = ({ dawn }) => {
  const frame = useCurrentFrame();
  const y = 330 - 10 * dawn;
  return (
    <div style={{ position: "absolute", left: 540 - 130, top: y - 130, width: 260, height: 260 }}>
      <div style={{ position: "absolute", inset: 0, opacity: 1 - dawn, transform: `scale(${1 - 0.1 * dawn})` }}>
        <div style={{ position: "absolute", inset: -60, borderRadius: "50%", background: "radial-gradient(circle, rgba(243,238,214,0.28) 0%, rgba(243,238,214,0) 70%)" }} />
        <div style={{ position: "absolute", left: 30, top: 30, width: 200, height: 200, borderRadius: "50%", background: "#f3eed6", boxShadow: "inset -26px -10px 0 rgba(150,150,130,0.25)" }} />
        <div style={{ position: "absolute", left: 80, top: 80, width: 34, height: 34, borderRadius: "50%", background: "rgba(150,150,130,0.3)" }} />
        <div style={{ position: "absolute", left: 140, top: 130, width: 24, height: 24, borderRadius: "50%", background: "rgba(150,150,130,0.3)" }} />
      </div>
      <div style={{ position: "absolute", inset: 0, opacity: dawn, transform: `scale(${0.8 + 0.2 * dawn + 0.02 * Math.sin(frame / 8)})` }}>
        <div style={{ position: "absolute", inset: -90, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,205,110,0.55) 0%, rgba(255,205,110,0) 70%)" }} />
        <div style={{ position: "absolute", left: 30, top: 30, width: 200, height: 200, borderRadius: "50%", background: "linear-gradient(180deg, #ffd36e, #f0a63c)" }} />
      </div>
    </div>
  );
};

const Chip: React.FC<{ text: string; at: number; top: number; out: number }> = ({ text, at, top, out }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const p = spring({ frame: frame - at, fps, config: { damping: 15, stiffness: 150, mass: 0.7 } });
  return (
    <div style={{ position: "absolute", left: 70, top, width: 940, height: 120, boxSizing: "border-box", borderRadius: 26, background: "rgba(30,36,30,0.82)", border: `2px solid ${C.line}`, display: "flex", alignItems: "center", gap: 24, padding: "0 36px", opacity: p * (1 - out), transform: `translateY(${(1 - p) * 40}px) scale(${0.96 + 0.04 * p})`, fontFamily: FONT_DISPLAY }}>
      <Icon name="repeat" size={56} color={C.sage} stroke={2.2} />
      <span style={{ fontSize: 60, fontWeight: 700, color: C.textDark, letterSpacing: "-0.01em" }}>{text}</span>
    </div>
  );
};

const CARD_H = 236;
const RoutineCard: React.FC<{ name: string; project: { name: string; color: string }; at: number; done: number; highlight?: number; top: number }> = ({ name, project, at, done, highlight = 0, top }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const p = spring({ frame: frame - at, fps, config: { damping: 15, stiffness: 150, mass: 0.7 } });
  const swap = ease(frame, done, done + 10);
  const ring = ease(frame, f(T_NEXT), f(T_NEXT) + 10) * (1 - swap);
  const pulse = 0.6 + 0.4 * Math.sin(frame / 5);
  return (
    <div style={{ position: "absolute", left: 70, top, width: 940, height: CARD_H, boxSizing: "border-box", borderRadius: 26, background: A.card, border: `2px solid ${highlight ? `rgba(127,208,160,${0.35 + 0.5 * highlight})` : A.border}`, padding: "20px 32px", fontFamily: FONT_BODY, opacity: Math.min(1, p * 1.6), transform: `translateY(${(1 - p) * 40}px) scale(${0.96 + 0.04 * p})`, boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, height: 64 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: "#25262b", display: "grid", placeItems: "center", color: A.muted }}><Icon name="clock" size={36} /></div>
        <div style={{ flex: 1, fontSize: 48, fontWeight: 700, color: A.textHi, whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>{name}</div>
        <div style={{ width: 84, height: 46, borderRadius: 23, background: A.running, position: "relative" }}><div style={{ position: "absolute", right: 5, top: 5, width: 36, height: 36, borderRadius: 18, background: "#12301f" }} /></div>
      </div>
      <div style={{ marginTop: 8, height: 44, display: "flex", alignItems: "center", gap: 14, fontSize: 36, color: A.muted, whiteSpace: "nowrap" }}>
        <span style={{ width: 18, height: 18, borderRadius: 5, background: project.color }} />{project.name}<span>·</span>Weekdays 9 AM
      </div>
      <div style={{ position: "relative", marginTop: 12, height: 56 }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: 56, padding: "0 22px", borderRadius: 14, display: "flex", alignItems: "center", gap: 14, fontSize: 38, fontWeight: 700, color: A.running, whiteSpace: "nowrap", opacity: 1 - swap, border: `3px solid rgba(127,208,160,${ring * pulse})`, boxShadow: `0 0 ${18 * ring}px rgba(127,208,160,${0.5 * ring})` }}>
          <span style={{ fontWeight: 500, color: A.muted }}>Next run</span>Tomorrow 9 AM
        </div>
        <div style={{ position: "absolute", left: 0, top: 0, height: 56, padding: "0 22px", borderRadius: 28, display: "flex", alignItems: "center", gap: 12, fontSize: 38, fontWeight: 700, color: A.running, background: "rgba(127,208,160,0.16)", border: `2px solid ${A.running}`, whiteSpace: "nowrap", opacity: swap, transform: `scale(${0.94 + 0.06 * swap})`, transformOrigin: "0 50%" }}>
          <Icon name="check" size={34} color={A.running} stroke={3} />Done 9:00 AM
        </div>
      </div>
    </div>
  );
};

const Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const dawn = ease(frame, f(T_DAWN), f(T_DAWN_END));
  const out = ease(frame, f(T_CHIP_OUT), f(T_CHIP_OUT) + 10);
  const dormouseA = ease(frame, f(T_CHIP_OUT) - 6, f(T_CHIP_OUT) + 8, 1, 0);
  const orbA = ease(frame, f(T_PLATE_OUT) - 2, f(T_PLATE_OUT) + 14);
  const hl1 = ease(frame, f(10.8), f(11.4)) * (1 - ease(frame, f(12.4), f(13.0)));
  const { fps } = useVideoConfig();
  const clockP = frame >= f(T_DAWN) + 18 ? spring({ frame: frame - f(T_DAWN) - 18, fps, config: { damping: 14, stiffness: 150, mass: 0.7 } }) : 0;
  const cards = [
    { name: "Update dependencies", project: PROJECTS[0], at: T_CARD1, done: T_DONE1 },
    { name: "Triage issues", project: PROJECTS[2], at: T_CARD2, done: T_DONE2 },
  ];
  return (
    <>
      <Sky dawn={dawn} />
      <div style={{ opacity: orbA }}><Orb dawn={dawn} /></div>
      {clockP > 0 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 452, display: "flex", justifyContent: "center", opacity: Math.min(1, clockP * 1.4), transform: `translateY(${(1 - clockP) * 20}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, height: 84, padding: "0 36px", borderRadius: 42, background: "rgba(250,249,245,0.92)", border: `2px solid ${C.forest}`, fontFamily: FONT_DISPLAY, fontSize: 56, fontWeight: 800, color: C.forest, letterSpacing: "-0.02em" }}>
            <Icon name="clock" size={46} color={C.forest} stroke={2.4} />9:00 AM
          </div>
        </div>
      )}
      {dormouseA > 0 && (
        <div style={{ position: "absolute", left: 540 - 115, top: 835, opacity: dormouseA, transform: `rotate(-6deg) translateY(${3 * Math.sin(frame / 20)}px)` }}>
          <Dormouse size={230} />
          {[0, 1, 2].map((i) => {
            const t = ((frame / 70 + i / 3) % 1);
            return (
              <span key={i} style={{ position: "absolute", left: 250 + i * 34, top: 40 - t * 100 - i * 20, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 56 - i * 6, color: C.sage, opacity: Math.sin(t * Math.PI) }}>z</span>
            );
          })}
        </div>
      )}
      <Chip text="Update dependencies" at={f(T_CHIP1)} top={CARD_TOPS[0]} out={out} />
      <Chip text="Triage issues" at={f(T_CHIP2)} top={CARD_TOPS[0] + 136} out={out} />
      {cards.map((c, i) => (
        <RoutineCard key={c.name} name={c.name} project={c.project} at={f(c.at)} done={f(c.done)} highlight={i === 0 ? hl1 : 0} top={CARD_TOPS[i]} />
      ))}
    </>
  );
};

const PlateExit: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const o = ease(frame, f(T_PLATE_OUT) - 8, f(T_PLATE_OUT) + 8, 1, 0);
  return <div style={{ position: "absolute", inset: 0, opacity: o, transform: `translateY(${(1 - o) * -30}px)` }}>{children}</div>;
};

export const V2Short19Sleep: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={END + 30}>
      <Scene />
    </Sequence>
    <Sequence from={0} durationInFrames={f(T_PLATE_OUT) + 12}>
      <PlateExit>
        <div style={{ position: "absolute", left: 80, top: 260, width: 920, height: 288, borderRadius: 32, background: C.cream }} />
        <HookTitle lines={["Vibe code while", "you sleep."]} accent="sleep" />
      </PlateExit>
    </Sequence>
  </ShortShell>
);
