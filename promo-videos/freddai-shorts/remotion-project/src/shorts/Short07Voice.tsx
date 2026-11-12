import React from "react";
import { Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { SHORT_TIMELINES } from "./timelines";
import { Words } from "../text";
import { A, ACCOUNTS, Dormouse, HomeTile, Icon, MicButton, PROJECTS, Pointer, ThreadRow, Wave } from "../ui";
import type { PointerKey } from "../ui";
import { C, clamp } from "../theme";
import { FONT_BODY } from "../fonts";

const tl = SHORT_TIMELINES.voice;
const fr = (s: number) => Math.round(s * 30);
const PAIN_END = fr(tl.cues.turn + TURN_WIPE_SECONDS); // 215
const DEMO = 214; // demo scene mounts when the turn wipe has covered the old scene
const ease = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

// ============================================================ vertical composer (copy of ui.tsx Composer, laid out for a phone canvas)
// Native 640x302 (text 24 px) shown at scale 1.5 => 36 px on the 1080 canvas. Same parts as the desktop Composer:
// text area, project + account pickers, plus, mic, "Ask first", primary button (Start, as in the film's Home tile).
const CS = 1.5;
const Chip: React.FC<{ label: string; w?: number }> = ({ label, w }) => (
  <div style={{ height: 48, width: w, padding: "0 16px", border: `1px solid ${A.input}`, borderRadius: 10, display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: A.textHi, whiteSpace: "nowrap", boxSizing: "border-box" }}>
    <span style={{ flex: 1 }}>{label}</span><Icon name="chevron" size={20} color={A.muted} />
  </div>
);
const VComposer: React.FC<{ width: number; text: string; placeholder?: string; caret?: boolean; listening?: number; level?: number; start?: 0 | 1 | 2; textStyle?: React.CSSProperties; areaH?: number }> = ({ areaH = 130, width, text, placeholder = "What should we work on?", caret, listening = 0, level = 1, start = 0, textStyle }) => (
  <div style={{ width, height: 172 + areaH, border: `1px solid ${A.input}`, borderRadius: 18, background: "#202228", padding: 20, display: "flex", flexDirection: "column", boxSizing: "border-box", fontFamily: FONT_BODY }}>
    <div style={{ height: areaH, fontSize: 24, lineHeight: 1.45, color: text ? A.textHi : A.subtle, overflow: "hidden", ...textStyle }}>
      {listening ? <div style={{ paddingTop: (areaH - 64) / 2 }}><Wave level={level} n={62} h={64} /></div> : <>{text || placeholder}{caret && <span style={{ display: "inline-block", width: 3, height: 28, background: A.textHi, marginLeft: 2, verticalAlign: -5 }} />}</>}
    </div>
    <div style={{ height: 48, marginTop: 12, display: "flex", gap: 12 }}>
      <Chip label="API" w={130} /><Chip label="Codex · work" w={260} />
    </div>
    <div style={{ height: 60, marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 44, height: 44, display: "grid", placeItems: "center", color: A.muted }}><Icon name="plus" size={28} /></div>
      <MicButton listening={listening} size={52} />
      <div style={{ fontSize: 24, color: A.muted, border: `1px solid ${A.input}`, borderRadius: 10, padding: "6px 16px" }}>Ask first</div>
      <div style={{ marginLeft: "auto", width: 130, height: 52, borderRadius: 12, display: "grid", placeItems: "center", fontSize: 24, fontWeight: 700, background: start ? "#e1e1e7" : "#3a3b43", color: start ? "#202126" : "#888994", transform: `scale(${start === 2 ? 0.9 : 1})` }}>Start</div>
    </div>
  </div>
);
// layout constants (native) used to aim the cursor
const MIC = { x: 20 + 44 + 12 + 26, y: 222 + 30 };
const START = { x: 20 + 572 - 65 + 0, y: 222 + 30 };

// ============================================================ pain: typing a long task, slowly
const A_TXT = "Add a retry to the upload worker so a flaky network does not lose a file, log every failed attempt, wait longer between tries, and open a PR with tests.";
const B_TXT = " not drop a file, log each failed try, then open a PR.";
const PRE = 38, CPS1 = 14, T_PAUSE1 = 100, T_DEL = 114, DEL_N = 28, T_RETYPE = 148, CPS2 = 16;
const X1 = " not drop a file, log", X2 = " file, then open a PR";
const painText = (f: number) => {
  if (f < 96) return A_TXT.slice(0, Math.min(83, PRE + Math.floor(f * 0.5)));
  if (f < 116) return A_TXT.slice(0, 83 - Math.min(27, Math.floor((f - 96) * 1.5)));
  const base = A_TXT.slice(0, 56);
  const n1 = Math.min(X1.length, Math.floor((f - 116) * 0.6));
  if (f < 154) return base + X1.slice(0, n1);
  const full = base + X1;
  if (f < 170) return full.slice(0, full.length - Math.min(12, Math.floor((f - 154) * 0.8)));
  return full.slice(0, full.length - 12) + X2.slice(0, Math.floor((f - 170) * 0.5));
};

const PAIN_LEFT = 60, PAIN_TOP = 560, PAIN_W = 640, PAIN_AREA = 200;
const PainScene: React.FC = () => {
  const f = useCurrentFrame();
  const mx = PAIN_LEFT + MIC.x * CS, my = PAIN_TOP + (MIC.y + PAIN_AREA - 130) * CS;
  const keys: PointerKey[] = [
    { x: mx + 150, y: my - 160, at: 16, leave: 30 },
    { x: mx + 8, y: my + 6, at: 70, leave: 104 },
    { x: 560, y: PAIN_TOP + 150, at: 120, leave: 132 },
    { x: mx + 4, y: my + 4, at: 146, leave: 158 },
    { x: 700, y: PAIN_TOP + 300, at: 170, leave: 180 },
    { x: mx + 4, y: my + 4, at: 192 },
  ];
  return (
    <>
      <div style={{ position: "absolute", left: PAIN_LEFT, top: PAIN_TOP, transform: `scale(${CS})`, transformOrigin: "0 0", boxShadow: "0 30px 80px rgba(40,45,35,0.25)", borderRadius: 18 }}>
        <VComposer width={PAIN_W} areaH={PAIN_AREA} text={painText(f)} caret={Math.floor(f / 14) % 2 === 0} />
      </div>
      <Pointer keys={keys} scale={2.4} />
    </>
  );
};

// ============================================================ demo: Home, mic, text lands, Start, thread row
const PANEL = { x: 60, w: 960, top: 180, bottom: 1105 };
const TILE_S = 2.12, TILE_W = 430;
const COMP_X = 20, COMP_TOP = 960, COMP_W = 612;
const ROWS_TOP = 1443, ROW_S = 2.25, ROW_W = 409, ROW_H = 84 * ROW_S;
const SPOKEN = "Add a retry to the upload worker and open a PR";
// demo-local events
const SCROLL_A = 18, SCROLL_B = 40;
const MIC_CLICK = 42, LISTEN_END = 58, START_CLICK = 74, ROW_AT = 78, RUNNING = 92, SHRINK = 82, WORDS_AT = 85;

const RowBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ width: ROW_W * ROW_S, height: ROW_H }}><div style={{ width: ROW_W, height: 84, transform: `scale(${ROW_S})`, transformOrigin: "0 0" }}>{children}</div></div>
);

const DemoScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: f - 2, fps, config: { damping: 17, stiffness: 140, mass: 0.9 } });
  const e2 = spring({ frame: f - SHRINK, fps, config: { damping: 18, stiffness: 120, mass: 0.9 } });
  const scroll = 920 * ease(f, SCROLL_A, SCROLL_B) + (ROWS_TOP - 16 - 920) * e2;
  const top = PANEL.top + (PANEL.bottom - 515 - PANEL.top) * e2;
  const height = PANEL.bottom - top;

  const listening = f >= MIC_CLICK && f < LISTEN_END ? 1 : 0;
  const level = interpolate(f, [MIC_CLICK, MIC_CLICK + 5, LISTEN_END - 3, LISTEN_END], [0.2, 1, 1, 0.15], clamp);
  const landed = f >= LISTEN_END && f < START_CLICK + 5;
  const land = spring({ frame: f - LISTEN_END, fps, config: { damping: 15, stiffness: 190, mass: 0.8 } });
  const start: 0 | 1 | 2 = f >= START_CLICK && f < START_CLICK + 5 ? 2 : landed && f >= LISTEN_END + 2 ? 1 : 0;
  const newP = spring({ frame: f - ROW_AT, fps, config: { damping: 16, stiffness: 140, mass: 0.9 } });
  const running = f >= RUNNING;

  const micX = COMP_X + MIC.x * CS, micY = COMP_TOP + MIC.y * CS;
  const startX = COMP_X + START.x * CS, startY = COMP_TOP + START.y * CS;
  const keys: PointerKey[] = [
    { x: 880, y: 560, at: 8, leave: 22 },
    { x: micX + 4, y: micY + 4, at: 38, click: MIC_CLICK, leave: 62 },
    { x: startX, y: startY, at: 70, click: START_CLICK, leave: 96 },
  ];

  return (
    <>
      <div style={{ position: "absolute", left: PANEL.x, top, width: PANEL.w, height, borderRadius: 28, background: "#1b1c20", border: `2px solid ${A.border}`, boxShadow: "0 40px 100px rgba(40,45,35,0.35)", overflow: "hidden", opacity: Math.min(1, enter * 1.5), transform: `translateY(${(1 - enter) * 70}px)`, boxSizing: "border-box" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: PANEL.w, transform: `translateY(${-scroll}px)` }}>
          {/* header: mascot + Home */}
          <div style={{ position: "absolute", left: 28, top: 10, display: "flex", alignItems: "center", gap: 28 }}>
            <Dormouse size={100} />
            <div>
              <div style={{ fontSize: 56, fontWeight: 800, color: A.textHi, lineHeight: 1.05, fontFamily: FONT_BODY }}>Home</div>
              <div style={{ fontSize: 38, color: A.muted, fontFamily: FONT_BODY }}>3 projects · 3 working</div>
            </div>
          </div>
          {/* project tiles */}
          <div style={{ position: "absolute", left: 20, top: 124, width: TILE_W, transform: `scale(${TILE_S})`, transformOrigin: "0 0", display: "flex", flexDirection: "column", gap: 0, fontFamily: FONT_BODY }}>
            {[{ i: 0, w: 1, d: 1 }, { i: 1, w: 1, d: 1 }, { i: 2, w: 1, d: 2 }].map(({ i, w, d }) => {
              const p = ease(f, i * 3, 9 + i * 3);
              return (
                <div key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 20}px)` }}>
                  <HomeTile name={PROJECTS[i].name} color={PROJECTS[i].color} working={w} done={d} width={TILE_W} />
                </div>
              );
            })}
          </div>
          {/* composer */}
          <div style={{ position: "absolute", left: COMP_X, top: COMP_TOP, transform: `scale(${CS})`, transformOrigin: "0 0" }}>
            <VComposer width={COMP_W} text={landed ? SPOKEN : ""} listening={listening} level={level} start={start}
              textStyle={landed ? { opacity: Math.min(1, land * 1.6), transform: `translateY(${(1 - land) * 14}px)` } : undefined} />
          </div>
          {/* threads */}
          <div style={{ position: "absolute", left: 20, top: ROWS_TOP, width: ROW_W * ROW_S }}>
            <div style={{ height: ROW_H * newP, overflow: "hidden" }}>
              <RowBox>
                <ThreadRow title="Retry in the upload worker" status={running ? "running" : "starting"} time="now" account={running ? ACCOUNTS[1] : undefined} pulse={running ? 0 : 1} />
              </RowBox>
            </div>
            <RowBox><ThreadRow title="Polish the pricing page" status="running" account={ACCOUNTS[0]} /></RowBox>
            <RowBox><ThreadRow title="Fix navigation on tablets" status="done" dim /></RowBox>
          </div>
          <Pointer keys={keys} scale={2.4} />
        </div>
      </div>
      {f >= WORDS_AT - 2 && (
        <div style={{ position: "absolute", left: 60, width: 960, top: 215, display: "flex", justifyContent: "center" }}>
          <div style={{ width: 760 }}>
            <Words text="Hands free. Head up." size={128} color={C.ink} delay={WORDS_AT} />
          </div>
        </div>
      )}
    </>
  );
};

export const Short07Voice: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={PAIN_END} name="pain: typing">
      <PainScene />
      <HookTitle lines={["Just say it."]} />
    </Sequence>
    <Sequence from={DEMO} durationInFrames={tl.durationInFrames - DEMO} name="demo: Home + mic">
      <DemoScene />
    </Sequence>
    <Turn at={tl.cues.turn} />
  </ShortShell>
);
