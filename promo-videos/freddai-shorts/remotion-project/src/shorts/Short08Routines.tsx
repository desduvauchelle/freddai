import React from "react";
import { Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { SHORT_TIMELINES } from "./timelines";
import { A, Icon, Pointer, Pop } from "../ui";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";
import { C, clamp } from "../theme";

const tl = SHORT_TIMELINES.routines;
const f = (s: number) => Math.round(s * 30);
const WIPE_END = f(tl.cues.turn + TURN_WIPE_SECONDS);
const DEMO = f(tl.cues.demo);
const END = f(tl.cues.endcard);
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: e });

// ---------------- pain: the same checklist, day after day ----------------
const ITEMS = ["Update deps", "Triage issues", "Draft standup"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
// tick frames per day (3 ticks each) — faster every day
const TICKS = [[26, 46, 66], [108, 119, 130], [158, 166, 174], [196, 202, 208], [228, 233, 238]];
// slide transitions: [start, duration] into day 1..4
const SLIDES = [[84, 14], [142, 10], [184, 8], [216, 8]];
const CARD_X = 70, CARD_Y = 600, CARD_W = 940, HEAD = 100, ROW = 92;

const cur = (frame: number) => SLIDES.reduce((s, [a, d]) => s + ease(frame, a, a + d), 0);

const DayCard: React.FC<{ day: number; frame: number; x: number }> = ({ day, frame, x }) => (
  <div style={{ position: "absolute", left: CARD_X + x, top: CARD_Y, width: CARD_W, borderRadius: 26, background: "#23242a", border: "1px solid #44454e", boxShadow: "0 40px 100px rgba(20,26,18,0.4)", fontFamily: FONT_BODY, overflow: "hidden" }}>
    <div style={{ height: HEAD, display: "flex", alignItems: "center", padding: "0 36px", borderBottom: "1px solid #36373f", gap: 20 }}>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 60, fontWeight: 800, color: A.textHi }}>{DAYS[day]}</span>
      <span style={{ fontSize: 36, color: A.muted }}>agent chores</span>
    </div>
    {ITEMS.map((t, i) => {
      const done = frame >= TICKS[day][i];
      const p = ease(frame, TICKS[day][i], TICKS[day][i] + 5);
      return (
        <div key={t} style={{ height: ROW, display: "flex", alignItems: "center", gap: 28, padding: "0 36px", borderBottom: i < 2 ? "1px solid #2e2f36" : "none" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, border: `3px solid ${done ? A.running : "#5a5b66"}`, background: done ? A.running : "transparent", display: "grid", placeItems: "center", opacity: 1, transform: `scale(${1 + 0.15 * Math.sin(p * Math.PI)})` }}>
            {done && <Icon name="check" size={36} color="#0f2a1a" stroke={3} />}
          </div>
          <span style={{ fontSize: 44, fontWeight: 600, color: done ? A.muted : A.textHi, textDecoration: done ? "line-through" : "none" }}>{t}</span>
        </div>
      );
    })}
    <div style={{ height: 14 }} />
  </div>
);

const Pain: React.FC = () => {
  const frame = useCurrentFrame();
  const c = cur(frame);
  const keys = DAYS.flatMap((_, d) => TICKS[d].map((t, i) => ({ x: CARD_X + 36 + 40, y: CARD_Y + HEAD + i * ROW + ROW / 2 + 10, at: t - 5, click: t, leave: t + 2 })));
  keys.unshift({ x: 1250, y: 1000, at: 14, click: undefined as unknown as number, leave: 16 });
  const ks = keys.map((k, i) => (i === 0 ? { x: k.x, y: k.y, at: k.at, leave: k.leave } : k));
  return (
    <>
      {DAYS.map((_, d) => {
        const x = (d - c) * 1010;
        return Math.abs(x) < 1100 ? <DayCard key={d} day={d} frame={frame} x={x} /> : null;
      })}
      <Pointer keys={ks} scale={1.9} color="#fff" />
    </>
  );
};

// ---------------- demo: the Schedules panel ----------------
const W = 565, S = 1.7, SX = 60, SY = 200, CARD_H = 200;
const NEXT_FOCUS = { x: 540, y: 600 };
const TOGGLE_AT = 52; // click (local)
const RAN_AT = 128;

const Toggle: React.FC<{ on: number }> = ({ on }) => (
  <div style={{ width: 66, height: 36, borderRadius: 18, background: on > 0.5 ? A.running : "#3a3b44", position: "relative", flexShrink: 0 }}>
    <div style={{ position: "absolute", top: 4, left: 4 + on * 30, width: 28, height: 28, borderRadius: 14, background: on > 0.5 ? "#12301f" : "#9a9ba5" }} />
  </div>
);

const RoutineCard: React.FC<{ name: string; sub: string; next: string; on: number; ran?: number; glow?: number }> = ({ name, sub, next, on, ran = 0, glow = 0 }) => (
  <div style={{ width: W, height: CARD_H, boxSizing: "border-box", borderRadius: 16, background: A.card, border: `1.5px solid ${glow ? `rgba(127,208,160,${0.35 + 0.5 * glow})` : A.border}`, padding: 20, position: "relative", fontFamily: FONT_BODY }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16, height: 52 }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: "#25262b", display: "grid", placeItems: "center", color: A.muted }}><Icon name="clock" size={28} /></div>
      <div style={{ fontSize: 26, fontWeight: 700, color: A.textHi, flex: 1, whiteSpace: "nowrap" }}>{name}</div>
      <Toggle on={on} />
    </div>
    <div style={{ marginTop: 12, fontSize: 22, color: A.muted, whiteSpace: "nowrap" }}>{sub}</div>
    <div style={{ position: "absolute", left: 20, right: 20, top: 118, height: 62 }}>
      <div style={{ position: "absolute", inset: 0, opacity: 1 - ran }}>
        <div style={{ fontSize: 22, color: A.subtle, letterSpacing: "0.08em", textTransform: "uppercase" }}>Next run</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: on > 0.5 ? A.running : A.subtle, marginTop: 2, opacity: on > 0.5 ? 1 : 0.7 }}>{on > 0.5 ? next : "Off"}</div>
      </div>
      <div style={{ position: "absolute", inset: 0, opacity: ran, transform: `translateY(${(1 - ran) * 14}px)`, display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, height: 52, padding: "0 20px", borderRadius: 26, background: "rgba(127,208,160,0.16)", border: `1.5px solid ${A.running}`, fontSize: 28, fontWeight: 700, color: A.running }}>
          <Icon name="check" size={30} color={A.running} stroke={3} />Ran · 3 tasks
        </div>
      </div>
    </div>
  </div>
);

const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const on = ease(frame, TOGGLE_AT, TOGGLE_AT + 8);
  const glow = ease(frame, TOGGLE_AT + 6, TOGGLE_AT + 16) * (1 - ease(frame, TOGGLE_AT + 40, TOGGLE_AT + 60));
  const ran = ease(frame, RAN_AT, RAN_AT + 8);
  const ranPop = frame >= RAN_AT ? spring({ frame: frame - RAN_AT, fps, config: { damping: 12, stiffness: 180, mass: 0.7 } }) : 0;
  const k = ease(frame, 66, 92, 1, 1.08);
  return (
    <div style={{ position: "absolute", inset: 0, transform: `scale(${k})`, transformOrigin: `${NEXT_FOCUS.x}px ${NEXT_FOCUS.y}px` }}>
      <div style={{ position: "absolute", left: SX, top: SY, width: W, transform: `scale(${S})`, transformOrigin: "0 0" }}>
        <Pop at={8} y={20} from={0.97} origin="0% 0%">
          <div style={{ height: 62, fontFamily: FONT_DISPLAY, fontSize: 44, fontWeight: 800, color: C.ink, letterSpacing: "-0.02em" }}>Schedules</div>
        </Pop>
        <Pop at={14} y={30} from={0.97} origin="50% 0%" style={{ position: "absolute", left: 0, top: 76 }}>
          <div style={{ transform: `scale(${1 + 0.03 * Math.sin(ranPop * Math.PI)})` }}>
            <RoutineCard name="Morning routine" sub="Weekdays 9:00 AM · Website" next="Tomorrow 9:00 AM" on={on} ran={ran} glow={glow} />
          </div>
        </Pop>
        <Pop at={26} y={30} from={0.97} origin="50% 0%" style={{ position: "absolute", left: 0, top: 76 + CARD_H + 14 }}>
          <RoutineCard name="Weekly report" sub={`Fridays 4:00 PM · API`} next="Friday 4:00 PM" on={1} />
        </Pop>
        <Pointer
          scale={0.95}
          color="#fff"
          keys={[
            { x: 760, y: 330, at: 34, leave: 36 },
            { x: W - 20 - 33, y: 76 + 20 + 26, at: TOGGLE_AT - 4, click: TOGGLE_AT, leave: TOGGLE_AT + 14 },
            { x: 800, y: 380, at: 100 },
          ]}
        />
      </div>
    </div>
  );
};

export const Short08Routines: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={WIPE_END}>
      <Pain />
      <HookTitle lines={["Same chores", "every morning?"]} accent="morning" />
    </Sequence>
    <Sequence from={DEMO} durationInFrames={END - DEMO + 30}>
      <Demo />
    </Sequence>
    <Turn at={tl.cues.turn} />
  </ShortShell>
);
