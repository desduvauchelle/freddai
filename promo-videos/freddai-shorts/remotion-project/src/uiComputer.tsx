import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, clamp } from "./theme";
import { FONT_DISPLAY, FONT_MONO } from "./fonts";
import { Words } from "./text";
import { Glow } from "./fx";
import { CUE, T } from "./timeline";

// Computer-use chapter: a generic Mac desktop. The agent (Freddai Computer helper) presses a button in a BACKGROUND window
// through the accessibility API, with its own visible cursor, while the user's focused app, caret and pointer stay put.
// Facts: crates/core/src/computer_use.rs, apps/native/computer-use/main.swift (AgentCursor: lavender arrow, label "Freddai · <action> · <app>"),
// docs/spec.md "Background accessibility and visible agent cursor".

const ACCENT = "#c2a6ff"; // AgentCursorView accent (0.76, 0.65, 1.0)
const PROVIDERS = [
  { name: "Codex", c: "#9ad1b0" }, { name: "Claude Code", c: "#e0a47c" }, { name: "Gemini", c: "#8fb0ff" }, { name: "Grok", c: "#e8e6dc" },
];

const win = (active: boolean): React.CSSProperties => ({
  position: "absolute", borderRadius: 18, overflow: "hidden", background: active ? "#f6f5f1" : "#efeee9",
  boxShadow: active ? "0 40px 100px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.25)" : "0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.2)", fontFamily: FONT,
});
const Lights: React.FC<{ active: boolean }> = ({ active }) => (
  <div style={{ display: "flex", gap: 10 }}>
    {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 16, height: 16, borderRadius: 8, background: active ? c : "#cfcec8" }} />)}
  </div>
);
const TitleBar: React.FC<{ active: boolean; title: string }> = ({ active, title }) => (
  <div style={{ height: 52, display: "flex", alignItems: "center", padding: "0 20px", background: active ? "#e4e2dc" : "#ebeae5", borderBottom: "1px solid #d2d0c8" }}>
    <Lights active={active} />
    <div style={{ marginLeft: 22, fontSize: 21, fontWeight: 600, color: active ? "#2a2a28" : "#9b9a94" }}>{title}</div>
  </div>
);

const USER_TEXT = "Notes for Thursday. Move the invoice export to the new template, then check the totals again before sending anything to the client. ";

const MacArrow: React.FC<{ fill: string; stroke: string; size?: number }> = ({ fill, stroke, size = 46 }) => (
  <svg width={size} height={size * 1.4} viewBox="0 0 16 22" style={{ overflow: "visible" }}>
    <path d="M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z" fill={fill} stroke={stroke} strokeWidth={1.3} strokeLinejoin="round" />
  </svg>
);

const TOOL_LINES: { at: number; fn: string; arg: string; res: string }[] = [
  { at: 73.2, fn: "computer_windows", arg: "", res: "3 windows" },
  { at: 74.5, fn: "computer_observe", arg: "window 2", res: "14 elements" },
  { at: 75.7, fn: "computer_action", arg: "hover", res: "agent cursor" },
  { at: CUE.background, fn: "computer_action", arg: "press · element 9", res: "ok" },
];

export const ComputerBody: React.FC<{ t: number }> = ({ t }) => {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const f = (abs: number) => Math.round((abs - T.computer) * fps);
  const sp = (abs: number, cfg = { damping: 16, stiffness: 150, mass: 0.8 }) => spring({ frame: frame - f(abs), fps, config: cfg });
  const enter = sp(T.computer + 0.05, { damping: 20, stiffness: 120, mass: 1 });

  // slogan moves from centre to a header once the desktop comes into focus
  const m = sp(CUE.macWindow, { damping: 18, stiffness: 120, mass: 0.9 });
  const dim = interpolate(m, [0, 1], [0.62, 0]);
  const sloganFade = interpolate(t, [CUE.background + 3.2, CUE.background + 4.2], [1, 0], clamp);
  const sloganY = interpolate(m, [0, 1], [0, -440]);
  const sloganS = interpolate(m, [0, 1], [1, 0.46]);

  // windows
  const wB = sp(T.computer + 0.2), wF = sp(T.computer + 0.35);
  // agent cursor path (stage px): from the Freddai card edge, over the row, onto the button
  const BTN = { x: 1205, y: 800 }, ROW = { x: 1000, y: 540 }, START = { x: 1380, y: 660 };
  const seg = (a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const k1 = seg(CUE.macWindow + 0.2, 74.9), k2 = seg(75.5, CUE.background - 0.25);
  const cursorPos = { x: START.x + (ROW.x - START.x) * k1 + (BTN.x - ROW.x) * k2, y: START.y + (ROW.y - START.y) * k1 + (BTN.y - ROW.y) * k2 };
  const cursorIn = interpolate(t, [CUE.macWindow + 0.1, CUE.macWindow + 0.5], [0, 1], clamp);
  const pressF = Math.round((t - CUE.background) * fps);
  const clicking = pressF >= 0 && pressF < 14;
  const pressed = t >= CUE.background;
  const action = pressed ? "press" : "hover";
  const label = `Freddai · ${action} · Reports`;
  const done = interpolate(t, [CUE.background + 0.15, CUE.background + 0.45], [0, 1], clamp);

  // user typing in the foreground editor never stops
  const typed = Math.max(0, Math.floor((t - (CUE.macWindow - 1.2)) * 13));
  const caretOn = Math.floor(frame / 15) % 2 === 0;

  const card = sp(CUE.macWindow + 0.6);
  const provIn = (i: number) => sp(73.0 + i * 0.28, { damping: 14, stiffness: 190, mass: 0.7 });

  return (
    <AbsoluteFill style={{ background: "#141a16", opacity: Math.min(1, enter * 1.6) }}>
      {/* desktop wallpaper */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 30% 20%, #2f4332 0%, #1b251e 55%, #111713 100%)" }} />
      <Glow x={1500} y={900} color="#4d613d" size={1000} opacity={0.4} drift={1} />
      {/* menu bar: the active app name never changes */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 44, background: "rgba(20,24,20,0.72)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", gap: 34, padding: "0 28px", fontFamily: FONT, fontSize: 22, color: "#f0f1e7" }}>
        <span style={{ fontSize: 26 }}></span><b>Editor</b><span style={{ opacity: 0.8 }}>File</span><span style={{ opacity: 0.8 }}>Edit</span><span style={{ opacity: 0.8 }}>View</span><span style={{ opacity: 0.8 }}>Window</span>
        <span style={{ marginLeft: "auto", opacity: 0.85 }}>Thu 9:41 AM</span>
      </div>

      {/* background window: Reports (not focused) */}
      <div style={{ ...win(false), left: 650, top: 260, width: 680, height: 600, opacity: wB, transform: `translateY(${(1 - wB) * 30}px)` }}>
        <TitleBar active={false} title="Reports — Q4 summary" />
        <div style={{ padding: "26px 34px" }}>
          <div style={{ fontSize: 30, fontWeight: 700, color: "#3a3a36" }}>Quarterly report</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 18, height: 190, marginTop: 28 }}>
            {[0.5, 0.75, 0.6, 0.9, 0.7, 0.55].map((h, i) => <div key={i} style={{ flex: 1, height: `${h * 100}%`, borderRadius: 8, background: i === 3 ? "#7e9a68" : "#cfd3c4" }} />)}
          </div>
          <div style={{ marginTop: 28, display: "grid", gap: 14 }}>
            {[0.9, 0.7, 0.8].map((w, i) => <div key={i} style={{ height: 16, width: `${w * 100}%`, borderRadius: 8, background: "#dedcd4" }} />)}
          </div>
        </div>
        <div style={{ position: "absolute", right: 34, bottom: 28, display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ fontSize: 22, color: "#3f7a45", fontWeight: 650, opacity: done }}>Saved to Documents</div>
          <div style={{ padding: "14px 22px", borderRadius: 12, border: "1.5px solid #c8c6bd", fontSize: 22, fontWeight: 600, color: "#55554f", background: "#f7f6f2" }}>Share</div>
          <div style={{ position: "relative", padding: "14px 26px", borderRadius: 12, fontSize: 22, fontWeight: 650, minWidth: 160, textAlign: "center", color: "#fff", background: pressed ? mixC(done) : "#4d6bd6", transform: clicking ? "scale(0.96)" : "scale(1)" }}>
            {pressed && done > 0.5 ? "Exported ✓" : "Export PDF"}
          </div>
        </div>
      </div>

      {/* foreground window: the user's own editor, focused, typing continues */}
      <div style={{ ...win(true), left: 100, top: 200, width: 560, height: 700, opacity: wF, transform: `translateY(${(1 - wF) * 30}px)` }}>
        <TitleBar active title="meeting-notes.txt" />
        <div style={{ padding: "34px 40px", fontSize: 26, lineHeight: 1.5, color: "#2a2a28", fontFamily: FONT_MONO }}>
          {(USER_TEXT.repeat(3)).slice(0, typed)}
          <span style={{ display: "inline-block", width: 3, height: 34, background: "#2a2a28", verticalAlign: "-6px", opacity: caretOn ? 1 : 0 }} />
        </div>
      </div>
      {/* the user's own pointer: parked, never moves */}
      <div style={{ position: "absolute", left: 520, top: 780, opacity: wF }}><MacArrow fill="#111" stroke="#fff" /></div>

      {/* Freddai card: same tools for every provider + the call log */}
      <div style={{ position: "absolute", left: 1380, top: 210, width: 500, height: 660, borderRadius: 22, background: "rgba(30,36,30,0.92)", border: `1.5px solid ${C.line}`, boxShadow: "0 40px 100px rgba(0,0,0,0.5)", opacity: card, transform: `translateX(${(1 - card) * 60}px)`, padding: 30, fontFamily: FONT, color: C.textDark }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 24, fontWeight: 700, color: C.sage, letterSpacing: 0.5 }}>freddai_computer</div>
        <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {PROVIDERS.map((p, i) => {
            const a = provIn(i);
            return (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderRadius: 14, background: C.bgDark2, border: `1px solid ${C.line}`, fontSize: 24, fontWeight: 650, opacity: a, transform: `scale(${0.9 + 0.1 * a})` }}>
                <span style={{ width: 14, height: 14, borderRadius: 7, background: p.c }} />{p.name}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 20, fontSize: 20, color: C.slateLight, fontFamily: FONT_MONO }}>same tools · background mode</div>
        <div style={{ marginTop: 22, borderTop: `1px solid ${C.line}`, paddingTop: 22, display: "grid", gap: 18 }}>
          {TOOL_LINES.map((l, i) => {
            const a = sp(l.at, { damping: 18, stiffness: 200, mass: 0.7 });
            return (
              <div key={i} style={{ opacity: a, transform: `translateY(${(1 - a) * 14}px)`, fontFamily: FONT_MONO, fontSize: 21, lineHeight: 1.35 }}>
                <div style={{ color: C.textDark, fontWeight: 700 }}>{l.fn}{l.arg ? <span style={{ color: C.slateLight, fontWeight: 500 }}> {l.arg}</span> : null}</div>
                <div style={{ color: "#7bd88f" }}>→ {l.res}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* dim layer behind the slogan */}
      <AbsoluteFill style={{ background: `rgba(14,18,14,${dim})`, backdropFilter: `blur(${dim * 14}px)`, pointerEvents: "none" }} />

      {/* agent cursor: lavender arrow + label pill, above everything (it is its own window in the real helper) */}
      <div style={{ position: "absolute", left: cursorPos.x, top: cursorPos.y, opacity: cursorIn, pointerEvents: "none" }}>
        {clicking && <div style={{ position: "absolute", left: -26, top: -26, width: 52, height: 52, borderRadius: 26, border: `3px solid ${ACCENT}`, background: "rgba(194,166,255,0.25)", transform: `scale(${1 + pressF / 14})`, opacity: 1 - pressF / 14 }} />}
        <MacArrow fill={ACCENT} stroke="#000" />
        <div style={{ position: "absolute", right: -10, top: -52, background: "rgba(24,24,24,0.94)", color: ACCENT, fontSize: 20, fontWeight: 650, padding: "6px 14px", borderRadius: 9, whiteSpace: "nowrap", fontFamily: FONT }}>{label}</div>
      </div>

      {/* slogan */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, display: "flex", justifyContent: "center", alignItems: "center", opacity: sloganFade, transform: `translateY(${sloganY}px) scale(${sloganS})`, pointerEvents: "none" }}>
        <Words text="Same hands for every agent." delay={f(CUE.sloganHands)} size={116} color={C.textDark} style={{ maxWidth: 1800, textShadow: "0 10px 60px rgba(0,0,0,0.5)" }} family={FONT_DISPLAY} />
      </div>
    </AbsoluteFill>
  );
};

const mixC = (k: number) => {
  const a = [0x4d, 0x6b, 0xd6], b = [0x3f, 0x8a, 0x4a];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
};
