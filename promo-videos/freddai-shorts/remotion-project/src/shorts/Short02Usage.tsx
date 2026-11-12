import React, { ReactNode } from "react";
import { Easing, interpolate, Sequence, useCurrentFrame } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { SHORT_TIMELINES } from "./timelines";
import { A, ACCOUNTS, Pop, TrafficLights, UsageRing } from "../ui";
import { Typewriter } from "../text";
import { C, clamp } from "../theme";
import { FONT_BODY, FONT_MONO } from "../fonts";
import type { CSSProperties } from "react";

const tl = SHORT_TIMELINES.usage;
const F = (s: number) => Math.round(s * 30);
const acct = (id: string) => ACCOUNTS.find((a) => a.id === id)!;
const ease = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

// --- camera: keyed (scale, world point shown at the viewport centre), eased between keys ---
type Key = { f: number; sc: number; x: number; y: number };
const camAt = (frame: number, keys: Key[]) => {
  if (frame <= keys[0].f) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    if (frame < keys[i + 1].f) {
      const p = interpolate(frame, [keys[i].f, keys[i + 1].f], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
      const l = (a: number, b: number) => a + (b - a) * p;
      return { f: frame, sc: l(keys[i].sc, keys[i + 1].sc), x: l(keys[i].x, keys[i + 1].x), y: l(keys[i].y, keys[i + 1].y) };
    }
  }
  return keys[keys.length - 1];
};
const VP = { x: 60, y: 180, w: 960, h: 944, bar: 72 };
const CX = VP.w / 2, CY = (VP.h - VP.bar) / 2;
const camStyle = (c: Key): CSSProperties => ({ position: "absolute", left: 0, top: 0, width: VP.w, height: 2400, transformOrigin: "0 0", transform: `translate(${CX - c.sc * c.x}px, ${CY - c.sc * c.y}px) scale(${c.sc})` });

// Freddai dark window (surface #1e241e) cropped to the safe band.
const Viewport: React.FC<{ at: number; out?: number; title: string; children: ReactNode }> = ({ at, out, title, children }) => {
  const frame = useCurrentFrame();
  const o = out === undefined ? 1 : 1 - ease(frame, out, out + 8);
  if (o <= 0) return null;
  return (
    <Pop at={at} y={50} from={0.92} origin="50% 50%" style={{ position: "absolute", left: VP.x, top: VP.y, width: VP.w, height: VP.h, opacity: o }}>
      <div style={{ width: VP.w, height: VP.h, borderRadius: 32, overflow: "hidden", background: "#1e241e", border: "1px solid #404a3b", boxShadow: "0 50px 120px rgba(40,45,35,0.35), 0 12px 30px rgba(40,45,35,0.2)", position: "relative", fontFamily: FONT_BODY }}>
        <div style={{ height: VP.bar, background: "#282f26", borderBottom: "1px solid #404a3b", display: "flex", alignItems: "center", gap: 24, padding: "0 30px" }}>
          <TrafficLights />
          <div style={{ fontSize: 38, fontWeight: 700, color: C.textDark }}>{title}</div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: VP.bar, bottom: 0, overflow: "hidden" }}>{children}</div>
      </div>
    </Pop>
  );
};



// ============ PAIN ============
const WINS = [
  { name: "Claude", at: 0, fig: "5h window: 34%", sub: "weekly 71% · resets 14:20", top: 580, left: 70, w: 940, h: 520 },
  { name: "Codex", at: 3.4, fig: "1,284 / 1,500 msgs", sub: "weekly cap · resets Mon", top: 700, left: 110, w: 860, h: 400 },
  { name: "Gemini", at: 5.9, fig: "62 req · 00:00 UTC", sub: "daily quota", top: 820, left: 150, w: 780, h: 280 },
];
const AppWin: React.FC<{ w: (typeof WINS)[number]; i: number }> = ({ w, i }) => {
  const frame = useCurrentFrame();
  const at = F(w.at);
  const shake = frame >= at && frame < at + 8 ? Math.sin(frame * 2.4) * 5 : 0;
  const inner = (
    <div style={{ width: w.w, height: w.h, borderRadius: 24, overflow: "hidden", background: "#23242a", border: "1px solid #44454e", boxShadow: "0 30px 80px rgba(20,26,18,0.45)", fontFamily: FONT_BODY, transform: `translateX(${shake}px)` }}>
      <div style={{ height: 68, background: "#2c2d34", display: "flex", alignItems: "center", gap: 20, padding: "0 26px", fontSize: 40, fontWeight: 700, color: A.textHi }}><TrafficLights />{w.name}</div>
      <div style={{ padding: "20px 34px", fontFamily: FONT_MONO, color: A.textHi }}>
        <div style={{ fontSize: 52, fontWeight: 700 }}>{at <= 0 ? w.fig : <Typewriter text={w.fig} start={at + 8} cps={30} cursor={false} />}</div>
        <div style={{ fontSize: 36, color: A.muted, marginTop: 6 }}>{w.sub}</div>
        {[0.9, 0.7, 0.8, 0.5].map((x, k) => <div key={k} style={{ height: 22, width: `${x * 100}%`, borderRadius: 11, background: "#33343c", marginTop: 26 }} />)}
      </div>
    </div>
  );
  return at <= 0
    ? <div style={{ position: "absolute", left: w.left, top: w.top }}>{inner}</div>
    : <Pop at={at} y={60} from={0.9} origin="50% 50%" style={{ position: "absolute", left: w.left, top: w.top }}>{inner}</Pop>;
};
const Pain: React.FC = () => (
  <>
    {WINS.map((w, i) => <AppWin key={w.name} w={w} i={i} />)}
    <HookTitle lines={["How much AI", "is left?"]} accent="left" />
  </>
);

// ============ DEMO ============
const DEMO = F(tl.cues.demo);
const ROW_H = 204, ROW_GAP = 14;
const ROWS = [acct("codex-work"), acct("claude-max"), acct("gemini"), acct("grok")];
const Rows: React.FC = () => {
  const frame = useCurrentFrame();
  const amberAt = 190, pushAt = 255, pulseAt = 272;
  const rowCY = (i: number) => 6 + i * (ROW_H + ROW_GAP) + ROW_H / 2;
  const cam = camAt(frame, [
    { f: 0, sc: 1, x: CX, y: CY },
    { f: pushAt, sc: 1, x: CX, y: CY },
    { f: pushAt + 24, sc: 1.12, x: 480, y: rowCY(1) },
  ]);
  const pulse = frame >= pulseAt ? Math.max(0, Math.sin(((frame - pulseAt) / 22) * Math.PI)) : 0;
  return (
    <div style={camStyle(cam)}>
      {ROWS.map((a, i) => {
        const at = 4 + i * 4;
        const fill = ease(frame, at + 4, at + 50);
        const isClaude = a.id === "claude-max";
        const left = isClaude ? Math.round(interpolate(frame, [amberAt - 20, amberAt + 24], [26, 9], clamp)) : a.left;
        const hot = isClaude && left <= 10;
        const shown = Math.round(left * fill);
        const showReset = frame >= 110 + i * 8;
        const p = isClaude ? pulse : 0;
        return (
          <Pop key={a.id} at={at} y={30} from={0.94} origin="50% 50%" style={{ position: "absolute", left: 40, top: 6 + i * (ROW_H + ROW_GAP), width: 880 }}>
            <div style={{ height: ROW_H, borderRadius: 26, display: "flex", alignItems: "center", gap: 28, padding: "0 30px", boxSizing: "border-box", background: hot ? `rgba(233,182,103,${0.12 + 0.12 * p})` : "#282f26", border: `2px solid ${hot ? A.amber : "#404a3b"}`, transform: `scale(${1 + 0.04 * p})`, fontFamily: FONT_BODY }}>
              <UsageRing remaining={left} color={a.color} size={140} fill={fill}><span style={{ fontSize: 52, fontWeight: 800, color: hot ? A.amber : C.textDark }}>{a.glyph}</span></UsageRing>
              <div style={{ flex: 1, lineHeight: 1.25 }}>
                <div style={{ fontSize: 40, fontWeight: 700, color: C.textDark }}>{a.provider} · {a.label}</div>
                <div style={{ fontSize: 36, color: "#98a08c", opacity: showReset ? 1 : 0, transform: `translateY(${showReset ? 0 : 8}px)` }}>resets in {a.reset}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 62, fontWeight: 800, color: hot ? A.amber : "#b9c99a", lineHeight: 1 }}>{shown}%<div style={{ fontSize: 36, fontWeight: 600, color: hot ? A.amber : "#98a08c", marginTop: 4 }}>left</div></div>
            </div>
          </Pop>
        );
      })}
    </div>
  );
};
const Demo: React.FC = () => (
  <Viewport at={0} title="Freddai · Usage">
    <Rows />
  </Viewport>
);

export const Short02Usage: React.FC = () => {
  const turnEnd = F(tl.cues.turn + TURN_WIPE_SECONDS);
  return (
    <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
      <Sequence from={0} durationInFrames={turnEnd + 1}><Pain /></Sequence>
      <Sequence from={DEMO} durationInFrames={F(tl.cues.endcard) - DEMO + 12}><Demo /></Sequence>
      <Turn at={tl.cues.turn} />
    </ShortShell>
  );
};
