import React from "react";
import { Easing, Sequence, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { EndCard } from "./EndCard";
import { V2_TIMELINES } from "./timelinesV2";
import { Dormouse } from "../ui";
import { clamp } from "../theme";
import { FONT_DISPLAY, FONT_MONO } from "../fonts";

const tl = V2_TIMELINES.phone;
const fr = (s: number) => Math.round(s * 30);

// ---- beats (seconds) ----
const LIFT = 2.4; // line 02: the phone rises, a new thread starts
const NEW_ROW = 2.8;
const AWAY = 5.87; // line 03: time passes
const PING = 10.3; // line 04: notification drops
const TAP_BANNER = 12.2;
const VIEW_IN = 12.3;
const TAP_ALLOW = 15.2; // line 05: Allow once
const LOG1 = 16.8, LOG2 = 17.5, LOG3 = 18.1;
const VIEW_OUT = 18.7;
const BOOST = 17.2; // laptop works hard

const P = { bg: "#18191c", panel: "#202226", line: "#2c2e33", text: "#ececec", muted: "#a2a5ae", green: "#7bc89a", amber: "#e0a24a", btn: "#8fd6a8" };
const SCALE = 1.3;
const ease = (t: number, a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

const useT = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { f, t: f / fps, fps };
};

// ============================================================ ground: warm evening room, laptop far behind
const Evening: React.FC = () => {
  const { t, f } = useT();
  const away = ease(t, AWAY, AWAY + 1);
  const boost = ease(t, BOOST, BOOST + 0.8);
  const pulse = 0.5 + 0.5 * Math.sin(f / 7);
  const glow = (0.35 + 0.25 * pulse) * (1 - 0.35 * away) + boost * 0.3;
  const dots = [P.green, P.green, t >= PING && t < TAP_ALLOW + 1 ? P.amber : P.green];
  const bokeh = Array.from({ length: 9 }).map((_, i) => ({ x: random(`bx${i}`) * 1080, y: 200 + random(`by${i}`) * 1100, r: 60 + random(`br${i}`) * 130, o: 0.06 + random(`bo${i}`) * 0.1, ph: random(`bp${i}`) * 6 }));
  return (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #241c33 0%, #4a2f46 38%, #8a4f4a 72%, #b7714f 100%)" }}>
      {bokeh.map((b, i) => (
        <div key={i} style={{ position: "absolute", left: b.x - b.r, top: b.y - b.r, width: b.r * 2, height: b.r * 2, borderRadius: "50%", background: "#ffd9a0", opacity: b.o * (0.7 + 0.3 * Math.sin(f / 40 + b.ph)) }} />
      ))}
      <div style={{ position: "absolute", left: 540, top: 780, width: 1400, height: 1400, marginLeft: -700, marginTop: -700, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,190,120,0.30) 0%, rgba(255,190,120,0) 62%)" }} />
      {/* far-away laptop on the desk, right edge */}
      <div style={{ position: "absolute", left: 880, top: 690 }}>
        <div style={{ position: "absolute", left: -90, top: -90, width: 340, height: 340, borderRadius: "50%", background: `radial-gradient(circle, rgba(244,200,130,${glow}) 0%, rgba(244,200,130,0) 65%)` }} />
        <div style={{ width: 170, height: 106, borderRadius: 10, background: "#0d0d10", boxShadow: "inset 0 0 0 2px #34353a", padding: 8, boxSizing: "border-box" }}>
          <div style={{ width: "100%", height: "100%", borderRadius: 4, background: "#1e241e", display: "flex", flexDirection: "column", justifyContent: "space-around", padding: "0 12px" }}>
            {dots.map((c, i) => {
              const p = 0.5 + 0.5 * Math.sin(f / 6 - i * 1.3);
              return <span key={i} style={{ width: 14, height: 14, borderRadius: 7, background: c, opacity: 0.5 + 0.5 * p, boxShadow: `0 0 ${6 + 12 * p}px ${c}` }} />;
            })}
          </div>
        </div>
        <div style={{ width: 200, height: 12, marginLeft: -15, borderRadius: "0 0 14px 14px", background: "linear-gradient(180deg,#3b3c42,#1f2024)" }} />
      </div>
    </div>
  );
};

// ============================================================ the phone
const SCREEN = { w: 430, h: 860 };
const PhoneFrame: React.FC<{ children: React.ReactNode; clock: string }> = ({ children, clock }) => (
  <div style={{ width: SCREEN.w + 28, height: SCREEN.h + 28, borderRadius: 76, background: "#0b0b0d", padding: 14, boxShadow: "0 50px 120px rgba(20,10,20,0.55), inset 0 0 0 2px #3a3b40", position: "relative", boxSizing: "content-box" }}>
    <div style={{ width: SCREEN.w, height: SCREEN.h, borderRadius: 62, overflow: "hidden", position: "relative", background: P.bg }}>
      {children}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 54, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 38px", color: P.text, fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, zIndex: 10 }}>
        <span>{clock}</span><span style={{ opacity: 0.85 }}>●●●</span>
      </div>
      <div style={{ position: "absolute", left: "50%", top: 12, marginLeft: -60, width: 120, height: 34, borderRadius: 17, background: "#000", zIndex: 11 }} />
      <div style={{ position: "absolute", left: "50%", bottom: 9, marginLeft: -70, width: 140, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.5)", zIndex: 11 }} />
    </div>
  </div>
);

const Finger: React.FC<{ x: number; y: number; at: number; t: number }> = ({ x, y, at, t }) => {
  const d = (t - at) * 30;
  if (d < -8 || d > 18) return null;
  const grow = interpolate(d, [-8, 0, 16], [0.5, 1, 1.7], clamp);
  const o = interpolate(d, [-8, -3, 5, 18], [0, 0.9, 0.7, 0], clamp);
  return <div style={{ position: "absolute", left: x - 38, top: y - 38, width: 76, height: 76, borderRadius: 38, background: "rgba(255,255,255,0.35)", border: "4px solid rgba(255,255,255,0.8)", transform: `scale(${grow})`, opacity: o, zIndex: 30, pointerEvents: "none" }} />;
};

const Row: React.FC<{ top: number; title: string; sub: string; subColor: string; pct: number; color: string; opacity?: number }> = ({ top, title, sub, subColor, pct, color, opacity = 1 }) => (
  <div style={{ position: "absolute", left: 16, width: 398, top, height: 76, opacity }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 28, fontWeight: 700, color: P.text }}>{title}</span>
      <span style={{ fontSize: 28, fontWeight: 700, color: subColor }}>{sub}</span>
    </div>
    <div style={{ marginTop: 14, height: 14, borderRadius: 7, background: P.line, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 7, background: color }} />
    </div>
  </div>
);

const ROW_H = 92;
const ListView: React.FC<{ t: number }> = ({ t }) => {
  const { fps } = useVideoConfig();
  const f = Math.round(t * fps);
  const ins = spring({ frame: f - fr(NEW_ROW), fps, config: { damping: 16, stiffness: 140, mass: 0.9 } });
  const T0 = 124;
  // web
  const webPct = interpolate(t, [0, 8], [56, 100], clamp);
  const webDone = webPct >= 99.5;
  // api migration
  const waiting = t >= PING - 0.1 && t < TAP_ALLOW;
  const apiPct = t < TAP_ALLOW ? interpolate(t, [NEW_ROW, PING - 0.1], [4, 38], clamp) : interpolate(t, [TAP_ALLOW + 0.5, LOG3 + 0.4], [38, 100], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const apiDone = apiPct >= 99.5;
  const apiSub = waiting ? "Needs you" : apiDone ? "Done" : t < NEW_ROW + 1.0 ? "Starting" : `${Math.round(apiPct)}%`;
  const apiColor = waiting ? P.amber : apiDone ? P.muted : P.green;
  const y = (i: number, shifts: boolean) => T0 + ROW_H * (i + (shifts ? ins : 0));
  return (
    <div style={{ position: "absolute", inset: 0, background: P.bg, color: P.text, fontFamily: FONT_DISPLAY }}>
      <div style={{ position: "absolute", left: 22, top: 62, height: 48, display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: P.green }}>freddai</span><span style={{ fontSize: 34, fontWeight: 800 }}>Threads</span>
      </div>
      <Row top={T0} title="api · Migration" sub={apiSub} subColor={apiColor} pct={apiPct} color={waiting ? P.amber : apiDone ? "#5d6068" : P.green} opacity={ins} />
      <Row top={y(0, true)} title="web · Pricing page" sub={webDone ? "Done" : `${Math.round(webPct)}%`} subColor={webDone ? P.muted : P.green} pct={webPct} color={webDone ? "#5d6068" : P.green} opacity={webDone ? 0.75 : 1} />
      <Row top={y(1, true)} title="mobile · Offline mode" sub="Done" subColor={P.muted} pct={100} color="#5d6068" opacity={0.75} />
      <Row top={y(2, true)} title="api · Pagination" sub="Done" subColor={P.muted} pct={100} color="#5d6068" opacity={0.75} />
    </div>
  );
};

const ThreadView: React.FC<{ t: number }> = ({ t }) => {
  const approved = t >= TAP_ALLOW + 0.1;
  const tapScale = t >= TAP_ALLOW && t < TAP_ALLOW + 0.17 ? 0.95 : 1;
  const lines = [
    { at: LOG1, text: "✓ Migration applied" },
    { at: LOG2, text: "✓ 48 tests pass" },
    { at: LOG3, text: "✓ Committed" },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: P.bg, color: P.text, fontFamily: FONT_DISPLAY }}>
      <div style={{ position: "absolute", left: 18, right: 18, top: 62, height: 48, display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 40, color: P.green, lineHeight: 1 }}>‹</span>
        <span style={{ fontSize: 30, fontWeight: 800 }}>api · Migration</span>
      </div>
      <div style={{ position: "absolute", left: 22, top: 128, fontSize: 28, fontWeight: 700, color: P.muted }}>Codex</div>
      <div style={{ position: "absolute", left: 16, width: 330, top: 164, borderRadius: "22px 22px 22px 6px", background: P.panel, padding: "14px 20px", boxSizing: "border-box", fontSize: 28, fontWeight: 600, lineHeight: 1.22 }}>Migration is ready. Run it on dev?</div>
      {/* approval card */}
      <div style={{ position: "absolute", left: 16, width: 398, top: 296, height: 204, borderRadius: 22, background: P.panel, border: `2px solid ${approved ? P.green : P.amber}`, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 18, top: 0, height: 60, display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 800, letterSpacing: 0.5, color: approved ? P.green : P.amber }}>
          <span style={{ width: 30, height: 30, borderRadius: 15, background: approved ? P.green : P.amber, display: "grid", placeItems: "center", color: "#17210f", fontSize: 24 }}>{approved ? "✓" : "!"}</span>
          {approved ? "ALLOWED ONCE" : "NEEDS YOU"}
        </div>
        <div style={{ position: "absolute", left: 18, right: 18, top: 64, height: 50, borderRadius: 10, background: "#14151a", fontFamily: FONT_MONO, fontSize: 28, color: "#cfd3c4", display: "flex", alignItems: "center", padding: "0 14px" }}>$ npm run migrate</div>
        {!approved ? (
          <>
            <div style={{ position: "absolute", left: 18, top: 130, width: 216, height: 58, borderRadius: 14, background: "#b9c99a", color: "#17210f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800, transform: `scale(${tapScale})` }}>Allow once</div>
            <div style={{ position: "absolute", left: 248, top: 130, width: 132, height: 58, borderRadius: 14, border: `2px solid ${P.line}`, boxSizing: "border-box", color: P.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700 }}>Deny</div>
          </>
        ) : (
          <div style={{ position: "absolute", left: 18, right: 18, top: 128, fontSize: 28, fontWeight: 700, lineHeight: 1.2, color: P.green }}>
            Allowed once
            <div style={{ fontSize: 28, fontWeight: 600, color: P.muted }}>{t < LOG1 ? "Waiting for agent..." : "Agent is running it"}</div>
          </div>
        )}
      </div>
      {lines.map((l, i) => {
        const p = ease(t, l.at, l.at + 0.3);
        if (p <= 0) return null;
        return <div key={l.text} style={{ position: "absolute", left: 22, top: 524 + i * 46, fontFamily: FONT_MONO, fontSize: 28, fontWeight: 700, color: P.green, opacity: p, transform: `translateX(${(1 - p) * 30}px)` }}>{l.text}</div>;
      })}
    </div>
  );
};

const Banner: React.FC<{ t: number }> = ({ t }) => {
  const { fps } = useVideoConfig();
  const inn = spring({ frame: Math.round((t - PING) * fps), fps, config: { damping: 14, stiffness: 170, mass: 0.8 } });
  const out = ease(t, TAP_BANNER + 0.15, TAP_BANNER + 0.4);
  if (t < PING || out >= 1) return null;
  return (
    <div style={{ position: "absolute", left: 12, width: 406, top: 56, height: 118, borderRadius: 28, background: "rgba(248,247,242,0.97)", boxShadow: "0 18px 40px rgba(0,0,0,0.5)", transform: `translateY(${(1 - inn) * -190 - out * 40}px) scale(${1 - out * 0.04})`, opacity: 1 - out, zIndex: 20, display: "flex", alignItems: "center", gap: 14, padding: "0 16px", boxSizing: "border-box", fontFamily: FONT_DISPLAY, color: "#1d1f1a" }}>
      <div style={{ width: 62, height: 62, borderRadius: 16, background: "#eeefe6", display: "grid", placeItems: "center", flexShrink: 0 }}><Dormouse size={46} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, fontWeight: 800 }}><span>Freddai</span><span style={{ fontWeight: 600, color: "#7a7d72" }}>now</span></div>
        <div style={{ fontSize: 28, fontWeight: 700, whiteSpace: "nowrap" }}>Agent needs you</div>
        <div style={{ fontSize: 28, fontWeight: 500, color: "#55584d", whiteSpace: "nowrap" }}>Allow the migration?</div>
      </div>
    </div>
  );
};

const PhoneScene: React.FC = () => {
  const { t, fps, f } = useT();
  const lift = spring({ frame: f - fr(LIFT), fps, config: { damping: 17, stiffness: 110, mass: 1 } });
  const top = 585 + (175 - 585) * lift;
  const viewIn = spring({ frame: f - fr(VIEW_IN), fps, config: { damping: 18, stiffness: 150, mass: 0.9 } });
  const viewOut = spring({ frame: f - fr(VIEW_OUT), fps, config: { damping: 18, stiffness: 150, mass: 0.9 } });
  const slide = (1 - viewIn) * 100 + viewOut * 100; // % translateX of thread view
  const listShift = -(viewIn - viewOut) * 24;
  const clock = t >= AWAY ? "10:12" : "9:41";
  const idle = Math.sin(f / 50) * 4;
  return (
    <div style={{ position: "absolute", left: 242, top: top + (lift < 1 ? 0 : idle * 0), transform: `scale(${SCALE})`, transformOrigin: "0 0" }}>
      <PhoneFrame clock={clock}>
        <div style={{ position: "absolute", inset: 0, transform: `translateX(${listShift}px)` }}><ListView t={t} /></div>
        {viewIn > 0.001 && viewOut < 0.999 && <div style={{ position: "absolute", inset: 0, transform: `translateX(${slide}%)`, boxShadow: "-20px 0 40px rgba(0,0,0,0.4)" }}><ThreadView t={t} /></div>}
        <Banner t={t} />
        <Finger x={215} y={115} at={TAP_BANNER} t={t} />
        <Finger x={126} y={420} at={TAP_ALLOW} t={t} />
      </PhoneFrame>
    </div>
  );
};

export const V2Short17Phone: React.FC = () => {
  const { t } = useT();
  const hookOut = 1 - ease(t, LIFT + 0.05, LIFT + 0.3);
  return (
    <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
      <Evening />
      <PhoneScene />
      <Sequence from={0} durationInFrames={fr(LIFT + 0.35)} name="hook">
        <div style={{ opacity: hookOut }}>
          <HookTitle lines={["Vibe code from", "the couch."]} accent="couch" />
        </div>
      </Sequence>
    </ShortShell>
  );
};
