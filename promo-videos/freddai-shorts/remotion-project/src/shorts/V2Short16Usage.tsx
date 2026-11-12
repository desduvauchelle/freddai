import React from "react";
import { Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { EndCard } from "./EndCard";
import { V2_TIMELINES } from "./timelinesV2";
import { A, ACCOUNTS, Icon, Pointer, UsageRing } from "../ui";
import type { Account } from "../ui";
import { FONT_BODY } from "../fonts";
import { clamp } from "../theme";

const tl = V2_TIMELINES.usage;
const f = (s: number) => Math.round(s * 30);
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: e });

// Rows: Claude Max, Claude work, Codex personal, Codex work, Gemini, Grok
const ROWS: Account[] = ["claude-max", "claude-work", "codex-personal", "codex-work", "gemini", "grok"].map((id) => ACCOUNTS.find((a) => a.id === id)!);
const PANEL = { x: 60, y: 190, w: 960, h: 840 };
const ROW_H = 126, ROW_TOP = PANEL.y + 40;
const T_FILL = f(tl.vo[1].start); // 16-02
const T_TEXT = f(tl.vo[2].start); // 16-03
const T_PROV = f(tl.vo[3].start); // 16-04
const T_AMBER = f(tl.vo[4].start); // 16-05
const T_MOVE = f(tl.vo[5].start); // 16-06
const T_TAP = f(tl.vo[6].start) + 6; // 16-07
const GEMINI = 4;
const AMBER_BG = "rgba(233,182,103,0.16)";

const SLOT0 = [0, 1, 2, 2, 3, 4]; // frame 0: five rows under the hook plate, the sixth joins when the plate leaves
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const useSettle = () => ease(useCurrentFrame(), T_FILL - 12, T_FILL + 10, 0, 1, Easing.out(Easing.cubic));

const Row: React.FC<{ a: Account; i: number }> = ({ a, i }) => {
  const frame = useCurrentFrame();
  const sp = useSettle();
  const { fps } = useVideoConfig();
  const fill = ease(frame, T_FILL + i * 5, T_FILL + i * 5 + 34, 0, 1, Easing.out(Easing.cubic));
  const text = ease(frame, T_TEXT + i * 4, T_TEXT + i * 4 + 22, 0, 1, Easing.out(Easing.cubic));
  const shown = Math.round(a.left * text);
  // provider sweep (16-04): Claude, Codex, Gemini, Grok one after another
  const group = i < 2 ? 0 : i < 4 ? 1 : i === 4 ? 2 : 3;
  const sweepAt = T_PROV + [0, 20, 52, 74][group];
  const sweep = interpolate(frame, [sweepAt, sweepAt + 8, sweepAt + 30], [0, 1, 0], clamp);
  const isMax = i === 0;
  const amber = isMax ? ease(frame, T_AMBER, T_AMBER + 10) : 0;
  const amberPulse = isMax ? spring({ frame: frame - T_AMBER, fps, config: { damping: 8, stiffness: 160, mass: 0.7 } }) : 0;
  // account switch
  const hover = i === GEMINI ? ease(frame, T_TAP - 22, T_TAP - 10) : 0;
  const active = i === GEMINI ? spring({ frame: frame - T_TAP, fps, config: { damping: 13, stiffness: 200, mass: 0.7 } }) : 0;
  const dimmed = isMax ? ease(frame, T_TAP + 4, T_TAP + 20, 1, 0.45) : 1;
  const ringRem = isMax && amber < 0.5 ? 10.5 : a.left;
  const bg = isMax && amber > 0 ? AMBER_BG.replace("0.16", String(0.16 * amber)) : `${a.color}${Math.round(26 * Math.max(sweep, active)).toString(16).padStart(2, "0")}`;
  const lowNow = isMax && amber > 0.5;
  const lift = 1 + 0.025 * sweep + 0.03 * active + 0.02 * amberPulse * (1 - ease(frame, T_AMBER + 12, T_AMBER + 30));
  return (
    <div style={{ position: "absolute", left: PANEL.x + 24, top: lerp(540 + SLOT0[i] * 100, ROW_TOP + i * ROW_H, sp), width: PANEL.w - 48, height: lerp(90, ROW_H - 10, sp), borderRadius: 22, display: "flex", alignItems: "center", gap: 26, padding: "0 28px", boxSizing: "border-box", background: bg, border: `3px solid ${active > 0.1 ? a.color : lowNow ? `rgba(233,182,103,${0.6 * amber})` : "transparent"}`, opacity: dimmed * (i === 3 ? sp : 1), transform: `scale(${lift})`, fontFamily: FONT_BODY }}>
      <UsageRing remaining={ringRem} color={a.color} fill={fill} size={88}>
        <span style={{ fontSize: 36, fontWeight: 700, color: lowNow ? A.amber : A.muted }}>{a.glyph}</span>
      </UsageRing>
      <div style={{ lineHeight: 1.2, whiteSpace: "nowrap", flex: 1 }}>
        <div style={{ fontSize: 40, fontWeight: 700, color: A.textHi }}>{a.provider} · {a.label}</div>
        <div style={{ fontSize: 36, color: lowNow ? A.amber : A.muted, fontWeight: lowNow ? 600 : 400 }}>{text > 0.02 ? `${shown}% left · resets ${a.reset}` : "—"}</div>
      </div>
      {i === GEMINI && hover > 0 && (
        <div style={{ height: 64, padding: "0 26px", borderRadius: 32, display: "flex", alignItems: "center", gap: 10, fontSize: 36, fontWeight: 700, background: active > 0.5 ? a.color : "#e1e1e7", color: "#14151a", opacity: hover, transform: `scale(${0.9 + 0.1 * hover + 0.08 * Math.sin(active * Math.PI)})` }}>
          {active > 0.5 && <Icon name="check" size={32} color="#14151a" stroke={3} />}{active > 0.5 ? "Active" : "Switch"}
        </div>
      )}
    </div>
  );
};

const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const sp = useSettle();
  const hookOut = ease(frame, T_FILL - 10, T_FILL - 2);
  const panelP = ease(frame, 0, 14, 0.97, 1, Easing.out(Easing.cubic));
  return (
    <>
      <div style={{ position: "absolute", left: PANEL.x, top: lerp(520, PANEL.y, sp), width: PANEL.w, height: lerp(540, PANEL.h, sp), borderRadius: 32, background: A.bg, border: "1px solid #303137", boxShadow: "0 30px 80px rgba(20,26,18,0.35)", transform: `scale(${panelP})` }} />
      {ROWS.map((a, i) => <Row key={a.id} a={a} i={i} />)}
      <div style={{ opacity: 1 - hookOut }}><HookTitle lines={["Know what's left.", "Before it runs out."]} accent="out" /></div>
      <Pointer
        scale={1.7}
        keys={[
          { x: 930, y: 1000, at: T_MOVE + 8, leave: T_MOVE + 20 },
          { x: 700, y: ROW_TOP + 3 * ROW_H + 30, at: T_MOVE + 50, leave: T_MOVE + 56 },
          { x: 905, y: ROW_TOP + GEMINI * ROW_H + 62, at: T_TAP - 8, click: T_TAP, leave: T_TAP + 30 },
          { x: 930, y: 1000, at: T_TAP + 50 },
        ]}
      />
    </>
  );
};

export const V2Short16Usage: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={f(tl.cues.endcard) + 30}>
      <Demo />
    </Sequence>
  </ShortShell>
);
