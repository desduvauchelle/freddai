import React from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { SHORT_TIMELINES } from "./timelines";
import { Words } from "../text";
import { Glow } from "../fx";
import { C, FONT, clamp } from "../theme";
import { FONT_DISPLAY, FONT_MONO } from "../fonts";

// Short 10 "hands": a Mac desktop re-stacked vertically (notes window above report window, tool log below),
// rebuilt from uiComputer.tsx pieces, driven by this short's own clock (t = local seconds).
const tl = SHORT_TIMELINES.hands;
const TURN = tl.cues.turn;
const WIPE_END = TURN + TURN_WIPE_SECONDS;
const ACCENT = "#c2a6ff"; // agent cursor lavender
const PROVIDERS = [
  { name: "Codex", c: "#9ad1b0" }, { name: "Claude Code", c: "#e0a47c" }, { name: "Gemini", c: "#8fb0ff" }, { name: "Grok", c: "#e8e6dc" },
];
const USER_TEXT = "Notes for Thursday. Move the invoice export to the new template, then check the totals before sending.";
const PRESS_AT = 7.0, CHIPS_AT = 7.5, CHIP_STEP = 0.95, WORDS_AT = tl.vo[3].start;
const ease = (t: number, a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });

const winBase = (active: boolean): React.CSSProperties => ({
  position: "absolute", borderRadius: 26, overflow: "hidden", background: active ? "#f6f5f1" : "#efeee9",
  boxShadow: active ? "0 30px 80px rgba(0,0,0,0.55), 0 0 0 2px rgba(0,0,0,0.25)" : "0 20px 60px rgba(0,0,0,0.4), 0 0 0 2px rgba(0,0,0,0.2)", fontFamily: FONT,
});
const TitleBar: React.FC<{ active: boolean; title: string }> = ({ active, title }) => (
  <div style={{ height: 66, display: "flex", alignItems: "center", padding: "0 26px", background: active ? "#e4e2dc" : "#ebeae5", borderBottom: "2px solid #d2d0c8" }}>
    <div style={{ display: "flex", gap: 12 }}>{["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 20, height: 20, borderRadius: 10, background: active ? c : "#cfcec8" }} />)}</div>
    <div style={{ marginLeft: 26, fontSize: 36, fontWeight: 650, color: active ? "#2a2a28" : "#77766f" }}>{title}</div>
  </div>
);
const MacArrow: React.FC<{ fill: string; stroke: string; size?: number }> = ({ fill, stroke, size = 64 }) => (
  <svg width={size} height={size * 1.4} viewBox="0 0 16 22" style={{ overflow: "visible", filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.45))" }}>
    <path d="M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z" fill={fill} stroke={stroke} strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
);
const Wallpaper: React.FC<{ style: React.CSSProperties; children?: React.ReactNode }> = ({ style, children }) => (
  <div style={{ position: "absolute", overflow: "hidden", borderRadius: 32, background: "radial-gradient(ellipse at 30% 15%, #2f4332 0%, #1b251e 55%, #111713 100%)", boxShadow: "0 30px 90px rgba(40,45,35,0.35), 0 0 0 3px rgba(40,45,35,0.5)", ...style }}>
    <Glow x={800} y={700} color="#4d613d" size={900} opacity={0.4} drift={1} />
    {children}
  </div>
);

// Report window with the Export PDF button; `pressed` flips it to Exported, `pdf` shows the file pill.
const ReportWin: React.FC<{ style: React.CSSProperties; pressed: boolean; clicking: boolean; pdf: number; chart?: boolean }> = ({ style, pressed, clicking, pdf, chart = true }) => (
  <div style={{ ...winBase(false), ...style }}>
    <TitleBar active={false} title="Reports — Q4 summary" />
    <div style={{ padding: "18px 30px 0" }}>
      {chart && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 18, height: 96 }}>
          {[0.5, 0.75, 0.6, 0.9, 0.7, 0.55, 0.8].map((h, i) => <div key={i} style={{ flex: 1, height: `${h * 100}%`, borderRadius: 8, background: i === 3 ? "#7e9a68" : "#cfd3c4" }} />)}
        </div>
      )}
    </div>
    <div style={{ position: "absolute", left: 30, right: 30, bottom: 24, display: "flex", alignItems: "center", gap: 18 }}>
      {pdf > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: pdf, transform: `translateY(${(1 - pdf) * 24}px) scale(${0.9 + 0.1 * pdf})` }}>
          <div style={{ background: "#d9453d", color: "#fff", fontWeight: 800, fontSize: 30, padding: "6px 12px", borderRadius: 8 }}>PDF</div>
          <div style={{ fontSize: 36, fontWeight: 650, color: "#3a3a36" }}>Q4.pdf</div>
        </div>
      )}
      <div style={{ marginLeft: "auto", padding: "12px 26px", borderRadius: 16, border: "2px solid #c8c6bd", fontSize: 36, fontWeight: 600, color: "#55554f", background: "#f7f6f2" }}>Share</div>
      <div style={{ padding: "12px 30px", borderRadius: 16, fontSize: 38, fontWeight: 700, color: "#fff", background: pressed ? "#3f8a4a" : "#4d6bd6", transform: clicking ? "scale(0.95)" : "scale(1)" }}>{pressed ? "Exported ✓" : "Export PDF"}</div>
    </div>
  </div>
);

const TOOL_LINES = (() => {
  const base = [
    { at: 4.1, fn: "computer_windows", res: "3 windows" },
    { at: 4.9, fn: "computer_observe", res: "14 elements" },
    { at: 5.9, fn: "computer_action", res: "hover" },
    { at: PRESS_AT, fn: "computer_action", res: "press ok" },
  ];
  const chips = PROVIDERS.concat(PROVIDERS, PROVIDERS).map((p, i) => ({ at: CHIPS_AT + i * CHIP_STEP, fn: "computer_action", res: `press · ${p.name}` }));
  return [...base, ...chips.filter((l) => l.at < 13.5)];
})();

const HookScene: React.FC = () => {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const t = frame / fps;
  const pop = spring({ frame: frame - 3, fps, config: { damping: 14, stiffness: 170, mass: 0.8 } });
  return (
    <Wallpaper style={{ left: 40, top: 560, width: 1000, height: 540 }}>
      <div style={{ position: "absolute", left: 70, top: 20, width: 860, borderRadius: 36, background: "#fff", boxShadow: "0 16px 50px rgba(0,0,0,0.4)", padding: "22px 34px", display: "flex", alignItems: "center", gap: 22, fontFamily: FONT_DISPLAY, transform: `scale(${0.94 + 0.06 * pop})`, transformOrigin: "20% 100%" }}>
        <div style={{ width: 76, height: 76, borderRadius: 38, background: "#e0a47c", display: "grid", placeItems: "center", fontSize: 44, fontWeight: 800, color: "#fff", flexShrink: 0 }}>✳</div>
        <div style={{ fontSize: 46, fontWeight: 750, color: "#26261f", lineHeight: 1.1 }}>I can't click that for you.</div>
      </div>
      <ReportWin style={{ left: 40, top: 170, width: 920, height: 330 }} pressed={false} clicking={false} pdf={0} />
      <div style={{ position: "absolute", left: 40, top: 450, opacity: 0 }}>{t}</div>
    </Wallpaper>
  );
};

const DemoScene: React.FC = () => {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const t = frame / fps;
  const reveal = ease(t, WIPE_END, WIPE_END + 0.25);
  const typed = Math.max(0, Math.floor((t - 3.6) * 14));
  const caretOn = Math.floor(frame / 15) % 2 === 0;
  // agent cursor path (page px): enters from off-screen right, over the report window, onto Export PDF
  const BTN = { x: 900, y: 780 }, MID = { x: 760, y: 610 }, START = { x: 1180, y: 520 };
  const k1 = ease(t, 3.9, 5.4), k2 = ease(t, 5.7, PRESS_AT - 0.1);
  const cur = { x: START.x + (MID.x - START.x) * k1 + (BTN.x - MID.x) * k2, y: START.y + (MID.y - START.y) * k1 + (BTN.y - MID.y) * k2 };
  const pressF = Math.round((t - PRESS_AT) * fps);
  const pressed = t >= PRESS_AT, clicking = pressF >= 0 && pressF < 10;
  const pdf = spring({ frame: Math.round((t - PRESS_AT - 0.3) * fps), fps, config: { damping: 14, stiffness: 170, mass: 0.8 } });
  const label = pressed ? "Freddai · press" : "Freddai · hover";
  // chips light in turn
  const chipIdx = t >= CHIPS_AT && t < 13.5 ? Math.floor((t - CHIPS_AT) / CHIP_STEP) % 4 : -1;
  const lines = TOOL_LINES.filter((l) => l.at <= t);
  const shown = lines.slice(-3);
  const newest = lines[lines.length - 1];
  const shift = newest ? (1 - ease(t, newest.at, newest.at + 0.25)) * 56 : 0;
  const yours = ease(t, 9.4, 9.7);
  const dim = ease(t, WORDS_AT - 0.15, WORDS_AT + 0.3);
  const sp = (at: number) => spring({ frame: Math.round((t - at) * fps), fps, config: { damping: 15, stiffness: 150, mass: 0.8 } });
  const winIn = sp(WIPE_END);
  return (
    <>
      <Wallpaper style={{ left: 40, top: 190, width: 1000, height: 910, opacity: reveal, transform: `translateY(${(1 - reveal) * 24}px)` }}>
        {/* user's own focused window: typing continues */}
        <div style={{ ...winBase(true), left: 30, top: 24, width: 940, height: 262, opacity: winIn }}>
          <TitleBar active title="meeting-notes.txt" />
          <div style={{ padding: "16px 30px", fontSize: 36, lineHeight: 1.3, color: "#2a2a28", fontFamily: FONT_MONO }}>
            {USER_TEXT.slice(0, typed)}
            <span style={{ display: "inline-block", width: 4, height: 40, background: "#2a2a28", verticalAlign: "-8px", opacity: caretOn ? 1 : 0 }} />
          </div>
          {yours > 0 && <div style={{ position: "absolute", right: 24, top: 10, padding: "2px 20px", borderRadius: 999, background: "#3f8a4a", color: "#fff", fontSize: 36, fontWeight: 700, opacity: yours }}>Yours</div>}
        </div>
        <ReportWin style={{ left: 30, top: 306, width: 940, height: 300, opacity: winIn }} pressed={pressed} clicking={clicking} pdf={pressed ? pdf : 0} chart={false} />
        {/* freddai_computer tool log + provider chips */}
        <div style={{ position: "absolute", left: 30, top: 626, width: 940, height: 260, borderRadius: 26, background: "rgba(30,36,30,0.94)", border: `2px solid ${C.line}`, padding: "16px 26px", boxSizing: "border-box", fontFamily: FONT, color: C.textDark, overflow: "hidden", opacity: ease(t, 3.9, 4.3) }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {PROVIDERS.map((p, i) => {
              const on = chipIdx === i;
              return (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 18px", borderRadius: 14, background: on ? p.c : C.bgDark2, color: on ? "#1b1a24" : C.textDark, border: `2px solid ${on ? p.c : C.line}`, fontSize: 36, fontWeight: 700, transform: `scale(${on ? 1.06 : 1})` }}>
                  <span style={{ width: 16, height: 16, borderRadius: 8, background: on ? "#1b1a24" : p.c }} />{p.name}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, height: 158, overflow: "hidden", position: "relative" }}>
            <div style={{ transform: `translateY(${shift}px)`, fontFamily: FONT_MONO, fontSize: 36, lineHeight: "52px" }}>
              {shown.map((l, i) => (
                <div key={l.at + l.fn + i} style={{ whiteSpace: "nowrap", opacity: i === shown.length - 1 ? 1 : 0.7 }}>
                  <span style={{ color: C.sage, fontWeight: 700 }}>{l.fn}</span>
                  <span style={{ color: "#7bd88f" }}> → {l.res}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* the user's own pointer: parked in a corner, never moves */}
        <div style={{ position: "absolute", left: 880, top: 205, opacity: winIn }}><MacArrow fill="#111" stroke="#fff" /></div>
      </Wallpaper>
      {/* agent cursor: lavender arrow + label pill, above everything */}
      {t >= 3.9 && (
        <div style={{ position: "absolute", left: cur.x, top: cur.y, opacity: ease(t, 3.9, 4.3), pointerEvents: "none" }}>
          {clicking && <div style={{ position: "absolute", left: -34, top: -34, width: 68, height: 68, borderRadius: 34, border: `4px solid ${ACCENT}`, background: "rgba(194,166,255,0.25)", transform: `scale(${1 + pressF / 10})`, opacity: 1 - pressF / 10 }} />}
          <MacArrow fill={ACCENT} stroke="#000" />
          <div style={{ position: "absolute", right: 30, top: -118, background: "rgba(24,24,24,0.95)", color: ACCENT, fontSize: 36, fontWeight: 700, padding: "4px 18px", borderRadius: 12, whiteSpace: "nowrap", fontFamily: FONT }}>{label}</div>
        </div>
      )}
      {/* line 04: big words over a softened desktop */}
      {dim > 0 && (
        <>
          <div style={{ position: "absolute", left: 40, top: 190, width: 1000, height: 910, borderRadius: 32, background: `rgba(14,18,14,${0.4 * dim})` }} />
          <div style={{ position: "absolute", left: 90, width: 900, top: 190, height: 910, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Words text="Same hands for every agent." delay={Math.round(WORDS_AT * fps)} size={140} color="#fff" family={FONT_DISPLAY} style={{ maxWidth: 900, textShadow: "0 6px 40px rgba(0,0,0,0.7)" }} />
          </div>
        </>
      )}
    </>
  );
};

const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  return frame < Math.round(WIPE_END * 30) ? <><HookScene /><HookTitle lines={["Some agents can't", "use your Mac."]} accent="Mac" /></> : null;
};
const Demo: React.FC = () => (useCurrentFrame() >= Math.round(WIPE_END * 30) - 1 ? <DemoScene /> : null);

export const Short10Hands: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Hook />
    <Demo />
    <Turn at={TURN} />
  </ShortShell>
);
