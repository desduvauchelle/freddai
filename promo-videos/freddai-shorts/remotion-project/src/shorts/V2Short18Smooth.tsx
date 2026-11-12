import React from "react";
import { Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { EndCard } from "./EndCard";
import { V2_TIMELINES } from "./timelinesV2";
import { A, ACCOUNTS, Icon, Pointer } from "../ui";
import type { Account } from "../ui";
import { FONT_BODY } from "../fonts";
import { clamp } from "../theme";

const tl = V2_TIMELINES.smooth;
const f = (s: number) => Math.round(s * 30);
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: e });
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const acc = (id: string) => ACCOUNTS.find((a) => a.id === id)!;

const CLAUDE = acc("claude-work"), CODEX = acc("codex-personal"), GEMINI = acc("gemini"), GROK = acc("grok");
const FOUR = [CLAUDE, CODEX, GEMINI, GROK];
const T_SEP = f(tl.vo[1].start); // 18-02 different apps
const T_HOP = f(tl.vo[2].start); // 18-03 no hopping
const T_DEMO = f(tl.cues.demo); // 18-04 one desk
const T_END = f(tl.cues.endcard);

// ---------------- scene 1: four provider chips (frame 0) ----------------
const CHIP_PULSE = [f(0.3), f(1.2), f(2.1), f(2.95)]; // "Claude. Codex. Gemini. Grok."
const Chip: React.FC<{ a: Account; i: number }> = ({ a, i }) => {
  const frame = useCurrentFrame();
  const sep = ease(frame, T_SEP, T_SEP + 26, 0, 1, Easing.out(Easing.cubic));
  const col = i % 2, row = Math.floor(i / 2);
  const w = 460, h = lerp(190, 250, sep);
  const x = lerp(64 + col * (w + 32), 60 + col * (w + 40), sep);
  const y = lerp(580 + row * (190 + 32), 330 + row * (250 + 70), sep);
  const pulse = interpolate(frame, [CHIP_PULSE[i], CHIP_PULSE[i] + 7, CHIP_PULSE[i] + 26], [0, 1, 0], clamp);
  const tilt = sep * (col === 0 ? -1 : 1) * (row === 0 ? 2.2 : -2.2);
  const out = ease(frame, T_DEMO - 8, T_DEMO + 2);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, boxSizing: "border-box", borderRadius: 30, background: A.bg, border: `3px solid ${pulse > 0.02 ? a.color : "#303137"}`, boxShadow: `0 24px 60px rgba(20,26,18,0.3), 0 0 ${50 * pulse}px ${a.color}66`, transform: `rotate(${tilt}deg) scale(${(1 + 0.05 * pulse) * (1 - 0.12 * out)})`, opacity: 1 - out, display: "flex", flexDirection: "column", justifyContent: "center", fontFamily: FONT_BODY }}>
      <div style={{ position: "absolute", left: 28, top: 20, display: "flex", gap: 9, opacity: sep }}>
        {["#e5646a", "#e9b667", "#7fd0a0"].map((c) => <span key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c, opacity: 0.8 }} />)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "0 28px", marginTop: sep * 22 }}>
        <div style={{ width: 84, height: 84, borderRadius: 24, flexShrink: 0, background: `${a.color}26`, border: `2px solid ${a.color}aa`, display: "grid", placeItems: "center", color: a.color, fontSize: 46, fontWeight: 800 }}>{a.glyph}</div>
        <div style={{ fontSize: 48, fontWeight: 700, color: A.textHi, whiteSpace: "nowrap" }}>{a.provider}</div>
      </div>
    </div>
  );
};

const HOP = [
  { x: 290, y: 470 }, { x: 790, y: 790 }, { x: 790, y: 470 }, { x: 290, y: 790 },
];
const Chips: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame > T_DEMO + 4) return null;
  const hookOut = ease(frame, f(tl.vo[1].start) - 9, f(tl.vo[1].start) - 1);
  return (
    <>
      {FOUR.map((a, i) => <Chip key={a.id} a={a} i={i} />)}
      <Pointer scale={1.7} keys={[
        { ...HOP[0], at: T_HOP + 4, leave: T_HOP + 16 },
        { ...HOP[1], at: T_HOP + 30, click: T_HOP + 32, leave: T_HOP + 40 },
        { ...HOP[2], at: T_HOP + 56, click: T_HOP + 58, leave: T_HOP + 64 },
        { ...HOP[3], at: T_HOP + 80, click: T_HOP + 82, leave: T_HOP + 90 },
      ]} />
      <div style={{ opacity: 1 - hookOut }}>{frame < T_SEP && <HookTitle lines={["Four agents.", "One smooth desk."]} accent="smooth" />}</div>
    </>
  );
};

// ---------------- scene 2: one desk, new thread + thread list ----------------
type Send = { prompt: string; project: string; projAt: number; flips: { t: number; a: Account }[]; type: number; send: number };
const SENDS: Send[] = [
  { prompt: "Fix the checkout redirect", project: "Website", type: 11.0, projAt: 11.75, flips: [[12.35, CLAUDE], [12.7, CODEX], [13.05, GEMINI], [13.4, GROK], [13.75, CLAUDE]].map(([t, a]) => ({ t: t as number, a: a as Account })), send: 14.25 },
  { prompt: "Add invoice export", project: "API", type: 19.85, projAt: 20.5, flips: [{ t: 20.85, a: CODEX }], send: 21.45 },
  { prompt: "Update the app icons", project: "Mobile app", type: 22.5, projAt: 22.7, flips: [{ t: 22.85, a: GEMINI }], send: 23.15 },
  { prompt: "Summarize today's commits", project: "Website", type: 23.35, projAt: 23.45, flips: [{ t: 23.55, a: GROK }], send: 23.85 },
];
const RESET = 14; // frames after send until the composer is idle again

const Roll: React.FC<{ items: { t: number; node: React.ReactNode }[]; fallback: React.ReactNode }> = ({ items, fallback }) => {
  const frame = useCurrentFrame();
  let idx = -1;
  items.forEach((it, i) => { if (frame >= it.t) idx = i; });
  const cur = idx >= 0 ? items[idx] : null;
  const prev = idx > 0 ? items[idx - 1] : idx === 0 ? { node: fallback } : null;
  const p = cur ? ease(frame, cur.t, cur.t + 7, 0, 1, Easing.out(Easing.cubic)) : 1;
  return (
    <div style={{ position: "relative", overflow: "hidden", height: 54, flex: 1, minWidth: 0 }}>
      {prev && p < 1 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 14, transform: `translateY(${-p * 54}px)`, opacity: 1 - p }}>{prev.node}</div>}
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 14, transform: `translateY(${(1 - p) * 54}px)`, opacity: p }}>{cur ? cur.node : fallback}</div>
    </div>
  );
};

const Dot: React.FC<{ c: string }> = ({ c }) => <span style={{ width: 18, height: 18, borderRadius: 9, background: c, flexShrink: 0 }} />;
const ChipBox: React.FC<{ w: number; glow: number; children: React.ReactNode }> = ({ w, glow, children }) => (
  <div style={{ width: w, height: 84, boxSizing: "border-box", borderRadius: 20, padding: "0 22px", display: "flex", alignItems: "center", gap: 14, border: `2px solid ${glow > 0.05 ? "#8c9fce" : A.input}`, background: `rgba(134,168,212,${0.16 * glow})`, fontSize: 36, color: A.textHi, whiteSpace: "nowrap", overflow: "hidden" }}>{children}</div>
);

const Composer: React.FC<{ y: number }> = ({ y }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // active send = first not yet reset
  const k = SENDS.findIndex((s) => frame < f(s.send) + RESET);
  const s = SENDS[Math.max(0, k === -1 ? SENDS.length - 1 : k)];
  const sendF = f(s.send);
  const afterSend = frame >= sendF;
  const typed = afterSend ? "" : s.prompt.slice(0, Math.floor(ease(frame, f(s.type), f(s.type) + Math.max(8, Math.min(20, f(s.projAt - s.type) - 4)), 0, s.prompt.length, Easing.linear)));
  const projOn = !afterSend && frame >= f(s.projAt);
  const flips = afterSend ? [] : s.flips.map((fl) => ({ t: f(fl.t), node: (<><Dot c={fl.a.color} />{fl.a.provider} · {fl.a.label}</>) }));
  const projGlow = projOn ? interpolate(frame, [f(s.projAt), f(s.projAt) + 4, f(s.projAt) + 18], [0, 1, 0], clamp) : 0;
  const lastFlip = s.flips[s.flips.length - 1].t;
  const agentGlow = afterSend ? 0 : s.flips.reduce((g, fl) => Math.max(g, interpolate(frame, [f(fl.t), f(fl.t) + 4, f(fl.t) + 14], [0, 1, 0], clamp)), 0);
  const sendP = frame >= sendF - 6 ? spring({ frame: frame - (sendF - 6), fps, config: { damping: 12, stiffness: 220, mass: 0.6 } }) : 0;
  const press = frame >= sendF && frame < sendF + 10 ? interpolate(frame - sendF, [0, 3, 9], [1, 0.84, 1], clamp) : 1;
  const ready = !afterSend && frame >= f(lastFlip) + 4;
  const caret = !afterSend && typed.length < s.prompt.length + 1 && frame % 16 < 10;
  const pop = spring({ frame: frame - (T_DEMO + 4), fps, config: { damping: 15, stiffness: 170, mass: 0.8 } });
  return (
    <div style={{ position: "absolute", left: 60, top: y, width: 960, boxSizing: "border-box", padding: "26px 30px 30px", borderRadius: 32, background: A.bg, border: "1px solid #303137", boxShadow: "0 30px 80px rgba(20,26,18,0.35)", fontFamily: FONT_BODY, opacity: interpolate(pop, [0, 0.5], [0, 1], clamp), transform: `translateY(${interpolate(pop, [0, 1], [30, 0])}px) scale(${interpolate(pop, [0, 1], [0.96, 1])})` }}>
      <div style={{ fontSize: 36, color: A.muted, fontWeight: 600 }}>New thread</div>
      <div style={{ height: 84, marginTop: 8, display: "flex", alignItems: "center", fontSize: 44, fontWeight: 500, color: typed ? A.textHi : A.subtle, whiteSpace: "nowrap" }}>
        {typed || "What should we work on?"}{caret && typed && <span style={{ display: "inline-block", width: 3, height: 46, background: A.textHi, marginLeft: 3 }} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
        <ChipBox w={290} glow={projGlow}>
          <Dot c={projOn ? ({ Website: "#9a86e8", API: "#e0a458", "Mobile app": "#6fc2a0" } as Record<string, string>)[s.project] : A.input} />
          <span style={{ color: projOn ? A.textHi : A.subtle, flex: 1, overflow: "hidden" }}>{projOn ? s.project : "Project"}</span>
          <Icon name="chevron" size={28} color={A.muted} />
        </ChipBox>
        <ChipBox w={440} glow={agentGlow}>
          <Roll items={flips} fallback={<span style={{ color: A.subtle }}>Agent</span>} />
          <Icon name="chevron" size={28} color={A.muted} />
        </ChipBox>
        <div style={{ marginLeft: "auto", width: 84, height: 84, borderRadius: 42, display: "grid", placeItems: "center", background: ready ? "#e1e1e7" : "#3a3b43", color: ready ? "#202126" : "#888994", transform: `scale(${press * (1 + 0.06 * Math.sin(sendP * Math.PI))})` }}>
          <Icon name="arrowUp" size={44} stroke={2.4} />
        </div>
      </div>
    </div>
  );
};

const HEAD = 64, ROWH = 102;
const Threads: React.FC<{ top: number }> = ({ top }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sp = (i: number, cfg = { damping: 15, stiffness: 190, mass: 0.8 }) => {
    const at = f(SENDS[i].send) + 4;
    return frame < at ? 0 : spring({ frame: frame - at, fps, config: cfg });
  };
  const panel = spring({ frame: frame - (f(SENDS[0].send) + 2), fps, config: { damping: 16, stiffness: 160, mass: 0.9 } });
  const rows = [
    { title: "Fix the checkout redirect", a: CLAUDE, p: "Website" },
    { title: "Add invoice export", a: CODEX, p: "API" },
    { title: "Update the app icons", a: GEMINI, p: "Mobile app" },
    { title: "Summarize today's commits", a: GROK, p: "Website" },
  ];
  return (
    <div style={{ position: "absolute", left: 60, top, width: 960, height: HEAD + 4 * ROWH + 8, borderRadius: 32, background: A.bg, border: "1px solid #303137", boxShadow: "0 30px 80px rgba(20,26,18,0.3)", overflow: "hidden", fontFamily: FONT_BODY, opacity: interpolate(panel, [0, 0.5], [0, 1], clamp), transform: `translateY(${interpolate(panel, [0, 1], [40, 0])}px)` }}>
      <div style={{ height: HEAD, padding: "0 32px", display: "flex", alignItems: "center", fontSize: 36, fontWeight: 600, color: A.muted, borderBottom: `1px solid ${A.border}` }}>Threads</div>
      {rows.map((r, i) => {
        const p = sp(i);
        if (p <= 0) return null;
        const pushed = rows.reduce((sum, _, j) => (j > i ? sum + sp(j) : sum), 0);
        const starting = frame < f(SENDS[i].send) + 4 + 14;
        const col = starting ? A.blue : A.running;
        const beat = 0.8 + 0.2 * Math.sin(frame / 5 + i);
        const shimmer = ((frame * 6 + i * 200) % 1100) - 140;
        return (
          <div key={i} style={{ position: "absolute", left: 0, right: 0, top: HEAD + pushed * ROWH, height: ROWH, boxSizing: "border-box", padding: "0 32px", display: "flex", alignItems: "center", gap: 22, borderBottom: `1px solid ${A.border}`, background: p < 1 ? `rgba(134,168,212,${0.16 * (1 - p)})` : undefined, opacity: interpolate(p, [0, 0.4], [0, 1], clamp), transform: `scale(${interpolate(p, [0, 1], [0.96, 1])})`, overflow: "hidden" }}>
            <span style={{ width: 20, height: 20, borderRadius: 10, background: col, opacity: beat, boxShadow: `0 0 ${14 * beat}px ${col}`, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
              <div style={{ fontSize: 40, fontWeight: 700, color: A.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div>
              <div style={{ fontSize: 36, color: A.muted, display: "flex", alignItems: "center", gap: 12, whiteSpace: "nowrap" }}>
                <span>{starting ? "Starting…" : "Running"}</span><span style={{ width: 13, height: 13, borderRadius: 7, background: r.a.color }} /><span>{r.a.provider}</span>
              </div>
            </div>
            <div style={{ position: "absolute", left: shimmer, bottom: 0, width: 140, height: 4, borderRadius: 2, background: `linear-gradient(90deg, transparent, ${r.a.color}, transparent)`, opacity: starting ? 0 : 0.9 }} />
          </div>
        );
      })}
    </div>
  );
};

const Desk: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < T_DEMO - 2) return null;
  const up = ease(frame, f(SENDS[0].send) - 2, f(SENDS[0].send) + 22, 0, 1, Easing.out(Easing.cubic));
  return (
    <>
      <Threads top={530} />
      <Composer y={lerp(420, 200, up)} />
    </>
  );
};

export const V2Short18Smooth: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={T_END + 30}>
      <Chips />
      <Desk />
    </Sequence>
  </ShortShell>
);
