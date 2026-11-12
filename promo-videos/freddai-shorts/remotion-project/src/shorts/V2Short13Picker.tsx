import React from "react";
import { Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { V2_TIMELINES } from "./timelinesV2";
import { A, ACCOUNTS, AccountButton, Icon, Pointer, Pop, ProjectGroup, ThreadRow, UsageRing } from "../ui";
import { FONT_BODY } from "../fonts";
import { clamp } from "../theme";

const tl = V2_TIMELINES.picker;
const f = (s: number) => Math.round(s * 30);
const TURN = f(tl.cues.turn);
const WIPE_END = f(tl.cues.turn + TURN_WIPE_SECONDS);
const DEMO = f(tl.cues.demo);
const END = f(tl.cues.endcard);
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: e });
const L = (s: number) => f(s) - DEMO; // seconds -> local frame inside the demo Sequence
const typed = (text: string, frame: number, start: number, cps = 22) =>
  text.slice(0, Math.max(0, Math.min(text.length, Math.floor(((frame - start) / 30) * cps))));

const MAX = ACCOUNTS[2]; // Claude Code Max, 9% left
const WORK = ACCOUNTS[3]; // Claude Code work, 71% left
const PICKER = [MAX, WORK, ACCOUNTS[0]];

// ---------------- old way: two account chips, one nearly empty ----------------
const ChipCard: React.FC<{ a: typeof MAX; top: number; pulse: number }> = ({ a, top, pulse }) => (
  <div style={{ position: "absolute", left: 60, top, width: 960, height: 230, borderRadius: 28, background: A.bg, border: "1px solid #3a3b44", boxShadow: "0 30px 80px rgba(20,26,18,0.35)", overflow: "hidden" }}>
    <div style={{ transform: "scale(2.3)", transformOrigin: "0 0", width: 417 }}>
      <div style={{ padding: "26px 12px" }}>
        <AccountButton a={a} size={48} pulse={pulse} />
      </div>
    </div>
  </div>
);

const Chips: React.FC = () => {
  const frame = useCurrentFrame();
  const p1 = Math.sin(Math.PI * ease(frame, f(2.39), f(3.6))) ;
  const p2 = Math.sin(Math.PI * ease(frame, f(4.0), f(5.2)));
  return (
    <>
      <ChipCard a={MAX} top={620} pulse={Math.max(0, p1)} />
      <ChipCard a={WORK} top={870} pulse={Math.max(0, p2)} />
    </>
  );
};

// ---------------- demo ----------------
const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const OPEN = L(9.73);
  const open = spring({ frame: frame - OPEN, fps, config: { damping: 16, stiffness: 150, mass: 0.7 } });
  const closeP = ease(frame, OPEN + 50, OPEN + 58);
  const pickerOpen = frame >= OPEN ? open * (1 - closeP) : 0;
  const hover = frame >= OPEN + 20 && frame < OPEN + 48 ? 1 : null;
  const chosenWork = frame >= OPEN + 34;
  const account = frame >= OPEN + 46 ? WORK : MAX;
  const text = typed("Add a dark mode toggle", frame, 14);
  const sendActive = frame >= OPEN + 62 ? (frame >= OPEN + 72 && frame < OPEN + 80 ? 2 : 1) : 0;

  const SENT = OPEN + 82;
  const compOut = ease(frame, SENT, SENT + 12);
  const L5 = L(13.36);
  const CS = 1.9;

  return (
    <>
      {frame < SENT + 14 && (
        <div style={{ opacity: 1 - compOut, transform: `translateY(${compOut * 40}px)` }}>
          <Pop at={0} y={40} from={0.96} origin="50% 50%">
            <div style={{ position: "absolute", left: 65, top: 280, width: 500, height: 240, transform: `scale(${CS})`, transformOrigin: "0 0", fontFamily: FONT_BODY }}>
              <div style={{ width: 500, height: 240, boxSizing: "border-box", border: `1px solid ${A.input}`, borderRadius: 16, background: "#202228", padding: 20, position: "relative" }}>
                <div style={{ height: 70, fontSize: 22, lineHeight: 1.4, color: text ? A.textHi : A.subtle }}>
                  {text || "What should we work on?"}{frame < OPEN + 60 && <span style={{ display: "inline-block", width: 2, height: 26, background: A.textHi, marginLeft: 2, verticalAlign: -4 }} />}
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", height: 46, marginTop: 14 }}>
                  <div style={{ height: 46, padding: "0 14px", border: `1px solid ${A.input}`, borderRadius: 10, display: "flex", alignItems: "center", fontSize: 21, color: A.text }}>Website</div>
                  <div style={{ height: 46, padding: "0 12px", border: `1px solid ${A.input}`, borderRadius: 10, display: "flex", alignItems: "center", gap: 10, fontSize: 21, fontWeight: 600, color: A.textHi, whiteSpace: "nowrap" }}>
                    <UsageRing remaining={account.left} color={account.color} size={30} />
                    {account.provider} · {account.label}
                    <Icon name="chevron" size={18} color={A.muted} />
                  </div>
                </div>
                <div style={{ position: "absolute", right: 20, bottom: 20, width: 48, height: 48, borderRadius: 24, display: "grid", placeItems: "center", background: sendActive ? "#e1e1e7" : "#3a3b43", color: sendActive ? "#202126" : "#888994", transform: `scale(${1 - 0.12 * Math.max(0, sendActive - 1)})` }}>
                  <Icon name="arrowUp" size={26} stroke={2.2} />
                </div>
                {pickerOpen > 0 && (
                  <div style={{ position: "absolute", left: 20, top: 158 - 1, width: 440, borderRadius: 12, background: "#24252a", border: `1px solid ${A.input}`, boxShadow: "0 30px 70px rgba(0,0,0,0.55)", padding: 6, opacity: interpolate(pickerOpen, [0, 0.6], [0, 1], clamp), transform: `translateY(${interpolate(pickerOpen, [0, 1], [-10, 0])}px)`, zIndex: 5 }}>
                    {PICKER.map((a, i) => (
                      <div key={a.id} style={{ height: 60, display: "flex", alignItems: "center", gap: 12, padding: "0 12px", borderRadius: 8, fontSize: 21, color: A.textHi, background: hover === i ? "#34353d" : "transparent" }}>
                        <UsageRing remaining={a.left} color={a.color} size={34} />
                        <span style={{ whiteSpace: "nowrap" }}>{a.provider} · {a.label}</span>
                        <span style={{ marginLeft: "auto", color: a.left <= 10 ? A.amber : A.muted }}>{(chosenWork ? WORK.id : MAX.id) === a.id ? <Icon name="check" size={22} color={A.textHi} /> : `${a.left}%`}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Pointer scale={0.6} keys={[
                  { x: 430, y: 120, at: OPEN - 4, leave: OPEN - 2 },
                  { x: 290, y: 127, at: OPEN, click: OPEN + 4, leave: OPEN + 24 },
                  { x: 270, y: 254, at: OPEN + 30, click: OPEN + 36, leave: OPEN + 52 },
                  { x: 456, y: 192, at: OPEN + 66, click: OPEN + 74, leave: OPEN + 90 },
                ]} />
              </div>
            </div>
          </Pop>
        </div>
      )}
      {frame >= SENT + 6 && (
        <div style={{ position: "absolute", left: 60, top: 370, width: 960 }}>
          <Pop at={SENT + 6} y={40} from={0.96} origin="50% 50%">
            <div style={{ height: 330, borderRadius: 28, background: A.bg, border: "1px solid #303137", boxShadow: "0 30px 80px rgba(20,26,18,0.3)", overflow: "hidden" }}>
              <div style={{ width: 427, transform: "scale(2.25)", transformOrigin: "0 0" }}>
                <ProjectGroup name="Website" color="#9a86e8">
                  <ThreadRow title="Dark mode toggle" status={frame >= SENT + 22 ? "running" : "starting"} time="" account={WORK} pulse={Math.max(0, Math.sin(Math.PI * ease(frame, L5, L5 + 26)))} />
                </ProjectGroup>
              </div>
            </div>
          </Pop>
          <Pop at={L5} y={30} from={0.96} origin="50% 0%" style={{ marginTop: 40 }}>
            <div style={{ height: 170, borderRadius: 28, background: A.bg, border: "1px solid #303137", boxShadow: "0 30px 80px rgba(20,26,18,0.3)", overflow: "hidden" }}>
              <div style={{ transform: "scale(2.2)", transformOrigin: "0 0", width: 436, padding: "14px 12px" }}>
                <AccountButton a={WORK} size={48} fill={ease(frame, L5 + 4, L5 + 30)} />
              </div>
            </div>
          </Pop>
        </div>
      )}
    </>
  );
};

export const V2Short13Picker: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={WIPE_END}>
      <Chips />
      <HookTitle lines={["Which account", "takes this one?"]} accent="one" />
    </Sequence>
    <Sequence from={DEMO} durationInFrames={END - DEMO + 30}>
      <Demo />
    </Sequence>
    <Turn at={tl.cues.turn} />
  </ShortShell>
);
