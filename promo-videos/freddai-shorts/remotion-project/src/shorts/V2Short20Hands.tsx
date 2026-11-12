import React from "react";
import { Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { EndCard } from "./EndCard";
import { V2_TIMELINES } from "./timelinesV2";
import { Icon, MacWindow, TrafficLights } from "../ui";
import { C, clamp } from "../theme";
import { FONT_DISPLAY, FONT_MONO } from "../fonts";

const tl = V2_TIMELINES.hands;
const fr = (s: number) => Math.round(s * 30);
const LAVENDER = "#c2a6ff";
const ink = "#26261f";

// desk panel (page px): x40..1040, y190..1060. Everything inside is in desk-local px.
const DESK = { x: 40, y: 190, w: 1000, h: 870 };
const FORM = { x: 30, y: 290, w: 760, h: 420 };
const NOTES = { x: 330, y: 640, w: 640, h: 220 };

const ease = (t: number, a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
const easeOut = (t: number, a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

// ---- beats (seconds) ----
const PROMPT1 = 2.9, LAUNCH = 6.3, CLAUDE = 7.4, NAME_CLICK = 8.4, NAME_TYPE = 8.55, SAVE1 = 11.5;
const YOURS = 15.13, PROMPT2 = 19.05, GEMINI = 20.4, NAME2_CLICK = 20.8, NAME2_TYPE = 20.95, SAVE2 = 21.7;
const NAME1 = "Pricing page", NAME2 = "API";

const KEYS: { t: number; x: number; y: number }[] = [
  { t: 5.9, x: 930, y: 380 },
  { t: 7.2, x: 589, y: 446 },
  { t: 7.5, x: 589, y: 446 },
  { t: 8.4, x: 250, y: 602 },
  { t: 9.8, x: 250, y: 602 },
  { t: 11.4, x: 154, y: 670 },
  { t: 19.7, x: 154, y: 670 },
  { t: 20.3, x: 226, y: 524 },
  { t: 20.5, x: 226, y: 524 },
  { t: 20.8, x: 250, y: 602 },
  { t: 21.4, x: 250, y: 602 },
  { t: 21.7, x: 154, y: 670 },
];
const CLICKS = [CLAUDE, NAME_CLICK, SAVE1, GEMINI, NAME2_CLICK, SAVE2];

const cursorAt = (t: number) => {
  if (t <= KEYS[0].t) return KEYS[0];
  for (let i = 1; i < KEYS.length; i++) {
    if (t <= KEYS[i].t) {
      const a = KEYS[i - 1], b = KEYS[i], k = ease(t, a.t, b.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return KEYS[KEYS.length - 1];
};

const LOG = [
  { at: 3.4, fn: "computer_windows", res: "3 windows" },
  { at: 4.4, fn: "computer_observe", res: "14 elements" },
  { at: LAUNCH, fn: "computer_launch", res: "Settings" },
  { at: CLAUDE, fn: "computer_action", res: "press Claude Code" },
  { at: NAME_TYPE + 0.2, fn: "computer_action", res: `type ${NAME1}` },
  { at: SAVE1, fn: "computer_action", res: "press Save" },
  { at: GEMINI, fn: "computer_action", res: "press Gemini" },
  { at: NAME2_TYPE, fn: "computer_action", res: `type ${NAME2}` },
  { at: SAVE2, fn: "computer_action", res: "press Save" },
];

const USER_TEXT = "Notes for Thursday. Move the invoice export to the new template, then check the totals before sending. Ask Maria about the Q4 budget. Book the venue for the offsite. Reply to the supplier about the late delivery. Draft the agenda for Monday and send it round. Pick up the printed handouts. Confirm lunch for twelve.";
const wrapLines = (s: string, n: number) => {
  const lines: string[] = [];
  let cur = "";
  for (const w of s.split(" ")) {
    if ((cur + (cur ? " " : "") + w).length > n && cur) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w;
  }
  lines.push(cur);
  return lines;
};

const WinBar: React.FC<{ title: string; active: boolean }> = ({ title, active }) => (
  <div style={{ height: 56, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 22px", gap: 24, background: active ? "#e7e5de" : "#efeee9", borderBottom: "2px solid #d6d4cb", opacity: active ? 1 : 0.9 }}>
    <div style={{ display: "flex", gap: 10, opacity: active ? 1 : 0.45, transform: "scale(1.3)", transformOrigin: "0 50%" }}><TrafficLights /></div>
    <div style={{ marginLeft: 26, fontSize: 36, fontWeight: 650, color: active ? "#2a2a28" : "#77766f", fontFamily: FONT_DISPLAY, whiteSpace: "nowrap" }}>{title}</div>
  </div>
);

const Arrow: React.FC<{ fill: string; stroke: string; size?: number }> = ({ fill, stroke, size = 52 }) => (
  <svg width={size} height={size * 1.4} viewBox="0 0 16 22" style={{ overflow: "visible", filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.4))" }}>
    <path d="M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z" fill={fill} stroke={stroke} strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
);

const Btn: React.FC<{ x: number; y: number; w: number; label: string; on?: boolean; flash?: boolean; green?: boolean }> = ({ x, y, w, label, on, flash, green }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: 64, borderRadius: 16, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, fontWeight: 700, fontFamily: FONT_DISPLAY, background: green ? "#3f8a4a" : on ? "#4d613d" : "#fbfaf6", color: green || on ? "#fff" : "#3a3a36", border: green || on ? "2px solid transparent" : "2px solid #cfcdc4", transform: `scale(${flash ? 0.96 : 1})` }}>{label}</div>
);

const Desk: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const mv = ease(t, 2.5, 3.3);
  const deskS = 0.94 + (1.02 - 0.94) * mv, deskX = 70 + (30 - 70) * mv, deskY = 297 + (170 - 297) * mv;
  const caretOn = Math.floor(frame / 15) % 2 === 0;
  // user's own typing, never stops
  const typed = Math.min(USER_TEXT.length, 70 + Math.floor(t * 12));
  const lines = wrapLines(USER_TEXT.slice(0, typed), 26);
  const shown = lines.slice(-3);
  // form state
  const gem = t >= GEMINI;
  const saved1 = t >= SAVE1 && t < PROMPT2 + 0.7, saved2 = t >= SAVE2;
  const flashAt = (c: number) => t >= c && t < c + 0.15;
  const name1 = NAME1.slice(0, Math.max(0, Math.min(NAME1.length, Math.floor((t - NAME_TYPE) * 10))));
  const name2 = NAME2.slice(0, Math.max(0, Math.min(NAME2.length, Math.floor((t - NAME2_TYPE) * 8))));
  const nameShown = t < PROMPT2 + 0.7 ? name1 : t < NAME2_TYPE ? "" : name2;
  const nameFocus = (t >= NAME_CLICK && t < SAVE1) || (t >= NAME2_CLICK && t < SAVE2);
  const winIn = spring({ frame: frame, fps, config: { damping: 16, stiffness: 140, mass: 0.9 } });
  // agent cursor
  const cur = cursorAt(t);
  const curOn = easeOut(t, 5.9, 6.2);
  const lastClick = CLICKS.filter((c) => c <= t).pop();
  const clickF = lastClick !== undefined ? Math.round((t - lastClick) * fps) : 99;
  const typing = (t >= NAME_TYPE && t < NAME_TYPE + 1.4) || (t >= NAME2_TYPE && t < NAME2_TYPE + 0.6);
  const label = typing ? "Freddai · Type · Settings" : "Freddai · Press · Settings";
  const labelLeft = Math.min(cur.x + (cur.y > 640 ? 150 : 90), DESK.w - 540);
  const labelTop = cur.y < 500 ? -92 : -78;
  // tool log + job prompt
  const cardIn = easeOut(t, 2.7, 3.2);
  const prompt1 = "Use Claude Code for Pricing page";
  const prompt2 = "Now Gemini for the API project";
  const p1 = prompt1.slice(0, Math.max(0, Math.floor((t - PROMPT1) * 16)));
  const p2 = prompt2.slice(0, Math.max(0, Math.floor((t - PROMPT2) * 28)));
  const prompt = t >= PROMPT2 ? p2 : p1;
  const listening = (t >= PROMPT1 && t < PROMPT1 + 2.2) || (t >= PROMPT2 && t < PROMPT2 + 1.1);
  const shownLog = LOG.filter((l) => l.at <= t).slice(-2);
  const yours = easeOut(t, YOURS, YOURS + 0.35);
  const ringPulse = 0.5 + 0.5 * Math.sin(frame / 8);
  const launchRing = t >= LAUNCH && t < LAUNCH + 0.9 ? 1 - (t - LAUNCH) / 0.9 : 0;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `translate(${deskX}px, ${deskY}px) scale(${deskS})`, width: DESK.w, height: DESK.h, borderRadius: 34, overflow: "hidden", background: "linear-gradient(160deg, #8fa57f 0%, #c3bf8f 52%, #d9a877 100%)", boxShadow: "0 40px 100px rgba(30,20,20,0.45), 0 0 0 3px rgba(255,255,255,0.35)", fontFamily: FONT_DISPLAY }}>
      {/* menu bar */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 56, background: "rgba(250,249,245,0.72)", display: "flex", alignItems: "center", gap: 34, padding: "0 28px", fontSize: 36, fontWeight: 650, color: ink }}>
        <span style={{ fontWeight: 800 }}>Notes</span><span style={{ fontWeight: 500 }}>File</span><span style={{ fontWeight: 500 }}>Edit</span>
        <span style={{ marginLeft: "auto", fontWeight: 500 }}>Thu 9:41</span>
      </div>

      {/* job + tool log */}
      <div style={{ position: "absolute", left: 40, top: 76, width: 920, height: 196, borderRadius: 26, background: "rgba(30,36,30,0.95)", border: `2px solid ${C.line}`, padding: "14px 26px", boxSizing: "border-box", color: C.textDark, opacity: cardIn, transform: `translateY(${(1 - cardIn) * -20}px)`, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, height: 52, fontSize: 36, fontWeight: 700, whiteSpace: "nowrap" }}>
          <span style={{ width: 40, height: 40, borderRadius: 20, background: listening ? C.sage : "#3a4336", display: "grid", placeItems: "center", transform: `scale(${listening ? 1 + 0.08 * ringPulse : 1})` }}><Icon name="mic" size={24} color="#1b2418" /></span>
          <span>{prompt}</span>
        </div>
        <div style={{ marginTop: 8, fontFamily: FONT_MONO, fontSize: 36, lineHeight: "44px" }}>
          {shownLog.map((l, i) => {
            const p = easeOut(t, l.at, l.at + 0.25);
            return (
              <div key={l.at + l.res} style={{ whiteSpace: "nowrap", opacity: (i === shownLog.length - 1 ? 1 : 0.65) * p }}>
                <span style={{ color: C.sage, fontWeight: 700 }}>{l.fn}</span><span style={{ color: "#7bd88f" }}> → {l.res}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* background window: Settings form */}
      <div style={{ position: "absolute", left: FORM.x, top: FORM.y, transform: `scale(${0.97 + 0.03 * winIn})`, transformOrigin: "50% 50%" }}>
        <MacWindow width={FORM.w} height={FORM.h} light radius={22} titlebar={<WinBar title="Settings · Providers" active={false} />} style={{ boxShadow: "0 24px 60px rgba(20,26,18,0.35)", background: "#f6f5f0" }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", left: 24, top: 14, fontSize: 36, fontWeight: 600, color: "#6b6a62" }}>Provider</div>
            <Btn x={24} y={66} w={345} label="Codex" />
            <Btn x={387} y={66} w={345} label="Claude Code" on={t >= CLAUDE && !gem} flash={flashAt(CLAUDE)} />
            <Btn x={24} y={144} w={345} label="Gemini" on={gem} flash={flashAt(GEMINI)} />
            <Btn x={387} y={144} w={345} label="Grok" />
            <div style={{ position: "absolute", left: 24, top: 232, width: 708, height: 64, borderRadius: 16, boxSizing: "border-box", background: "#fff", border: `2px solid ${nameFocus ? "#4d613d" : "#cfcdc4"}`, display: "flex", alignItems: "center", padding: "0 20px", fontSize: 36, fontWeight: 600, color: ink, gap: 0 }}>
              {nameShown ? <span>{nameShown}</span> : <span style={{ color: "#a3a299", fontWeight: 500 }}>Project name</span>}
              {nameFocus && caretOn && <span style={{ width: 3, height: 40, background: "#4d613d", marginLeft: 3 }} />}
            </div>
            <Btn x={24} y={308} w={210} label={saved1 || saved2 ? "Saved ✓" : "Save"} green={saved1 || saved2} flash={flashAt(SAVE1) || flashAt(SAVE2)} />
          </div>
          {launchRing > 0 && <div style={{ position: "absolute", inset: 0, borderRadius: 22, border: `6px solid ${LAVENDER}`, opacity: launchRing }} />}
        </MacWindow>
      </div>

      {/* front window: the user's own Notes, caret never stops */}
      <div style={{ position: "absolute", left: NOTES.x, top: NOTES.y, transform: `scale(${0.97 + 0.03 * winIn})`, transformOrigin: "50% 50%" }}>
        <MacWindow width={NOTES.w} height={NOTES.h} light radius={22} titlebar={<WinBar title="Thursday" active />} style={{ boxShadow: `0 30px 70px rgba(20,26,18,0.5), 0 0 0 ${3 + yours * 3}px ${yours > 0 ? `rgba(63,138,74,${yours})` : "rgba(0,0,0,0.15)"}`, background: "#fffef9" }}>
          <div style={{ padding: "8px 28px", fontFamily: FONT_MONO, fontSize: 36, lineHeight: "48px", color: ink, whiteSpace: "pre" }}>
            {shown.map((l, i) => (
              <div key={i + l.slice(0, 4)}>{l}{i === shown.length - 1 && <span style={{ display: "inline-block", width: 4, height: 38, background: ink, verticalAlign: "-7px", opacity: caretOn ? 1 : 0.1, marginLeft: 2 }} />}</div>
            ))}
          </div>
        </MacWindow>
        {yours > 0 && (
          <div style={{ position: "absolute", right: 18, top: -30, padding: "2px 22px", borderRadius: 999, background: "#3f8a4a", color: "#fff", fontSize: 36, fontWeight: 800, opacity: yours, transform: `translateY(${(1 - yours) * 14}px)` }}>Yours</div>
        )}
      </div>

      {/* the user's own pointer: parked, never moves */}
      <div style={{ position: "absolute", left: 110, top: 770 }}><Arrow fill="#111" stroke="#fff" /></div>

      {/* agent cursor */}
      {curOn > 0 && (
        <div style={{ position: "absolute", left: cur.x, top: cur.y, opacity: curOn, pointerEvents: "none", zIndex: 20 }}>
          {clickF >= 0 && clickF < 12 && <div style={{ position: "absolute", left: -32, top: -32, width: 64, height: 64, borderRadius: 32, border: `4px solid ${LAVENDER}`, background: "rgba(194,166,255,0.25)", transform: `scale(${0.6 + clickF / 10})`, opacity: 1 - clickF / 12 }} />}
          <Arrow fill={LAVENDER} stroke="#000" />
          <div style={{ position: "absolute", left: labelLeft - cur.x, top: labelTop, background: "rgba(24,24,24,0.96)", color: LAVENDER, fontSize: 36, fontWeight: 700, padding: "4px 18px", borderRadius: 12, whiteSpace: "nowrap" }}>{label}</div>
        </div>
      )}
    </div>
  );
};

export const V2Short20Hands: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const hookOut = 1 - easeOut(t, tl.vo[1].start - 0.25, tl.vo[1].start);
  return (
    <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
      <Sequence from={0} durationInFrames={fr(tl.cues.endcard) + 6} name="scene"><Desk /></Sequence>
      <Sequence from={0} durationInFrames={fr(tl.vo[1].start)} name="hook">
        <div style={{ opacity: hookOut }}>
          <HookTitle lines={["Your agent can", "use your Mac."]} accent="Mac" />
        </div>
      </Sequence>
    </ShortShell>
  );
};
