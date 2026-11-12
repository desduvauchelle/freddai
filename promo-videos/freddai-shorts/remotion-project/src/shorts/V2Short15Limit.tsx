import React from "react";
import { Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { TerminalPane } from "./OldWay";
import { V2_TIMELINES } from "./timelinesV2";
import { A, ACCOUNTS, Icon, Pointer, Pop, UsageRing } from "../ui";
import { FONT_BODY, FONT_MONO } from "../fonts";
import { clamp } from "../theme";
import { shakeOffset } from "../fx";

const tl = V2_TIMELINES.limit;
const f = (s: number) => Math.round(s * 30);
const WIPE_END = f(tl.cues.turn + TURN_WIPE_SECONDS);
const DEMO = f(tl.cues.demo);
const END = f(tl.cues.endcard);
const L = (s: number) => f(s) - DEMO;
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: e });

const MAX = ACCOUNTS[2];
const WORK = ACCOUNTS[3];
const PICKER = [MAX, WORK, ACCOUNTS[0]];

// ---------------- old way: terminal hits the wall ----------------
const WallBanner: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hit = f(0.35);
  const p = spring({ frame: frame - hit, fps, config: { damping: 13, stiffness: 220, mass: 0.7 } });
  const beat = (a: number, b: number) => Math.sin(Math.PI * ease(frame, f(a), f(b)));
  const glow = Math.max(beat(3.45, 4.6), beat(6.0, 7.1));
  const sh = shakeOffset(frame, frame >= hit && frame < hit + 8 ? 7 : 0, "lim");
  if (frame < hit) return null;
  return (
    <div style={{ position: "absolute", left: 94, top: 904, width: 892, height: 140, borderRadius: 18, background: "#3d2a0d", border: "2px solid #e9b667", display: "flex", alignItems: "center", gap: 24, padding: "0 30px", boxSizing: "border-box",
      boxShadow: `0 0 ${50 * glow}px rgba(233,182,103,${0.55 * glow})`, transform: `translate(${sh.x}px, ${sh.y}px) scale(${interpolate(p, [0, 1], [0.9, 1]) + 0.025 * glow})`, opacity: Math.min(1, p * 2), fontFamily: FONT_BODY }}>
      <Icon name="alert" size={58} color="#e9b667" stroke={2} />
      <div style={{ lineHeight: 1.2 }}>
        <div style={{ fontSize: 42, fontWeight: 700, color: "#f6d9a5" }}>Usage limit reached</div>
        <div style={{ fontSize: 38, color: "#e9b667" }}>Resets in 4h 52m</div>
      </div>
    </div>
  );
};

// ---------------- demo: one thread, account switched mid-stream ----------------
const SC = 1.8, PW = 540;
const STREAM_H = 360;
type Line = { t: string; c: string; at?: number };
const OLD_LINES: Line[] = [
  { t: "> stream the invoice export", c: A.textHi },
  { t: "● Read(src/billing/export.ts)", c: "#9bb7e8" },
  { t: "● Edit(src/billing/export.ts) +42", c: "#9bd3ad" },
  { t: "● Bash(pnpm test billing)", c: "#9bb7e8" },
  { t: "   ✓ 37 passed  ✗ 1 failed", c: "#d9d9df" },
];
const NEW_LINES: Line[] = [
  { t: "● Edit(src/billing/stream.ts) +58", c: "#9bd3ad", at: 11.7 },
  { t: "● Bash(pnpm test billing)", c: "#9bb7e8", at: 12.9 },
  { t: "   ✓ 41 passed", c: "#d9d9df", at: 14.0 },
  { t: "● Edit(src/billing/export.ts) +6", c: "#9bd3ad", at: 15.1 },
  { t: "✓ Done", c: "#7fd0a0", at: 19.4 },
];

const Chip: React.FC<{ a: typeof MAX; glow: number }> = ({ a, glow }) => (
  <div style={{ height: 46, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", borderRadius: 10, border: `1px solid ${glow > 0.05 ? A.running : A.input}`, background: `rgba(127,208,160,${0.16 * glow})`, fontSize: 21, fontWeight: 600, color: A.textHi, whiteSpace: "nowrap" }}>
    <UsageRing remaining={a.left} color={a.color} size={30} />
    {a.provider} · {a.label}
    <Icon name="chevron" size={18} color={A.muted} />
  </div>
);

const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const OPEN = L(9.5);
  const open = spring({ frame: frame - OPEN, fps, config: { damping: 16, stiffness: 150, mass: 0.7 } });
  const closeP = ease(frame, L(10.85), L(11.0));
  const pickerOpen = frame >= OPEN ? open * (1 - closeP) : 0;
  const hover = frame >= L(10.2) && frame < L(10.85) ? 1 : null;
  const switched = frame >= L(10.95);
  const acct = switched ? WORK : MAX;
  const bannerH = 1 - ease(frame, L(11.0), L(11.5));
  const bannerOn = bannerH > 0.001;
  const chipGlow = Math.max(Math.sin(Math.PI * ease(frame, L(8.75), L(9.4))) * 0, Math.sin(Math.PI * ease(frame, L(17.5), L(18.9))));
  const projGlow = Math.sin(Math.PI * ease(frame, L(16.1), L(17.0)));
  const thrGlow = Math.sin(Math.PI * ease(frame, L(16.8), L(17.7)));
  const done = frame >= f(19.4) - DEMO;
  const shown = NEW_LINES.filter((l) => frame >= f(l.at!) - DEMO);
  const working = switched && !done;
  const dots = ".".repeat(1 + (Math.floor(frame / 8) % 3));
  const contentH = 32 * OLD_LINES.length + 76 * bannerH + NEW_LINES.reduce((h, l) => h + 32 * ease(frame, f(l.at!) - DEMO, f(l.at!) - DEMO + 8), 0) + (working ? 32 : 0);
  const contentOff = Math.max(0, contentH - (STREAM_H - 24));
  const lineStyle = (c: string): React.CSSProperties => ({ height: 32, fontFamily: FONT_MONO, fontSize: 20, color: c, whiteSpace: "pre", display: "flex", alignItems: "center" });

  return (
    <Pop at={0} y={40} from={0.96} origin="50% 0%" style={{ position: "absolute", left: 54, top: 190, width: 972 }}>
      <div style={{ height: 444 * SC, borderRadius: 28, background: A.bg, border: "1px solid #303137", boxShadow: "0 30px 80px rgba(20,26,18,0.3)", overflow: "hidden" }}>
        <div style={{ width: PW, height: 444, transform: `scale(${SC})`, transformOrigin: "0 0", position: "relative", fontFamily: FONT_BODY }}>
          {/* header */}
          <div style={{ height: 84, display: "flex", alignItems: "center", padding: "0 20px", borderBottom: `1px solid ${A.border}`, gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: A.textHi, display: "inline-block", whiteSpace: "nowrap", padding: "0 6px", margin: "0 -6px", borderRadius: 6, background: `rgba(127,208,160,${0.18 * thrGlow})` }}>Invoice export</div>
              <div style={{ fontSize: 21, color: A.muted, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ padding: "0 6px", margin: "0 -6px", borderRadius: 6, background: `rgba(127,208,160,${0.18 * projGlow})` }}>Website</span>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: done ? A.done : switched ? A.running : A.amber }} />
                <span style={{ whiteSpace: "nowrap" }}>{done ? "Done" : switched ? "Running" : "Limit reached"}</span>
              </div>
            </div>
            <Chip a={acct} glow={chipGlow} />
          </div>
          {/* stream */}
          <div style={{ position: "absolute", left: 0, right: 0, top: 84, height: STREAM_H, overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 20, right: 20, top: 12, transform: `translateY(${-contentOff}px)` }}>
              {OLD_LINES.map((l, i) => <div key={i} style={lineStyle(l.c)}>{l.t}</div>)}
              {bannerOn && (
                <div style={{ height: 76 * bannerH, overflow: "hidden", opacity: bannerH }}>
                  <div style={{ marginTop: 8, height: 60, borderRadius: 10, background: "#3d2a0d", border: "2px solid #e9b667", display: "flex", alignItems: "center", gap: 12, padding: "0 16px", fontSize: 20, fontWeight: 600, color: "#f6d9a5", whiteSpace: "nowrap", boxSizing: "border-box" }}>
                    <Icon name="alert" size={28} color="#e9b667" stroke={2} />Usage limit reached · resets in 4h 52m
                  </div>
                </div>
              )}
              {shown.map((l, i) => (
                <Pop key={i} at={f(l.at!) - DEMO} y={10} from={0.98} origin="0% 50%"><div style={lineStyle(l.c)}>{l.t}</div></Pop>
              ))}
              {working && <div style={{ ...lineStyle("#8f9099"), opacity: ease(frame, L(11.3), L(11.6)) }}>✻ Working{dots}</div>}
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 28, background: `linear-gradient(${A.bg}, transparent)` }} />
          </div>
          {/* picker popover */}
          {pickerOpen > 0 && (
            <div style={{ position: "absolute", right: 20, top: 76, width: 440, borderRadius: 12, background: "#24252a", border: `1px solid ${A.input}`, boxShadow: "0 30px 70px rgba(0,0,0,0.55)", padding: 6, opacity: interpolate(pickerOpen, [0, 0.6], [0, 1], clamp), transform: `translateY(${interpolate(pickerOpen, [0, 1], [-10, 0])}px)`, zIndex: 5 }}>
              {PICKER.map((a, i) => (
                <div key={a.id} style={{ height: 60, display: "flex", alignItems: "center", gap: 12, padding: "0 12px", borderRadius: 8, fontSize: 21, color: A.textHi, background: hover === i ? "#34353d" : "transparent" }}>
                  <UsageRing remaining={a.left} color={a.color} size={34} />
                  <span style={{ whiteSpace: "nowrap" }}>{a.provider} · {a.label}</span>
                  <span style={{ marginLeft: "auto", fontSize: 21, color: a.left <= 10 ? A.amber : A.muted }}>{a.left}%</span>
                </div>
              ))}
            </div>
          )}
          {frame < L(11.4) && <Pointer scale={0.8} keys={[
            { x: 300, y: 300, at: L(9.2), leave: L(9.3) },
            { x: 420, y: 44, at: L(9.45), click: L(9.7), leave: L(10.0) },
            { x: 330, y: 172, at: L(10.25), click: L(10.6), leave: L(11.0) },
          ]} />}
        </div>
      </div>
    </Pop>
  );
};

export const V2Short15Limit: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={WIPE_END}>
      <TerminalPane at={0} banner={false} height={480} lineEvery={0.45} style={{ position: "absolute", left: 70, top: 590 }} />
      <WallBanner />
      <HookTitle lines={["Limit hit.", "Mid-flow."]} accent="Mid-flow" />
    </Sequence>
    <Sequence from={DEMO} durationInFrames={END - DEMO + 30}>
      <Demo />
    </Sequence>
    <Turn at={tl.cues.turn} />
  </ShortShell>
);
