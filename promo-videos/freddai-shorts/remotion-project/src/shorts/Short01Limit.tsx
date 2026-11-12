import React, { CSSProperties, ReactNode } from "react";
import { Easing, interpolate, Sequence, useCurrentFrame } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { TerminalPane, LoginForm, FolderDialog, TabPile } from "./OldWay";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { SHORT_TIMELINES } from "./timelines";
import { A, ACCOUNTS, Composer, Icon, Pointer, Pop, ProviderCard, ThreadRow, TrafficLights, usePop } from "../ui";
import type { PointerKey } from "../ui";
import { Words } from "../text";
import { shakeOffset } from "../fx";
import { C, clamp } from "../theme";
import { FONT_BODY, FONT_MONO } from "../fonts";

const tl = SHORT_TIMELINES.limit;
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

// ============ PAIN (0 .. turn) ============
const HOOK_OUT = 66; // hook plate steps aside as the old routine starts
const Slide: React.FC<{ a: number; out: number; children: ReactNode }> = ({ a, out, children }) => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [a - 2, a + 9], [700, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const o = 1 - ease(frame, out, out + 6);
  if (frame < a - 2 || o <= 0) return null;
  return <div style={{ position: "absolute", left: 0, top: 0, opacity: o, transform: `translateX(${x}px)` }}>{children}</div>;
};

const AgainBanner: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const p = usePop(at, { damping: 13, stiffness: 220, mass: 0.7 });
  const s = shakeOffset(frame, frame >= at && frame < at + 10 ? 9 : 0, "again");
  if (frame < at) return null;
  return (
    <div style={{ position: "absolute", left: 94, top: 950, width: 892, height: 96, borderRadius: 16, background: "#3d2a0d", border: "2px solid #e9b667", display: "flex", alignItems: "center", gap: 20, padding: "0 28px", boxSizing: "border-box", fontFamily: FONT_BODY, fontSize: 38, fontWeight: 700, color: "#f6d9a5", opacity: interpolate(p, [0, 0.5], [0, 1], clamp), transform: `translate(${s.x}px, ${interpolate(p, [0, 1], [30, 0]) + s.y}px)` }}>
      <Icon name="alert" size={46} color="#e9b667" stroke={2} />Usage limit reached again
    </div>
  );
};

const Pain: React.FC = () => {
  const frame = useCurrentFrame();
  const shift = -140 * interpolate(frame, [HOOK_OUT + 4, HOOK_OUT + 24], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const hookO = 1 - ease(frame, HOOK_OUT - 4, HOOK_OUT + 8);
  return (
    <>
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${shift}px)` }}>
        <TerminalPane at={0} bannerAt={1.2} height={500} style={{ position: "absolute", left: 70, top: 570 }} />
        <Slide a={F(2.9)} out={F(4.9)}><LoginForm at={2.9} style={{ position: "absolute", left: 70, top: 710 }} /></Slide>
        <Slide a={F(4.7)} out={F(6.5)}><FolderDialog at={4.7} style={{ position: "absolute", left: 70, top: 640 }} /></Slide>
        {frame >= F(6.0) && frame < F(7.3) && <TabPile count={5} at={6.0} style={{ position: "absolute", left: 70, top: 800, opacity: 1 - ease(frame, F(7.15), F(7.3)) }} />}
        <AgainBanner at={F(7.5)} />
      </div>
      <div style={{ opacity: hookO }}><HookTitle lines={["Hit your AI limit", "mid-task?"]} accent="limit" /></div>
    </>
  );
};

// ============ DEMO (local frame 0 = cues.demo) ============
const DEMO = F(tl.cues.demo);
const PAYOFF = F(tl.cues.payoff);
const ROWS6 = ["codex-personal", "codex-work", "claude-max", "claude-work", "gemini", "grok"];
const AccountsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const o = 1 - ease(frame, 138, 146);
  if (o <= 0) return null;
  const picked = frame >= 116;
  const keys: PointerKey[] = [
    { x: 1100, y: 720, at: 90, leave: 94 },
    { x: 430, y: 4 + 3 * 144 + 67, at: 112, click: 116, leave: 130 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o }}>
      {ROWS6.map((id, i) => {
        const a = acct(id);
        const on = picked && id === "claude-work";
        return (
          <Pop key={id} at={4 + i * 4} y={24} from={0.94} origin="50% 50%" style={{ position: "absolute", left: 40, top: 4 + i * 144, width: 880 }}>
            <div style={{ height: 134, borderRadius: 26, display: "flex", alignItems: "center", gap: 24, padding: "0 28px", boxSizing: "border-box", background: on ? "#34402f" : "#282f26", border: `2px solid ${on ? "#b9c99a" : "#404a3b"}`, fontFamily: FONT_BODY }}>
              <div style={{ width: 80, height: 80, borderRadius: 22, background: `${a.color}26`, border: `2px solid ${a.color}88`, display: "grid", placeItems: "center", color: a.color, fontSize: 44, fontWeight: 800, flexShrink: 0 }}>{a.glyph}</div>
              <div style={{ fontSize: 42, fontWeight: 700, color: C.textDark, whiteSpace: "nowrap" }}>{a.provider} · {a.label}</div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, fontSize: 34, fontWeight: on ? 800 : 500, color: on ? "#b9c99a" : A.done }}>
                <Icon name="check" size={36} color={on ? "#b9c99a" : A.done} stroke={2.6} />{on ? "Active" : "Signed in"}
              </div>
            </div>
          </Pop>
        );
      })}
      <Pointer keys={keys} scale={1.6} />
    </div>
  );
};

const LOG: { t: string; c: string }[] = [
  { t: "● Switched account · Claude Code · work", c: "#9bd3ad" },
  { t: "● Read(src/billing/stream.ts)", c: "#9bb7e8" },
  { t: "● Bash(pnpm test billing)", c: "#9bb7e8" },
  { t: "    ✓ 38 passed", c: "#9bd3ad" },
];
const LogScene: React.FC = () => {
  const frame = useCurrentFrame();
  const a = 142;
  const p = usePop(a + 6, { damping: 13, stiffness: 220, mass: 0.7 });
  const o = ease(frame, a, a + 8);
  if (o <= 0) return null;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: o }}>
      <div style={{ position: "absolute", left: 4, top: 14, width: 560, transform: "scale(1.7)", transformOrigin: "0 0" }}>
        <ThreadRow title="Refactor invoice export" status="running" time="now" account={acct("claude-work")} sub="Running" selected />
      </div>
      <div style={{ position: "absolute", left: 30, top: 190, right: 20, fontFamily: FONT_MONO, fontSize: 36, lineHeight: 1.5 }}>
        {LOG.map((l, i) => frame >= a + 12 + i * 12 && <div key={i} style={{ color: l.c, whiteSpace: "pre" }}>{l.t}</div>)}
      </div>
      {frame >= a + 6 && (
        <div style={{ position: "absolute", left: 24, right: 24, bottom: 24, height: 104, borderRadius: 18, background: "#12301f", border: "2px solid #7fd0a0", display: "flex", alignItems: "center", gap: 22, padding: "0 30px", fontSize: 40, fontWeight: 700, color: "#bff0d0", opacity: interpolate(p, [0, 0.5], [0, 1], clamp), transform: `translateY(${interpolate(p, [0, 1], [40, 0])}px)` }}>
          <Icon name="check" size={46} color="#7fd0a0" stroke={2.4} />Switched account, carrying on
        </div>
      )}
    </div>
  );
};

const Demo: React.FC = () => (
  <>
    <Viewport at={2} out={PAYOFF - DEMO - 4} title="Freddai">
      <AccountsScene />
      <LogScene />
    </Viewport>
  </>
);

// ============ PAYOFF ============
const Payoff: React.FC = () => (
  <>
    <div style={{ position: "absolute", left: 60, width: 960, top: 300 }}>
      <Words text="Switch agents." size={124} color={C.ink} delay={4} />
      <Words text="Not your whole workflow." size={124} color={C.ink} delay={16} gradientWords={["workflow."]} style={{ marginTop: 10 }} />
    </div>
    <div style={{ position: "absolute", left: 80, width: 920, top: 900, display: "flex", flexWrap: "wrap", gap: 18, justifyContent: "center" }}>
      {(["codex-personal", "claude-work", "gemini", "grok"] as const).map((id, i) => {
        const a = acct(id);
        return (
          <Pop key={id} at={46 + i * 6} y={24} origin="50% 50%">
            <div style={{ width: 430, height: 100, borderRadius: 24, background: "#1e241e", display: "flex", alignItems: "center", gap: 18, padding: "0 26px", boxSizing: "border-box", boxShadow: "0 16px 40px rgba(40,45,35,0.25)" }}>
              <div style={{ width: 56, height: 56, borderRadius: 28, background: `${a.color}33`, border: `2px solid ${a.color}`, display: "grid", placeItems: "center", color: a.color, fontSize: 30, fontWeight: 800 }}>{a.glyph}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 40, fontWeight: 700, color: C.textDark }}>{a.provider}</div>
            </div>
          </Pop>
        );
      })}
    </div>
  </>
);

export const Short01Limit: React.FC = () => {
  const turn = F(tl.cues.turn), turnEnd = F(tl.cues.turn + TURN_WIPE_SECONDS);
  const endCard = F(tl.cues.endcard);
  return (
    <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
      <Sequence from={0} durationInFrames={turnEnd + 1}><Pain /></Sequence>
      <Sequence from={DEMO} durationInFrames={PAYOFF - DEMO + 8}><Demo /></Sequence>
      <Sequence from={PAYOFF} durationInFrames={endCard - PAYOFF + 12}><Payoff /></Sequence>
      <Turn at={tl.cues.turn} />
    </ShortShell>
  );
};
