import React from "react";
import { Easing, Sequence, interpolate, useCurrentFrame } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { EndCard } from "./EndCard";
import { V2_TIMELINES } from "./timelinesV2";
import { A, ACCOUNTS, Icon, MicButton, PROJECTS, Pointer, Pop, ProjectGroup, ThreadRow, Wave } from "../ui";
import type { PointerKey } from "../ui";
import { clamp } from "../theme";
import { FONT_BODY } from "../fonts";

const tl = V2_TIMELINES.talk;
const f = (s: number) => Math.round(s * 30);
const END = f(tl.cues.endcard);
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: e });

// timings (seconds, from the narration lines)
const T_GLIDE = 5.7; // plate leaves, composer lifts
const T_PROJECT = 6.9; // "pick a project"
const T_MIC = 8.2; // "press the mic"
const T_SPEAK = 10.95; // sentence starts
const T_SPEAK_END = 13.7;
const T_SEND = 15.0;
const T_THREAD = 15.57; // "It becomes a thread"
const T_RUNNING = 16.6;
const T_DONE = 19.0; // "Talk, and it's done."
const SENTENCE = "Add a dark mode toggle to the settings page.";

// ---- vertical composer (native 640 wide, shown at 1.5 => 36 px text) ----
const CS = 1.65;
const CL = 78;
const CT = 400; // demo spot
const CT_END = 215; // lifts when the thread card arrives
const CT0 = 572; // top under the hook plate
const Chip: React.FC<{ label: string; w: number; glow?: number; strong?: boolean }> = ({ label, w, glow = 0, strong }) => (
  <div style={{ height: 48, width: w, padding: "0 16px", border: `1px solid ${glow ? `rgba(127,208,160,${0.4 + 0.5 * glow})` : A.input}`, background: `rgba(127,208,160,${0.14 * glow})`, borderRadius: 10, display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: strong ? A.textHi : A.text, whiteSpace: "nowrap", boxSizing: "border-box" }}>
    <span style={{ flex: 1 }}>{label}</span><Icon name="chevron" size={20} color={A.muted} />
  </div>
);

const Scene: React.FC = () => {
  const frame = useCurrentFrame();
  const glide = ease(frame, f(T_GLIDE), f(T_GLIDE) + 22);
  const lift = ease(frame, f(T_THREAD) - 6, f(T_THREAD) + 18);
  const top = CT0 + (CT - CT0) * glide + (CT_END - CT) * lift;
  const picked = frame >= f(T_PROJECT) + 6;
  const glow = ease(frame, f(T_PROJECT) + 4, f(T_PROJECT) + 14) * (1 - ease(frame, f(T_PROJECT) + 40, f(T_PROJECT) + 60));
  const listening = frame >= f(T_MIC) + 4 && frame < f(T_SEND) - 8;
  const lvl = listening
    ? 0.3 + 0.7 * ease(frame, f(T_SPEAK) - 4, f(T_SPEAK) + 8) * (1 - ease(frame, f(T_SPEAK_END), f(T_SPEAK_END) + 18))
    : 0;
  const typed = frame < f(T_SPEAK) ? 0 : Math.round(ease(frame, f(T_SPEAK), f(T_SPEAK_END), 0, SENTENCE.length, Easing.linear));
  const sent = frame >= f(T_SEND) + 4;
  const text = sent ? "" : SENTENCE.slice(0, typed);
  const sendState = frame >= f(T_SEND) && frame < f(T_SEND) + 6 ? 2 : frame >= f(T_SPEAK) + 20 && !sent ? 1 : 0;
  const dim = sent ? ease(frame, f(T_SEND) + 4, f(T_SEND) + 18, 1, 0.55) : 1;
  const caret = !sent && listening && Math.floor(frame / 14) % 2 === 0;
  const micOn = listening ? 1 : 0;

  // pointer targets in scene coordinates (composer is at final top by then)
  const px = (nx: number) => CL + nx * CS;
  const py = (ny: number) => CT + ny * CS;
  const keys: PointerKey[] = [
    { x: 760, y: 560, at: f(T_GLIDE) + 10, leave: f(T_PROJECT) - 14 },
    { x: px(80), y: py(186), at: f(T_PROJECT) - 10, click: f(T_PROJECT), leave: f(T_PROJECT) + 24 },
    { x: px(102), y: py(252), at: f(T_MIC) - 10, click: f(T_MIC), leave: f(T_MIC) + 40 },
    { x: px(514), y: py(252), at: f(T_SEND) - 12, click: f(T_SEND), leave: f(T_SEND) + 30 },
    { x: 860, y: 900, at: f(T_SEND) + 36 },
  ];

  return (
    <>
      <div style={{ position: "absolute", left: CL, top, transform: `scale(${CS})`, transformOrigin: "0 0", boxShadow: "0 30px 80px rgba(40,45,35,0.28)", borderRadius: 18, opacity: dim }}>
        <div style={{ width: 560, height: 302, border: `1px solid ${A.input}`, borderRadius: 18, background: "#202228", padding: 20, display: "flex", flexDirection: "column", boxSizing: "border-box", fontFamily: FONT_BODY }}>
          <div style={{ height: 130, fontSize: 30, lineHeight: 1.4, color: text ? A.textHi : A.subtle, overflow: "hidden" }}>
            {text || "What should we work on?"}
            {caret && <span style={{ display: "inline-block", width: 3, height: 34, background: A.textHi, marginLeft: 2, verticalAlign: -6 }} />}
          </div>
          <div style={{ height: 48, marginTop: 12, display: "flex", gap: 12 }}>
            <Chip label={picked ? "Website" : "Project"} w={160} glow={glow} strong={picked} />
            <Chip label={`${ACCOUNTS[3].provider} · ${ACCOUNTS[3].label}`} w={290} />
          </div>
          <div style={{ height: 60, marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, display: "grid", placeItems: "center", color: A.muted }}><Icon name="plus" size={28} /></div>
            <MicButton listening={micOn} size={52} />
            <div style={{ width: 272, height: 52, display: "flex", alignItems: "center", paddingLeft: 6, overflow: "hidden" }}>
              {listening ? <Wave level={lvl} n={30} h={48} /> : <div style={{ fontSize: 24, color: A.muted, border: `1px solid ${A.input}`, borderRadius: 10, padding: "6px 16px" }}>Ask first</div>}
            </div>
            <div style={{ marginLeft: "auto", width: 52, height: 52, borderRadius: 26, display: "grid", placeItems: "center", background: sendState ? "#e1e1e7" : "#3a3b43", color: sendState ? "#202126" : "#888994", transform: `scale(${sendState === 2 ? 0.86 : 1})` }}>
              <Icon name="arrowUp" size={28} stroke={2.4} />
            </div>
          </div>
        </div>
      </div>

      <Pop at={f(T_THREAD)} y={40} from={0.96} origin="50% 0%" style={{ position: "absolute", left: 78, top: CT_END + 302 * CS + 40, width: 560, transform: `scale(${CS})`, transformOrigin: "0 0" }}>
        <div style={{ borderRadius: 14, background: A.bg, border: `1px solid ${A.border}`, overflow: "hidden", boxShadow: "0 24px 60px rgba(40,45,35,0.28)" }}>
          <ProjectGroup name="Website" color={PROJECTS[0].color}>
            <ThreadRow
              title="Add dark mode toggle"
              status={frame >= f(T_DONE) ? "done" : frame >= f(T_RUNNING) ? "running" : "starting"}
              time="Now"
              account={ACCOUNTS[3]}
              sub={frame >= f(T_DONE) ? "Done" : undefined}
              style={{ borderBottom: "none" }}
            />
          </ProjectGroup>
        </div>
      </Pop>

      <Sequence from={0} durationInFrames={f(T_SEND) + 70}>
        <Pointer keys={keys} scale={2.4} />
      </Sequence>
    </>
  );
};

const PlateExit: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const o = ease(frame, f(T_GLIDE) - 8, f(T_GLIDE) + 8, 1, 0);
  return <div style={{ position: "absolute", inset: 0, opacity: o, transform: `translateY(${(1 - o) * -30}px)` }}>{children}</div>;
};

export const V2Short11Talk: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={END + 30}>
      <Scene />
    </Sequence>
    <Sequence from={0} durationInFrames={f(T_GLIDE) + 12}>
      <PlateExit>
        <HookTitle lines={["You talk.", "It's done."]} accent="done" />
      </PlateExit>
    </Sequence>
  </ShortShell>
);
