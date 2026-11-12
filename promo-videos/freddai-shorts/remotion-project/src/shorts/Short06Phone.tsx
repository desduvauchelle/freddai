import React from "react";
import { Easing, Sequence, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { SHORT_TIMELINES } from "./timelines";
import { Words } from "../text";
import { Glow } from "../fx";
import { C, clamp } from "../theme";
import { FONT_DISPLAY, FONT_MONO } from "../fonts";

const tl = SHORT_TIMELINES.phone;
const fr = (s: number) => Math.round(s * 30);

// ---- beats (absolute frames) ----
const TURN = fr(tl.cues.turn); // 138
const OPEN_END = fr(tl.cues.turn + TURN_WIPE_SECONDS); // 153
const DEMO = fr(tl.cues.demo); // 144
const CARD1 = 162; // approval card slides in (pop sfx at 5.39 s)
const TAP1 = 213; // thumb hits Approve
const APPROVED = 216;
const COLLAPSE = 243; // card 1 folds into a one-line receipt
const CARD2 = 255; // second card arrives
const TYPE2 = 264;
const TAP2 = 306; // thumb hits Send
const PEEK = 330; // "The Mac does the work": laptop peeks back in
const REPLY = "Use the short one";

// Phone dark palette (copied from uiPhone.tsx)
const P = { bg: "#18191c", panel: "#202226", line: "#2c2e33", text: "#ececec", muted: "#a2a5ae", green: "#7bc89a", amber: "#e0a24a", btn: "#8fd6a8" };

const ease = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
const useSpring = (at: number, cfg = { damping: 16, stiffness: 150, mass: 0.8 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - at, fps, config: cfg });
};

// ============================================================ the open: dusk desk, nobody there
const DOTS = ["#7bc89a", "#7bc89a", "#e0a24a"];
const ROWS = ["web · Polish the pricing page", "api · Add the migration", "mobile · Offline support"];

const Laptop: React.FC<{ mode: "full" | "peek"; colors: string[]; calm?: boolean }> = ({ mode, colors, calm }) => {
  const f = useCurrentFrame();
  const dot = (c: string, i: number) => {
    const pulse = 0.5 + 0.5 * Math.sin(f / (calm ? 9 : 5) - i * 1.3);
    return <span style={{ width: 30, height: 30, borderRadius: 15, background: c, opacity: 0.45 + 0.55 * pulse, boxShadow: `0 0 ${10 + 22 * pulse}px ${c}`, flexShrink: 0 }} />;
  };
  if (mode === "peek") {
    return (
      <div style={{ width: 880 }}>
        <div style={{ padding: 16, background: "#0d0d10", borderRadius: "24px 24px 0 0", boxShadow: "0 -20px 80px rgba(40,45,35,0.35), inset 0 0 0 2px #34353a" }}>
          <div style={{ height: 112, borderRadius: 10, background: C.bgDark, display: "flex", alignItems: "center", justifyContent: "space-around", padding: "0 20px", fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 700, color: C.textDark }}>
            {["web", "api", "mobile"].map((l, i) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 14 }}>{dot(colors[i], i)}{l}</span>
            ))}
          </div>
        </div>
        <div style={{ width: 960, height: 24, marginLeft: -40, background: "linear-gradient(180deg,#3b3c42,#1f2024)", borderRadius: "0 0 40px 40px" }} />
      </div>
    );
  }
  return (
    <div style={{ width: 800 }}>
      <div style={{ padding: 18, background: "#0d0d10", borderRadius: 26, boxShadow: "0 40px 100px rgba(0,0,0,0.6), inset 0 0 0 2px #34353a" }}>
        <div style={{ height: 300, borderRadius: 10, background: C.bgDark, padding: "10px 34px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-around" }}>
          {ROWS.map((r, i) => (
            <div key={r} style={{ display: "flex", alignItems: "center", gap: 22, fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 600, color: C.textDark, whiteSpace: "nowrap" }}>{dot(colors[i], i)}{r}</div>
          ))}
        </div>
      </div>
      <div style={{ width: 920, height: 24, marginLeft: -60, background: "linear-gradient(180deg,#3b3c42,#1f2024)", borderRadius: "0 0 40px 40px", boxShadow: "0 24px 40px rgba(0,0,0,0.5)" }} />
    </div>
  );
};

const DuskDesk: React.FC = () => {
  const f = useCurrentFrame();
  const stars = Array.from({ length: 50 }).map((_, i) => ({ x: random(`sx${i}`) * 1080, y: 168 + random(`sy${i}`) * 560, r: 2 + random(`sr${i}`) * 3, ph: random(`sp${i}`) * 6 }));
  return (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #12161f 0%, #1d2135 32%, #3b2f3d 58%, #5a3f35 78%, #3c2b25 100%)" }}>
      {stars.map((s, i) => <div key={i} style={{ position: "absolute", left: s.x, top: s.y, width: s.r, height: s.r, borderRadius: "50%", background: "#fff", opacity: 0.25 + 0.5 * Math.sin(f / 20 + s.ph) ** 2 }} />)}
      <div style={{ position: "absolute", left: 830, top: 560, width: 120, height: 120, borderRadius: 60, background: "#f4e9c9", boxShadow: "0 0 90px 30px rgba(244,233,201,0.28)", opacity: 0.92 }} />
      <Glow x={540} y={1000} color="#c7893c" size={1500} opacity={0.35} drift={1} />
      {/* desk */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 1100, bottom: 0, background: "linear-gradient(180deg, #2c2420 0%, #1b1613 100%)", borderTop: "3px solid #4a3a30" }} />
      {/* mug */}
      <div style={{ position: "absolute", left: 870, top: 1020, width: 70, height: 80, borderRadius: "8px 8px 18px 18px", background: "#d8d2c4", boxShadow: "0 0 30px rgba(199,137,60,0.3)" }}>
        <div style={{ position: "absolute", right: -22, top: 14, width: 30, height: 40, borderRadius: 18, border: "8px solid #d8d2c4", borderLeft: "none" }} />
      </div>
      <div style={{ position: "absolute", left: 140, top: 750, transform: `scale(${1 + f * 0.00012})`, transformOrigin: "50% 50%" }}>
        <Laptop mode="full" colors={DOTS} />
      </div>
    </div>
  );
};

// ============================================================ the phone
const Finger: React.FC<{ x: number; y: number; at: number; f: number }> = ({ x, y, at, f }) => {
  const d = f - at;
  if (d < -8 || d > 18) return null;
  const grow = interpolate(d, [-8, 0, 16], [0.5, 1, 1.7], clamp);
  const o = interpolate(d, [-8, -3, 5, 18], [0, 0.9, 0.7, 0], clamp);
  return <div style={{ position: "absolute", left: x - 38, top: y - 38, width: 76, height: 76, borderRadius: 38, background: "rgba(255,255,255,0.35)", border: "4px solid rgba(255,255,255,0.8)", transform: `scale(${grow})`, opacity: o, zIndex: 30, pointerEvents: "none" }} />;
};

const SCREEN = { w: 430, h: 860 };
const PhoneFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ width: SCREEN.w + 28, height: SCREEN.h + 28, borderRadius: 76, background: "#0b0b0d", padding: 14, boxShadow: "0 50px 120px rgba(40,45,35,0.45), inset 0 0 0 2px #3a3b40", position: "relative", boxSizing: "content-box" }}>
    <div style={{ width: SCREEN.w, height: SCREEN.h, borderRadius: 62, overflow: "hidden", position: "relative", background: P.bg }}>
      {children}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 54, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 38px", color: P.text, fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, zIndex: 10 }}>
        <span>9:41</span><span style={{ opacity: 0.85 }}>●●●</span>
      </div>
      <div style={{ position: "absolute", left: "50%", top: 12, marginLeft: -60, width: 120, height: 34, borderRadius: 17, background: "#000", zIndex: 11 }} />
      <div style={{ position: "absolute", left: "50%", bottom: 9, marginLeft: -70, width: 140, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.5)", zIndex: 11 }} />
    </div>
  </div>
);

// A thread row: title, state text, progress bar. h = 72.
const ThreadProgress: React.FC<{ top: number; title: string; sub: string; subColor: string; pct: number; color: string; opacity?: number }> = ({ top, title, sub, subColor, pct, color, opacity = 1 }) => (
  <div style={{ position: "absolute", left: 16, width: 398, top, height: 72, opacity }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 25, fontWeight: 700, color: P.text }}>{title}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: subColor }}>{sub}</span>
    </div>
    <div style={{ marginTop: 14, height: 14, borderRadius: 7, background: P.line, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 7, background: color }} />
    </div>
  </div>
);

const Button: React.FC<{ x: number; y: number; w: number; h?: number; bg: string; color: string; border?: string; scale?: number; children: React.ReactNode }> = ({ x, y, w, h = 52, bg, color, border, scale = 1, children }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 14, background: bg, color, border, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 25, fontWeight: 700, transform: `scale(${scale})` }}>{children}</div>
);

const Screen: React.FC<{ f: number }> = ({ f }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sp = (at: number, cfg = { damping: 17, stiffness: 140, mass: 0.9 }) => spring({ frame: frame - at, fps, config: cfg });
  const pulse = 0.5 + 0.5 * Math.sin(f / 5);
  // layout flow: card1, api row, card2, other rows
  const c1 = sp(CARD1 - DEMO);
  const collapse = sp(COLLAPSE - DEMO, { damping: 18, stiffness: 150, mass: 0.9 });
  const H1 = c1 * (256 - collapse * 192);
  const c2 = sp(CARD2 - DEMO, { damping: 15, stiffness: 140, mass: 0.9 });
  const H2 = c2 * 200;
  const T0 = 120;
  const apiTop = T0 + H1 + (H1 > 1 ? 12 : 0);
  const card2Top = apiTop + 72 + 12;
  const webTop = card2Top + H2 + (H2 > 1 ? 12 : 0);
  const approved = f >= APPROVED;
  const waiting = f >= CARD1 && f < APPROVED;
  const pct = f < CARD1 ? interpolate(f, [DEMO, CARD1], [24, 38], clamp) : f < APPROVED ? 38 : interpolate(f, [APPROVED, 384], [38, 100], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const typed = Math.max(0, Math.min(REPLY.length, Math.floor(((f - TYPE2) / 30) * 18)));
  const sent = f >= TAP2 + 3;
  const reveal1 = c1;
  const tap1 = f >= TAP1 && f < TAP1 + 5;
  const tap2 = f >= TAP2 && f < TAP2 + 5;
  return (
    <div style={{ position: "absolute", inset: 0, background: P.bg, color: P.text, fontFamily: FONT_DISPLAY }}>
      {/* header */}
      <div style={{ position: "absolute", left: 22, top: 62, height: 48, display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: P.green }}>freddai</span><span style={{ fontSize: 32, fontWeight: 800 }}>Threads</span>
      </div>

      {/* card 1: approval */}
      {H1 > 2 && (
        <div style={{ position: "absolute", left: 16, width: 398, top: T0, height: H1, borderRadius: 22, background: P.panel, border: `2px solid ${approved ? P.green : P.amber}`, overflow: "hidden", opacity: Math.min(1, reveal1 * 1.6) }}>
          <div style={{ position: "absolute", left: 18, top: 0, height: 60, display: "flex", alignItems: "center", gap: 12, fontSize: 22, fontWeight: 800, letterSpacing: 0.5, color: approved ? P.green : P.amber }}>
            <span style={{ width: 28, height: 28, borderRadius: 14, background: approved ? P.green : P.amber, display: "grid", placeItems: "center", color: "#17210f", fontSize: 20 }}>{approved ? "✓" : "!"}</span>
            {approved ? "APPROVED · API" : "NEEDS YOU · API"}
          </div>
          <div style={{ position: "absolute", left: 18, right: 18, top: 62, fontSize: 27, fontWeight: 700, lineHeight: 1.25 }}>api · Codex needs you: run the migration?</div>
          <div style={{ position: "absolute", left: 18, right: 18, top: 138, height: 44, borderRadius: 10, background: "#14151a", fontFamily: FONT_MONO, fontSize: 24, color: "#cfd3c4", display: "flex", alignItems: "center", padding: "0 14px" }}>$ npm run migrate</div>
          <Button x={18} y={196} w={approved ? 360 : 206} bg={approved ? P.btn : "#b9c99a"} color="#17210f" scale={tap1 ? 0.95 : 1}>{approved ? "✓ Approved" : "Approve"}</Button>
          {!approved && <Button x={238} y={196} w={140} bg="transparent" color={P.muted} border={`2px solid ${P.line}`}>Decline</Button>}
        </div>
      )}

      {/* api progress row */}
      <ThreadProgress top={apiTop} title="api · Migration" sub={waiting ? "Waiting for you" : `${Math.round(pct)}%`} subColor={waiting ? P.amber : P.green} pct={pct} color={waiting ? P.amber : P.green} />

      {/* card 2: reply */}
      {H2 > 2 && (
        <div style={{ position: "absolute", left: 16, width: 398, top: card2Top, height: H2, borderRadius: 22, background: P.panel, border: `2px solid ${sent ? P.green : P.amber}`, overflow: "hidden", opacity: Math.min(1, c2 * 1.6), transform: `translateX(${(1 - c2) * 80}px)` }}>
          <div style={{ position: "absolute", left: 18, top: 12, fontSize: 22, fontWeight: 800, letterSpacing: 0.5, color: sent ? P.green : P.amber }}>{sent ? "✓ REPLY SENT · WEBSITE" : "NEEDS YOU · WEBSITE"}</div>
          <div style={{ position: "absolute", left: 18, right: 18, top: 46, fontSize: 26, fontWeight: 700, lineHeight: 1.25 }}>Claude asks: which headline for pricing?</div>
          <div style={{ position: "absolute", left: 12, width: 374, top: 128, height: 56, borderRadius: 28, background: P.bg, border: `1.5px solid ${P.line}`, display: "flex", alignItems: "center", padding: "0 8px 0 20px", fontSize: 26, boxSizing: "border-box" }}>
            <span style={{ flex: 1, color: typed || sent ? P.text : P.muted, whiteSpace: "nowrap" }}>{typed || sent ? REPLY.slice(0, sent ? REPLY.length : typed) : "Reply"}{!sent && typed > 0 && frame % 16 < 9 ? "|" : ""}</span>
            <span style={{ width: 42, height: 42, borderRadius: 21, background: typed >= REPLY.length || sent ? P.btn : "#3a3c42", display: "grid", placeItems: "center", color: "#17210f", fontSize: 26, fontWeight: 800, transform: tap2 ? "scale(0.88)" : "scale(1)" }}>↑</span>
          </div>
        </div>
      )}

      {/* other threads */}
      <ThreadProgress top={webTop} title="web · Pricing page" sub={`${Math.round(interpolate(f, [DEMO, 384], [58, 83], clamp))}%`} subColor={P.green} pct={interpolate(f, [DEMO, 384], [58, 83], clamp)} color={P.green} opacity={1 - c2} />

      <Finger x={137} y={342} at={TAP1} f={f} />
      <Finger x={374} y={432} at={TAP2} f={f} />
    </div>
  );
};

const PHONE_SCALE = 1.66; // 458 -> 760 px wide
const PhoneDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const f = frame + DEMO;
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 6, fps, config: { damping: 18, stiffness: 110, mass: 1 } });
  const peek = spring({ frame: f - PEEK, fps, config: { damping: 15, stiffness: 120, mass: 0.9 } });
  return (
    <>
      <Glow x={540} y={900} color={C.mint} size={1500} opacity={0.55} drift={1} />
      <div style={{ position: "absolute", left: 160, top: 172, transform: `translateY(${(1 - enter) * 1500}px) scale(${PHONE_SCALE})`, transformOrigin: "0 0" }}>
        <PhoneFrame><Screen f={f} /></PhoneFrame>
      </div>
      {f >= PEEK - 2 && (
        <div style={{ position: "absolute", left: 100, top: 1000, transform: `translateY(${(1 - peek) * 380}px)` }}>
          <Laptop mode="peek" colors={["#7bc89a", "#7bc89a", "#7bc89a"]} calm />
        </div>
      )}
    </>
  );
};

export const Short06Phone: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={OPEN_END} name="open: dusk desk">
      <DuskDesk />
      <HookTitle lines={["Leave your desk.", "Agents keep working."]} accent="working" />
      <div style={{ position: "absolute", left: 80, width: 760, top: 515 }}>
        <Words text="Your desk is optional." size={96} color="#faf9f5" align="left" delay={fr(3.15)} style={{ textShadow: "0 8px 40px rgba(0,0,0,0.55)" }} />
      </div>
    </Sequence>
    <Sequence from={DEMO} durationInFrames={tl.durationInFrames - DEMO} name="demo: phone companion">
      <PhoneDemo />
    </Sequence>
    <Turn at={tl.cues.turn} />
  </ShortShell>
);
