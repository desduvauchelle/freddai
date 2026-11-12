import React from "react";
import { Easing, Sequence, interpolate, useCurrentFrame } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { SHORT_TIMELINES } from "./timelines";
import { A, Icon, Pointer, Pop, TrafficLights } from "../ui";
import { Kicker } from "../text";
import { FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../fonts";
import { C, clamp } from "../theme";

const tl = SHORT_TIMELINES.needsyou;
const f = (s: number) => Math.round(s * 30);
const WIPE_END = f(tl.cues.turn + TURN_WIPE_SECONDS);
const DEMO = f(tl.cues.demo);
const END = f(tl.cues.endcard);
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: e });

// ---------------- pain: a buried "?" while the clock runs ----------------
const PILE_TOP = 560, PILE_COUNT = 5;
const TAB_NAMES = ["api — session", "login", "accounts", "folder", "settings"];
// Own copy of OldWay's TabPile: every tab is visible and static from frame 0 (the shared one staggers its entrance).
const TabPile: React.FC = () => (
  <div style={{ position: "absolute", left: 70, top: PILE_TOP, width: 940, height: 120 + PILE_COUNT * 64 }}>
    {TAB_NAMES.map((n, i) => (
      <div key={n} style={{ position: "absolute", left: 0, top: i * 64, width: 940, height: 120, borderRadius: "18px 18px 0 0", background: i === PILE_COUNT - 1 ? "#202126" : "#2a2b31", border: "1px solid #44454e", borderBottom: "none", boxShadow: "0 -6px 24px rgba(20,26,18,0.25)", display: "flex", alignItems: "flex-start", paddingTop: 14, gap: 18, paddingLeft: 24, boxSizing: "border-box", fontFamily: FONT_BODY, fontSize: 32, color: i === PILE_COUNT - 1 ? A.textHi : A.muted }}>
        <TrafficLights />{n}
      </div>
    ))}
  </div>
);
const BODY_TOP = PILE_TOP + 64 * (PILE_COUNT - 1) + 120; // directly under the front tab

const Pain: React.FC = () => {
  const frame = useCurrentFrame();
  const mins = Math.round(ease(frame, 20, 225, 612, 674, Easing.inOut(Easing.quad)));
  const clock = `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
  const dim = ease(frame, 20, 225, 1, 0.3);
  const pulse = 0.5 + 0.5 * Math.sin(frame / 7);
  const k = frame < 55 ? 1 : frame < 90 ? ease(frame, 55, 90, 1, 1.15) : frame < 150 ? 1.15 : ease(frame, 150, 185, 1.15, 1);
  return (
    <div style={{ position: "absolute", inset: 0, transform: `scale(${k})`, transformOrigin: "600px 660px" }}>
      <TabPile />
      <div style={{ position: "absolute", left: 904, top: PILE_TOP + 64 + 8, width: 48, height: 48, borderRadius: 24, background: A.amber, color: "#2a1c05", display: "grid", placeItems: "center", fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 34, boxShadow: `0 0 ${10 + 14 * pulse}px rgba(233,182,103,${0.35 + 0.3 * pulse})` }}>?</div>
      <div style={{ position: "absolute", left: 70, top: BODY_TOP, width: 940, height: 170, background: "#202126", borderRadius: "0 0 18px 18px", border: "1px solid #44454e", borderTop: "none", boxShadow: "0 30px 70px rgba(20,26,18,0.35)", fontFamily: FONT_BODY }}>
        <div style={{ height: 64, display: "flex", alignItems: "center", padding: "0 28px", borderBottom: "1px solid #36373f", fontSize: 34, color: A.muted }}>
          <Icon name="clock" size={34} color={A.muted} />
          <span style={{ marginLeft: 14 }}>api — session</span>
          <span style={{ marginLeft: "auto", fontFamily: FONT_MONO, fontSize: 42, fontWeight: 700, color: A.textHi }}>{clock}</span>
        </div>
        <div style={{ padding: "22px 28px", fontFamily: FONT_MONO, fontSize: 36, color: A.text, opacity: dim }}>
          ● Waiting for your answer…
        </div>
      </div>
    </div>
  );
};

// ---------------- demo: the "Needs you" column ----------------
const CARD_W = 690, CARD_H = 164, SUM_H = 60, GAP = 12, TOP0 = 82;
const SCALE = 1.4, STAGE_X = 57, STAGE_Y = 200;
const BTN_W = 190, BTN_GAP = 14, BTN_Y = 94, BTN_H = 52;

// local frames (relative to DEMO)
const ALLOW = 121, DECLINE = 169, ANSWER = 201, SEND = 239, DONE_AT = 262;
const CARDS = [
  { title: "Run `pnpm test`?", sub: "Claude Code · API", result: "Allowed", at: ALLOW },
  { title: "Replace config.ts?", sub: "Codex · Website", result: "Declined", at: DECLINE },
  { title: "Which branch?", sub: "Gemini · Mobile app", result: "Answered: main", at: SEND },
];
const collapseP = (frame: number, i: number) => ease(frame, CARDS[i].at + 14, CARDS[i].at + 30);
const heightOf = (frame: number, i: number) => interpolate(collapseP(frame, i), [0, 1], [CARD_H, SUM_H]);
const topOf = (frame: number, i: number) => {
  let t = TOP0;
  for (let j = 0; j < i; j++) t += heightOf(frame, j) + GAP;
  return t;
};
const btnCx = (b: number) => 18 + b * (BTN_W + BTN_GAP) + BTN_W / 2;
const btnCy = (frame: number, i: number) => topOf(frame, i) + BTN_Y + BTN_H / 2;

const Btn: React.FC<{ label: string; kind: "primary" | "ghost"; pressed?: boolean }> = ({ label, kind, pressed }) => (
  <div style={{ width: BTN_W, height: BTN_H, borderRadius: 12, display: "grid", placeItems: "center", fontSize: 26, fontWeight: 700, background: kind === "primary" ? A.running : "transparent", color: kind === "primary" ? "#0f2a1a" : A.textHi, border: kind === "primary" ? "none" : `1.5px solid ${A.input}`, transform: pressed ? "scale(0.94)" : undefined, filter: pressed ? "brightness(0.85)" : undefined }}>{label}</div>
);

const NeedCard: React.FC<{ i: number; frame: number }> = ({ i, frame }) => {
  const c = CARDS[i];
  const p = collapseP(frame, i);
  const resolved = frame >= c.at;
  const h = heightOf(frame, i);
  const typedFull = "main";
  const typed = typedFull.slice(0, Math.max(0, Math.min(typedFull.length, Math.floor((frame - (ANSWER + 8)) / 4))));
  const answering = i === 2 && frame >= ANSWER && frame < SEND;
  const col = i === 1 ? A.red : A.running;
  return (
    <div style={{ position: "absolute", left: 0, top: topOf(frame, i), width: CARD_W, height: h, borderRadius: 16, background: A.card, border: `1.5px solid ${resolved ? "#2b3a31" : "rgba(233,182,103,0.55)"}`, overflow: "hidden", fontFamily: FONT_BODY }}>
      {/* full card */}
      <div style={{ position: "absolute", inset: 0, opacity: 1 - p, height: CARD_H }}>
        <div style={{ position: "absolute", left: 18, top: 18, right: 18, fontSize: 26, fontWeight: 700, color: A.textHi, display: "flex", alignItems: "center", gap: 12, height: 32 }}>
          <Icon name={i === 2 ? "help" : "alert"} size={28} color={A.amber} />{c.title}
        </div>
        <div style={{ position: "absolute", left: 18, top: 54, fontSize: 26, color: A.muted }}>{c.sub}</div>
        <div style={{ position: "absolute", left: 18, top: BTN_Y, display: "flex", gap: BTN_GAP }}>
          {resolved && !answering ? (
            <div style={{ width: CARD_W - 36, height: BTN_H, display: "flex", alignItems: "center", gap: 12, fontSize: 26, fontWeight: 700, color: col }}><Icon name={i === 1 ? "x" : "check"} size={30} color={col} stroke={2.4} />{c.result}</div>
          ) : answering ? (
            <>
              <div style={{ width: 520, height: BTN_H, borderRadius: 12, border: `2px solid ${A.blue}`, background: "#18191c", display: "flex", alignItems: "center", padding: "0 16px", fontSize: 26, color: A.textHi }}>{typed}<span style={{ width: 2, height: 30, background: A.textHi, marginLeft: 2, opacity: frame % 16 < 9 ? 1 : 0 }} /></div>
              <div style={{ width: 120, height: BTN_H, borderRadius: 12, background: A.blue, color: "#0e1a2b", display: "grid", placeItems: "center", fontSize: 26, fontWeight: 700, transform: frame >= SEND - 2 ? "scale(0.94)" : undefined }}>Send</div>
            </>
          ) : (
            <>
              <Btn label="Allow" kind="primary" pressed={i === 0 && frame >= ALLOW && frame < ALLOW + 5} />
              <Btn label="Decline" kind="ghost" pressed={i === 1 && frame >= DECLINE && frame < DECLINE + 5} />
              <Btn label="Answer" kind="ghost" pressed={i === 2 && frame >= ANSWER && frame < ANSWER + 5} />
            </>
          )}
        </div>
      </div>
      {/* summary row */}
      <div style={{ position: "absolute", left: 18, right: 18, top: 0, height: SUM_H, display: "flex", alignItems: "center", gap: 12, fontSize: 26, color: A.muted, opacity: p }}>
        <Icon name={i === 1 ? "x" : "check"} size={28} color={col} stroke={2.4} />
        <span style={{ whiteSpace: "nowrap" }}>{c.title.replace(/`/g, "")}</span>
        <span style={{ marginLeft: "auto", color: col, fontWeight: 700, whiteSpace: "nowrap" }}>{c.result}</span>
      </div>
    </div>
  );
};

// camera stops: k scale, focus point in SCREEN coordinates
const focus = (_nx: number, ny: number) => [540, STAGE_Y + ny * SCALE];
const CAM: { f: number; k: number; fx: number; fy: number }[] = (() => {
  const a = focus(btnCx(0), btnCy(ALLOW, 0)), d = focus(btnCx(1), btnCy(DECLINE, 1)), n = focus(btnCx(1), btnCy(ANSWER, 2));
  return [
    { f: 0, k: 1, fx: a[0], fy: a[1] }, { f: 100, k: 1, fx: a[0], fy: a[1] }, { f: 116, k: 1.07, fx: a[0], fy: a[1] }, { f: 146, k: 1.07, fx: a[0], fy: a[1] },
    { f: 160, k: 1, fx: d[0], fy: d[1] }, { f: 162, k: 1, fx: d[0], fy: d[1] }, { f: 176, k: 1.07, fx: d[0], fy: d[1] }, { f: 186, k: 1.07, fx: d[0], fy: d[1] },
    { f: 198, k: 1.07, fx: n[0], fy: n[1] }, { f: 256, k: 1.07, fx: n[0], fy: n[1] }, { f: 272, k: 1, fx: n[0], fy: n[1] },
  ];
})();
const camAt = (frame: number) => {
  for (let i = 0; i < CAM.length - 1; i++) {
    const a = CAM[i], b = CAM[i + 1];
    if (frame <= b.f) {
      const p = ease(frame, a.f, b.f);
      return { k: a.k + (b.k - a.k) * p, fx: a.fx + (b.fx - a.fx) * p, fy: a.fy + (b.fy - a.fy) * p };
    }
  }
  const l = CAM[CAM.length - 1];
  return l;
};

const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = camAt(frame);
  const left = 3 - (frame >= ALLOW ? 1 : 0) - (frame >= DECLINE ? 1 : 0) - (frame >= SEND ? 1 : 0);
  const stageH = topOf(frame, 3) - GAP;
  return (
    <div style={{ position: "absolute", inset: 0, transform: `scale(${cam.k})`, transformOrigin: `${cam.fx}px ${cam.fy}px` }}>
      <div style={{ position: "absolute", left: STAGE_X, top: STAGE_Y, width: CARD_W, height: 800, transform: `scale(${SCALE})`, transformOrigin: "0 0", fontFamily: FONT_DISPLAY }}>
        <Pop at={8} y={20} from={0.97} origin="0% 0%">
          <div style={{ display: "flex", alignItems: "center", gap: 16, height: 62, fontSize: 42, fontWeight: 800, color: C.ink, letterSpacing: "-0.02em" }}>
            Needs you
            <span style={{ minWidth: 44, height: 44, borderRadius: 22, padding: "0 8px", boxSizing: "border-box", display: "grid", placeItems: "center", fontSize: 28, fontWeight: 800, background: left ? A.amber : A.running, color: "#1f1507" }}>{left}</span>
          </div>
        </Pop>
        {CARDS.map((_, i) => (
          <Pop key={i} at={14 + i * 8} y={30} from={0.97} origin="50% 0%" style={{ position: "absolute", left: 0, top: 0, width: CARD_W }}>
            <NeedCard i={i} frame={frame} />
          </Pop>
        ))}
        <div style={{ position: "absolute", left: 0, top: stageH + 36, width: CARD_W, textAlign: "center" }}>
          {frame >= DONE_AT && <Kicker text="Done." color={C.forest} size={92} delay={DONE_AT} />}
        </div>
        <Pointer
          scale={0.95}
          color="#fff"
          keys={[
            { x: 900, y: 520, at: 98, leave: 100 },
            { x: btnCx(0), y: btnCy(ALLOW, 0), at: 116, click: ALLOW, leave: 138 },
            { x: btnCx(1), y: btnCy(DECLINE, 1), at: 164, click: DECLINE, leave: 180 },
            { x: btnCx(1) + BTN_W + BTN_GAP, y: btnCy(ANSWER, 2), at: 196, click: ANSWER, leave: 214 },
            { x: 18 + 520 + BTN_GAP + 60, y: btnCy(ANSWER, 2), at: 234, click: SEND, leave: 250 },
            { x: 900, y: 420, at: 272 },
          ]}
        />
      </div>
    </div>
  );
};

export const Short05Needsyou: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={WIPE_END}>
      <Pain />
      <HookTitle lines={["Your agent waited", "an hour."]} accent="hour" />
    </Sequence>
    <Sequence from={DEMO} durationInFrames={END - DEMO + 30}>
      <Demo />
    </Sequence>
    <Turn at={tl.cues.turn} />
  </ShortShell>
);
