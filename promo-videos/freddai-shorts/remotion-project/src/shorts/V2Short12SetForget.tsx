import React from "react";
import { Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { EndCard } from "./EndCard";
import { V2_TIMELINES } from "./timelinesV2";
import { A, ACCOUNTS, Icon, MicButton, Pointer, Pop, ProjectGroup, ThreadRow } from "../ui";
import type { PointerKey } from "../ui";
import { C, clamp } from "../theme";
import { FONT_BODY, FONT_DISPLAY } from "../fonts";

const tl = V2_TIMELINES.setforget;
const f = (s: number) => Math.round(s * 30);
const END = f(tl.cues.endcard);
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: e });

const T_PLATE_OUT = 2.45;
const T_SEND = 3.0; // "Start a task"
const T_ROWS = 3.6; // rows appear one by one
const T_CALM = 5.8; // "no babysitting"
const T_ALL = 9.1; // "every agent runs on its own"
const T_LATER = 14.5; // "Come back later"
const DONE_AT = [15.0, 15.6, 16.2, 16.8];
const T_ALL_DONE = 17.2;

const TASKS = [
  { title: "Refactor billing module", acc: ACCOUNTS[3] },
  { title: "Write API tests", acc: ACCOUNTS[0] },
  { title: "Update onboarding emails", acc: ACCOUNTS[4] },
  { title: "Fix mobile login bug", acc: ACCOUNTS[5] },
];
const SUBS = ["Reading files", "Editing code", "Running tests"];

// ---- composer (frame 0 visual): vertical copy, native 640 wide, shown at 1.5 ----
const CS = 1.65, CL = 78, CT = 572;
const Chip: React.FC<{ label: string; w: number }> = ({ label, w }) => (
  <div style={{ height: 48, width: w, padding: "0 16px", border: `1px solid ${A.input}`, borderRadius: 10, display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: A.textHi, whiteSpace: "nowrap", boxSizing: "border-box" }}>
    <span style={{ flex: 1 }}>{label}</span><Icon name="chevron" size={20} color={A.muted} />
  </div>
);

const Composer: React.FC = () => {
  const frame = useCurrentFrame();
  const press = frame >= f(T_SEND) && frame < f(T_SEND) + 6;
  const ready = ease(frame, f(T_SEND) - 14, f(T_SEND) - 8);
  const out = ease(frame, f(T_SEND) + 8, f(T_SEND) + 26);
  if (out >= 1) return null;
  const caret = frame < f(T_SEND) + 6 && Math.floor(frame / 14) % 2 === 0;
  return (
    <div style={{ position: "absolute", left: CL, top: CT, transform: `translateY(${out * 90}px) scale(${CS * (1 - 0.06 * out)})`, transformOrigin: "0 0", opacity: 1 - out, boxShadow: "0 30px 80px rgba(40,45,35,0.28)", borderRadius: 18 }}>
      <div style={{ width: 560, height: 302, border: `1px solid ${A.input}`, borderRadius: 18, background: "#202228", padding: 20, display: "flex", flexDirection: "column", boxSizing: "border-box", fontFamily: FONT_BODY }}>
        <div style={{ height: 130, fontSize: 30, lineHeight: 1.4, color: A.textHi, overflow: "hidden" }}>
          Refactor the billing module and add tests.
          {caret && <span style={{ display: "inline-block", width: 3, height: 34, background: A.textHi, marginLeft: 2, verticalAlign: -6 }} />}
        </div>
        <div style={{ height: 48, marginTop: 12, display: "flex", gap: 12 }}>
          <Chip label="Website" w={160} /><Chip label={`${ACCOUNTS[3].provider} · ${ACCOUNTS[3].label}`} w={290} />
        </div>
        <div style={{ height: 60, marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, display: "grid", placeItems: "center", color: A.muted }}><Icon name="plus" size={28} /></div>
          <MicButton listening={0} size={52} />
          <div style={{ fontSize: 24, color: A.muted, border: `1px solid ${A.input}`, borderRadius: 10, padding: "6px 16px" }}>Ask first</div>
          <div style={{ marginLeft: "auto", width: 52, height: 52, borderRadius: 26, display: "grid", placeItems: "center", background: ready ? "#e1e1e7" : "#3a3b43", color: ready ? "#202126" : "#888994", transform: `scale(${press ? 0.86 : 1})` }}>
            <Icon name="arrowUp" size={28} stroke={2.4} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ---- time label: quiet "Now", then jumps to "2 h later" ----
const TimePill: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const jump = f(T_LATER);
  const later = frame >= jump;
  const p = later ? spring({ frame: frame - jump, fps, config: { damping: 11, stiffness: 190, mass: 0.7 } }) : 0;
  const spin = ease(frame, jump, jump + 26, 0, 720, Easing.out(Easing.cubic));
  const allDone = frame >= f(T_ALL_DONE);
  const dp = allDone ? spring({ frame: frame - f(T_ALL_DONE), fps, config: { damping: 13, stiffness: 180, mass: 0.7 } }) : 0;
  return (
    <Pop at={f(T_ROWS) - 6} y={-20} from={0.96} origin="50% 0%" style={{ position: "absolute", left: 0, right: 0, top: 196, display: "flex", justifyContent: "center", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, height: 104, padding: "0 40px", borderRadius: 52, background: "rgba(250,249,245,0.92)", border: `2px solid ${later ? C.forest : C.edge}`, boxShadow: "0 18px 50px rgba(40,45,35,0.14)", transform: `scale(${later ? 0.9 + 0.1 * p : 1})`, fontFamily: FONT_DISPLAY }}>
        <div style={{ transform: `rotate(${spin}deg)`, display: "grid", placeItems: "center", color: later ? C.forest : C.slate }}><Icon name="clock" size={56} stroke={2.2} /></div>
        <span style={{ fontSize: later ? 64 : 56, fontWeight: 800, letterSpacing: "-0.02em", color: later ? C.forest : C.slate }}>{later ? "2 h later" : "Now"}</span>
      </div>
      {allDone && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, height: 104, padding: "0 34px", borderRadius: 52, background: C.forest, color: C.white, fontFamily: FONT_DISPLAY, fontSize: 56, fontWeight: 800, transform: `scale(${0.8 + 0.2 * dp})`, opacity: Math.min(1, dp * 1.5) }}>
          <Icon name="check" size={52} color={C.white} stroke={3.2} />4 done
        </div>
      )}
    </Pop>
  );
};

const List: React.FC = () => {
  const frame = useCurrentFrame();
  const glow = ease(frame, f(T_ALL), f(T_ALL) + 14) * (1 - ease(frame, f(T_ALL) + 40, f(T_ALL) + 70));
  return (
    <Pop at={f(T_ROWS) - 4} y={50} from={0.97} origin="50% 0%" style={{ position: "absolute", left: 45, top: 330, width: 565, transform: "scale(1.75)", transformOrigin: "0 0" }}>
      <div style={{ borderRadius: 14, background: A.bg, border: `1px solid ${glow ? `rgba(127,208,160,${0.3 + 0.7 * glow})` : A.border}`, boxShadow: `0 24px 60px rgba(40,45,35,0.28), 0 0 ${30 * glow}px rgba(127,208,160,${0.5 * glow})`, overflow: "hidden" }}>
        <ProjectGroup name="All threads" color={C.sage}>
          {TASKS.map((t, i) => {
            const t0 = f(T_ROWS + i * 0.5);
            const run = t0 + 22;
            const doneF = f(DONE_AT[i]);
            const isDone = frame >= doneF;
            const status = isDone ? "done" : frame >= run ? "running" : "starting";
            const sub = isDone ? "Done" : frame >= f(T_CALM) ? SUBS[Math.floor((frame - f(T_CALM) + i * 23) / 42) % 3] : undefined;
            const dim = isDone && frame >= doneF + 12;
            return (
              <Pop key={t.title} at={t0} y={26} from={0.98} origin="50% 0%">
                <ThreadRow title={t.title} status={status} account={t.acc} sub={sub} dim={dim} time={frame >= f(T_LATER) ? "2h ago" : "Now"} style={{ borderBottom: i === TASKS.length - 1 ? "none" : undefined }} />
              </Pop>
            );
          })}
        </ProjectGroup>
      </div>
    </Pop>
  );
};

const Scene: React.FC = () => {
  const keys: PointerKey[] = [
    { x: 880, y: 760, at: f(T_PLATE_OUT) - 6, leave: f(T_SEND) - 16 },
    { x: CL + 514 * CS, y: CT + 252 * CS, at: f(T_SEND) - 12, click: f(T_SEND), leave: f(T_SEND) + 8 },
    { x: 1010, y: 1040, at: f(T_SEND) + 22 },
  ];
  return (
    <>
      <Composer />
      <TimePill />
      <List />
      <Sequence from={0} durationInFrames={f(T_SEND) + 26}>
        <Pointer keys={keys} scale={2.4} />
      </Sequence>
    </>
  );
};

const PlateExit: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const o = ease(frame, f(T_PLATE_OUT) - 6, f(T_PLATE_OUT) + 8, 1, 0);
  return <div style={{ position: "absolute", inset: 0, opacity: o, transform: `translateY(${(1 - o) * -30}px)` }}>{children}</div>;
};

export const V2Short12SetForget: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={END + 30}>
      <Scene />
    </Sequence>
    <Sequence from={0} durationInFrames={f(T_PLATE_OUT) + 12}>
      <PlateExit>
        <HookTitle lines={["Set it.", "Forget it."]} accent="Forget" />
      </PlateExit>
    </Sequence>
  </ShortShell>
);
