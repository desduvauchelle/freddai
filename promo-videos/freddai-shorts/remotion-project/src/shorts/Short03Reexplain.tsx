import React, { CSSProperties, ReactNode } from "react";
import { Easing, interpolate, Sequence, useCurrentFrame } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { SHORT_TIMELINES } from "./timelines";
import { A, ACCOUNTS, AccountButton, Icon, Pointer, Pop, PROJECTS, TrafficLights } from "../ui";
import type { PointerKey } from "../ui";
import { Typewriter, Words } from "../text";
import { C, clamp } from "../theme";
import { FONT_BODY, FONT_MONO } from "../fonts";

const tl = SHORT_TIMELINES.reexplain;
const F = (s: number) => Math.round(s * 30);
const acct = (id: string) => ACCOUNTS.find((a) => a.id === id)!;
const ease = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

// --- camera: keyed (scale, world point shown at the viewport centre), eased between keys ---
type Key = { f: number; sc: number; x: number; y: number };
const camAt = (frame: number, keys: Key[]) => {
  if (frame <= keys[0].f) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    if (frame < keys[i + 1].f) {
      const p = interpolate(frame, [keys[i].f, keys[i + 1].f], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
      const l = (a: number, b: number) => a + (b - a) * p;
      return { f: frame, sc: l(keys[i].sc, keys[i + 1].sc), x: l(keys[i].x, keys[i + 1].x), y: l(keys[i].y, keys[i + 1].y) };
    }
  }
  return keys[keys.length - 1];
};
const VP = { x: 60, y: 180, w: 960, h: 944, bar: 72 };
const CX = VP.w / 2, CY = (VP.h - VP.bar) / 2;
const camStyle = (c: Key): CSSProperties => ({ position: "absolute", left: 0, top: 0, width: VP.w, height: 2400, transformOrigin: "0 0", transform: `translate(${CX - c.sc * c.x}px, ${CY - c.sc * c.y}px) scale(${c.sc})` });

// Freddai dark window (surface #1e241e) cropped to the safe band.
const Viewport: React.FC<{ at: number; out?: number; title: string; children: ReactNode }> = ({ at, out, title, children }) => {
  const frame = useCurrentFrame();
  const o = out === undefined ? 1 : 1 - ease(frame, out, out + 8);
  if (o <= 0) return null;
  return (
    <Pop at={at} y={50} from={0.92} origin="50% 50%" style={{ position: "absolute", left: VP.x, top: VP.y, width: VP.w, height: VP.h, opacity: o }}>
      <div style={{ width: VP.w, height: VP.h, borderRadius: 32, overflow: "hidden", background: "#1e241e", border: "1px solid #404a3b", boxShadow: "0 50px 120px rgba(40,45,35,0.35), 0 12px 30px rgba(40,45,35,0.2)", position: "relative", fontFamily: FONT_BODY }}>
        <div style={{ height: VP.bar, background: "#282f26", borderBottom: "1px solid #404a3b", display: "flex", alignItems: "center", gap: 24, padding: "0 30px" }}>
          <TrafficLights />
          <div style={{ fontSize: 38, fontWeight: 700, color: C.textDark }}>{title}</div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: VP.bar, bottom: 0, overflow: "hidden" }}>{children}</div>
      </div>
    </Pop>
  );
};



// ============ PAIN ============
const PARA = "This repo is a Tauri app. packages/app is the React side, use pnpm, never touch the generated bindings, run the tests before you commit.";
// pass k: starts typing at `start` (frames, may be negative = already typing at frame 0), speed cps, send at `send`
const PASSES = [
  { start: -50, cps: 36, send: 100 },
  { start: 128, cps: 80, send: 205 },
  { start: 222, cps: 160, send: 252 },
];
const NEW_AT = [0, 112, 214]; // when chat k appears (fresh, empty)

const ChatWin: React.FC<{ k: number }> = ({ k }) => {
  const frame = useCurrentFrame();
  const p = PASSES[k];
  const born = NEW_AT[k];
  const last = k === PASSES.length - 1;
  const nextBorn = last ? 9999 : NEW_AT[k + 1];
  const behind = frame >= nextBorn;
  const sent = frame >= p.send;
  const lift = ease(frame, p.send, p.send + 10);
  const inner = (
    <div style={{ width: 940, height: 440, borderRadius: 24, overflow: "hidden", background: "#23242a", border: "1px solid #44454e", boxShadow: "0 30px 90px rgba(20,26,18,0.45)", fontFamily: FONT_BODY, position: "relative", filter: behind ? "brightness(0.7)" : undefined }}>
      <div style={{ height: 64, background: "#2c2d34", display: "flex", alignItems: "center", gap: 20, padding: "0 24px", fontSize: 36, fontWeight: 700, color: A.textHi }}>
        <TrafficLights />New chat{k > 0 ? ` (${k + 1})` : ""}
      </div>
      {sent && (
        <div style={{ margin: "18px 30px 0", padding: "14px 24px", borderRadius: 20, background: "#3a3b43", fontSize: 36, lineHeight: 1.3, color: A.textHi, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", opacity: lift, transform: `translateY(${(1 - lift) * 60}px)` }}>{PARA}</div>
      )}
      {!sent && (
        <div style={{ position: "absolute", left: 24, right: 24, bottom: 24, top: 84, border: `2px solid ${A.input}`, borderRadius: 20, background: "#1a1b1f", padding: "20px 26px", fontSize: 38, lineHeight: 1.32, color: A.textHi }}>
          <Typewriter text={PARA} start={p.start} cps={p.cps} cursorColor={A.textHi} />
        </div>
      )}
      {sent && <div style={{ position: "absolute", right: 36, bottom: 26, width: 64, height: 64, borderRadius: 32, background: "#e1e1e7", display: "grid", placeItems: "center" }}><Icon name="arrowUp" size={34} color="#202126" stroke={2.4} /></div>}
    </div>
  );
  if (k > 0 && frame < born) return null;
  const pile = PASSES.length - 1 - k;
  const stack = frame >= nextBorn ? -32 * (frame >= (NEW_AT[k + 2] ?? 9999) ? 2 : 1) : 0;
  const enter = k === 0 ? 1 : ease(frame, born, born + 8);
  return <div style={{ position: "absolute", left: 70, top: 630 + 16 * k + stack, opacity: enter, transform: `translateX(${(1 - enter) * 500}px)` }}>{inner}</div>;
};

const Pain: React.FC = () => (
  <>
    {[0, 1, 2].map((k) => <ChatWin key={k} k={k} />)}
    <HookTitle lines={["Stop re-explaining", "your project."]} accent="project" />
  </>
);

// ============ DEMO ============
const DEMO = F(tl.cues.demo);
const END = F(tl.cues.endcard);
const ROW = 104, AOFF = 350;
const PanelScene: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = camAt(frame, [
    { f: 0, sc: 1, x: CX, y: CY },
    { f: 150, sc: 1, x: CX, y: CY },
    { f: 172, sc: 1, x: CX, y: CY + 160 },
  ]);
  const o = 1 - ease(frame, 216, 224);
  if (o <= 0) return null;
  const projPicked = frame >= 134;
  const accPicked = frame >= 184;
  const started = frame >= 202;
  const accs = ["codex-personal", "claude-work", "gemini", "grok"].map(acct);
  const keys: PointerKey[] = [
    { x: 1100, y: 150, at: 98, leave: 102 },
    { x: 220, y: 142, at: 128, click: 132, leave: 146 },
    { x: 260, y: AOFF + 62 + ROW + 8 + 52, at: 180, click: 184, leave: 196 },
    { x: 470, y: AOFF + 62 + 4 * (ROW + 8) + 14 + 48, at: 198, click: 202, leave: 230 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o }}>
      <div style={camStyle(cam)}>
        <div style={{ position: "absolute", left: 40, top: 14, fontSize: 36, fontWeight: 700, color: "#98a08c", fontFamily: FONT_BODY, letterSpacing: "0.06em" }}>PROJECT</div>
        <Pop at={4} y={30} origin="50% 50%" style={{ position: "absolute", left: 40, top: 64, width: 880 }}>
          <div style={{ borderRadius: 24, border: `2px solid ${projPicked ? "#b9c99a" : "#404a3b"}`, background: "#282f26", padding: "20px 26px", fontFamily: FONT_BODY }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20, height: 60 }}>
              <div style={{ width: 28, height: 28, borderRadius: 14, background: PROJECTS[0].color }} />
              <div style={{ fontSize: 46, fontWeight: 800, color: C.textDark }}>Website</div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, fontFamily: FONT_MONO, fontSize: 36, color: "#98a08c" }}><Icon name="folder" size={36} />~/code/website</div>
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 20, flexWrap: "wrap" }}>
              {[["branch", "main"], ["branch", "Separate worktree"], ["check", "Ask first"]].map(([ic, t], i) => (
                <Pop key={t} at={8 + i * 4} y={14} origin="50% 50%">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 22px", borderRadius: 40, border: "2px solid #404a3b", fontSize: 36, color: C.textDark }}><Icon name={ic} size={32} color="#b9c99a" />{t}</div>
                </Pop>
              ))}
            </div>
            {projPicked && <div style={{ marginTop: 14, fontSize: 36, color: "#b9c99a", display: "flex", alignItems: "center", gap: 10 }}><Icon name="check" size={34} color="#b9c99a" stroke={2.6} />Set up once, ready</div>}
          </div>
        </Pop>
        <div style={{ position: "absolute", left: 40, top: AOFF, fontSize: 36, fontWeight: 700, color: "#98a08c", fontFamily: FONT_BODY, letterSpacing: "0.06em" }}>ACCOUNT</div>
        {accs.map((a, i) => (
          <Pop key={a.id} at={10 + i * 4} y={20} origin="50% 50%" style={{ position: "absolute", left: 40, top: AOFF + 62 + i * (ROW + 8), width: 880 }}>
            <div style={{ height: ROW, borderRadius: 20, border: `2px solid ${accPicked && a.id === "claude-work" ? "#b9c99a" : "#404a3b"}`, background: accPicked && a.id === "claude-work" ? "#34402f" : "#282f26", display: "flex", alignItems: "center", padding: "0 16px" }}>
              <AccountButton a={a} size={88} />
              {accPicked && a.id === "claude-work" && <div style={{ marginLeft: "auto", paddingRight: 12 }}><Icon name="check" size={44} color="#b9c99a" stroke={2.6} /></div>}
            </div>
          </Pop>
        ))}
        <div style={{ position: "absolute", left: 40, top: AOFF + 62 + 4 * (ROW + 8) + 14, width: 880, height: 96, borderRadius: 24, background: "#e1e1e7", color: "#202126", display: "flex", alignItems: "center", justifyContent: "center", gap: 16, fontSize: 44, fontWeight: 800, fontFamily: FONT_BODY, transform: `scale(${started && frame < 210 ? 0.96 : 1})` }}>
          {started ? "Starting…" : "Start thread"}<Icon name="arrowUp" size={40} stroke={2.6} style={{ transform: "rotate(90deg)" }} />
        </div>
        <Pointer keys={keys} scale={1.5} />
      </div>
    </div>
  );
};

const Demo: React.FC = () => (
  <Viewport at={0} out={216} title="Freddai · New thread">
    <PanelScene />
  </Viewport>
);

const Close: React.FC = () => (
  <>
    <div style={{ position: "absolute", left: 60, width: 960, top: 270 }}>
      <Words text="Same desk." size={170} color={C.ink} delay={73} gradientWords={["desk."]} />
    </div>
    <div style={{ position: "absolute", left: 220, width: 640, top: 560, display: "flex", flexDirection: "column", gap: 20 }}>
      {(["codex-personal", "claude-work", "gemini", "grok"] as const).map((id, i) => {
        const a = acct(id);
        return (
          <Pop key={id} at={6 + i * 14} y={30} origin="50% 50%">
            <div style={{ height: 110, borderRadius: 28, background: "#1e241e", display: "flex", alignItems: "center", gap: 24, padding: "0 34px", boxShadow: "0 16px 40px rgba(40,45,35,0.25)" }}>
              <div style={{ width: 66, height: 66, borderRadius: 33, background: `${a.color}33`, border: `2px solid ${a.color}`, display: "grid", placeItems: "center", color: a.color, fontSize: 36, fontWeight: 800 }}>{a.glyph}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 48, fontWeight: 700, color: C.textDark }}>{a.provider}</div>
            </div>
          </Pop>
        );
      })}
    </div>
  </>
);

export const Short03Reexplain: React.FC = () => {
  const turnEnd = F(tl.cues.turn + TURN_WIPE_SECONDS);
  const closeAt = DEMO + 210;
  return (
    <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
      <Sequence from={0} durationInFrames={turnEnd + 1}><Pain /></Sequence>
      <Sequence from={DEMO} durationInFrames={closeAt - DEMO + 12}><Demo /></Sequence>
      <Sequence from={closeAt} durationInFrames={END - closeAt + 12}><Close /></Sequence>
      <Turn at={tl.cues.turn} />
    </ShortShell>
  );
};
