import React, { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Words } from "./text";
import { Glow, Vignette, shakeOffset } from "./fx";
import { C, clamp } from "./theme";
import { FONT_BODY, FONT_DISPLAY, FONT_MONO } from "./fonts";
import { sec2 } from "./timelineV2";
import { A, ACCOUNTS, AccountButton, AppShell, Dormouse, Icon, MacWindow, Pointer, Pop, ProjectGroup, ThreadRow, TrafficLights, UsageFooter, UsageRing, WIN, usePop, PROJECTS, type PointerKey } from "./ui";

const ease = (frame: number, a: number, b: number) => interpolate(frame, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
const acct = (id: string) => ACCOUNTS.find((a) => a.id === id)!;

// ---------- re-use plumbing ----------
export const FadeIn: React.FC<{ frames: number; children: ReactNode }> = ({ frames, children }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: frames ? interpolate(frame, [0, frames], [0, 1], clamp) : 1 }}>{children}</AbsoluteFill>;
};
// Plays an ORIGINAL-film chapter component from original time `orig` (seconds, absolute in the original film),
// placing it at v2 time `at` for `dur` seconds. `ch` is the chapter's start in the original (T.chN).
export const Slice: React.FC<{ orig: number; at: number; dur: number; ch: number; fade?: number; children: ReactNode }> = ({ orig, at, dur, ch, fade = 0, children }) => (
  <Sequence from={sec2(at)} durationInFrames={sec2(dur)}>
    <FadeIn frames={fade}>
      <Sequence from={-sec2(orig - ch)}>{children}</Sequence>
    </FadeIn>
  </Sequence>
);

const LightBg: React.FC<{ children: ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: C.cream, overflow: "hidden" }}>
    <Glow x={300} y={200} color={C.mint} opacity={0.35} size={1100} drift={1} />
    <Glow x={1700} y={900} color={C.mint} opacity={0.3} size={1000} drift={1} seed={3} />
    {children}
  </AbsoluteFill>
);

const Logo: React.FC<{ size?: number; color?: string }> = ({ size = 150, color = C.ink }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.16 }}>
    <Dormouse size={size} />
    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: size * 0.92, letterSpacing: "-0.04em", color }}>freddai</div>
  </div>
);

const Banner: React.FC<{ at: number; text: string; tone?: "amber" | "green"; shake?: number; style?: React.CSSProperties; size?: number }> = ({ at, text, tone = "amber", shake = 0, style, size = 32 }) => {
  const frame = useCurrentFrame();
  const p = usePop(at, { damping: 13, stiffness: 220, mass: 0.7 });
  if (frame < at) return null;
  const s = shakeOffset(frame, shake, "lim");
  const bg = tone === "amber" ? "#3d2a0d" : "#12301f", bd = tone === "amber" ? "#e9b667" : "#7fd0a0", fg = tone === "amber" ? "#f6d9a5" : "#bff0d0";
  return (
    <div style={{ position: "absolute", left: 34, right: 34, bottom: 34, height: 92, borderRadius: 14, background: bg, border: `2px solid ${bd}`, display: "flex", alignItems: "center", gap: 22, padding: "0 30px", fontFamily: FONT_BODY, fontSize: size, fontWeight: 700, color: fg, opacity: interpolate(p, [0, 0.5], [0, 1], clamp), transform: `translate(${s.x}px, ${interpolate(p, [0, 1], [40, 0]) + s.y}px)`, ...style }}>
      <Icon name={tone === "amber" ? "alert" : "check"} size={40} color={bd} stroke={2} />{text}
    </div>
  );
};

// ============================================================ 1. Hook: vibe coding, then the limit
const HOOK_LINES: { t: string; c?: string }[] = [
  { t: "> build me a signup dashboard with a chart for each week", c: A.textHi },
  { t: "● Read(src/dashboard/Signups.tsx)", c: "#9bb7e8" },
  { t: "● Edit(src/dashboard/Signups.tsx)   +64 −9", c: "#9bd3ad" },
  { t: "● Edit(src/dashboard/WeeklyChart.tsx)   +38", c: "#9bd3ad" },
  { t: "● Bash(pnpm test dashboard)", c: "#9bb7e8" },
  { t: "    ✓ 24 passed   ✗ 1 failed (chart labels)", c: "#d9d9df" },
  { t: "● Edit(src/dashboard/WeeklyChart.tsx)   +6 −2", c: "#9bd3ad" },
];
export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = frame / fps;
  const lines = Math.min(HOOK_LINES.length, 1 + Math.floor(s / 0.42));
  const banner = sec2(3.1);
  const notHere = sec2(4.45);
  const dim = ease(frame, notHere - 2, notHere + 10);
  const push = interpolate(frame, [0, sec2(5.8)], [1, 1.05], clamp);
  return (
    <AbsoluteFill style={{ background: C.bgDark, overflow: "hidden" }}>
      <Glow x={960} y={560} color="#4d613d" opacity={0.4} drift={1} size={1500} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", transform: `scale(${push * (1 - 0.05 * dim)})`, opacity: 1 - 0.72 * dim, filter: `blur(${dim * 8}px)` }}>
        <MacWindow width={1360} height={780} radius={14} style={{ background: "#14161a" }}
          titlebar={<div style={{ height: 56, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 16px", gap: 18, background: "#202126", borderBottom: `1px solid ${A.border}` }}><TrafficLights /><span style={{ fontFamily: FONT_BODY, fontSize: 18, color: A.muted }}>dashboard — session</span></div>}>
          <div style={{ padding: "28px 34px", fontFamily: FONT_MONO, fontSize: 23, lineHeight: 1.7, flex: 1, overflow: "hidden" }}>
            {HOOK_LINES.slice(0, lines).map((l, i) => <div key={i} style={{ color: l.c ?? A.text, whiteSpace: "pre" }}>{l.t}</div>)}
            <div style={{ color: "#8f9099", marginTop: 6 }}>{frame < banner ? "✻ Vibing… (esc to interrupt)" : ""}</div>
          </div>
          <Banner at={banner} text="Usage limit reached · resets in 4h 52m" shake={frame < banner + 8 ? 7 : 0} />
        </MacWindow>
      </AbsoluteFill>
      <Vignette strength={0.55} />
      {frame >= notHere && (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <Words text="Not here." size={170} color={C.cream} delay={notHere} weight={800} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ============================================================ 2. Title: Freddai + "Vibe coding heaven."
export const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const heaven = sec2(1.7);
  return (
    <LightBg>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 50 }}>
        <Glow x={960} y={560} color={C.mint} opacity={0.55} size={1500} drift={1} />
        <Pop at={sec2(0.15)} y={30} from={0.85} origin="50% 50%"><Logo size={150} /></Pop>
        {frame >= heaven && <Words text="Vibe coding heaven." delay={heaven} size={156} color={C.forest} weight={800} stagger={4} />}
      </AbsoluteFill>
    </LightBg>
  );
};

// ============================================================ 3. Accounts intro: "More than one account."
export const AccountsIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const head = sec2(2.8);
  const ids = ["claude-max", "claude-work", "codex-personal", "codex-work", "gemini", "grok"];
  return (
    <LightBg>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 56 }}>
        <div style={{ height: 130, display: "flex", alignItems: "center" }}>
          {frame >= head && <Words text="More than one account." delay={head} size={112} color={C.ink} weight={800} />}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 430px)", gap: 30 }}>
          {ids.map((id, i) => {
            const a = acct(id);
            return (
              <Pop key={id} at={sec2(0.9 + i * 0.28)} y={30} from={0.9} origin="50% 50%">
                <div style={{ display: "flex", alignItems: "center", gap: 22, padding: "22px 26px", borderRadius: 18, background: "#1d1e22", border: `1px solid ${A.input}`, boxShadow: "0 24px 60px rgba(30,36,30,0.28)", fontFamily: FONT_BODY }}>
                  <UsageRing remaining={a.left} color={a.color} size={78} fill={1}><span style={{ fontSize: 28, fontWeight: 700, color: A.muted }}>{a.glyph}</span></UsageRing>
                  <div style={{ lineHeight: 1.3 }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: A.textHi }}>{a.provider}</div>
                    <div style={{ fontSize: 21, color: A.muted }}>{a.label}</div>
                  </div>
                </div>
              </Pop>
            );
          })}
        </div>
      </AbsoluteFill>
    </LightBg>
  );
};

// ============================================================ 4. NEW: limit hit -> switch account -> keep going
const TRANSCRIPT: { t: string; c: string; at: number }[] = [
  { t: "● Read(src/dashboard/Signups.tsx)", c: "#9bb7e8", at: -1 },
  { t: "● Edit(src/dashboard/Signups.tsx)   +64 −9", c: "#9bd3ad", at: -1 },
  { t: "● Edit(src/dashboard/WeeklyChart.tsx)   +38", c: "#9bd3ad", at: -1 },
  { t: "● Bash(pnpm test dashboard)", c: "#9bb7e8", at: -1 },
  { t: "    ✓ 24 passed   ✗ 1 failed (chart labels)", c: "#d9d9df", at: -1 },
  { t: "● Edit(src/dashboard/WeeklyChart.tsx)   +6 −2", c: "#9bd3ad", at: 2.7 },
  { t: "● Bash(pnpm test dashboard)", c: "#9bb7e8", at: 3.2 },
  { t: "    ✓ 25 passed", c: "#9bd3ad", at: 3.75 },
];
export const SwapScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = frame / fps;
  const limitAt = sec2(0.45), openAt = sec2(1.38), pickAt = sec2(2.2), strikeAt = sec2(4.0);
  const switched = frame >= pickAt + 4;
  const pickerP = usePop(openAt, { damping: 16, stiffness: 220, mass: 0.7 });
  const pickerShown = frame >= openAt && frame < pickAt + 4;
  const hoverIdx = frame >= pickAt - 8 && frame < pickAt + 4 ? 3 : -1;
  const cur = switched ? acct("claude-work") : acct("claude-max");
  const sloganP = ease(frame, strikeAt - 4, strikeAt + 10);
  const pointer: PointerKey[] = [
    { x: 1560, y: 360, at: sec2(0.7), leave: sec2(0.9) },
    { x: 1410, y: 90, at: openAt - 6, click: openAt, leave: openAt + 14 },
    { x: 1360, y: 318, at: pickAt - 4, click: pickAt, leave: pickAt + 16 },
  ];
  const list = (
    <div>
      <ProjectGroup name="API" color={PROJECTS[2].color}>
        <ThreadRow title="Build the signup dashboard" status="running" account={cur} selected sub={switched ? "Running" : frame >= limitAt ? "Limit reached" : "Running"} />
        <ThreadRow title="Speed up search" status="unread" />
      </ProjectGroup>
      <ProjectGroup name="Website" color={PROJECTS[0].color}>
        <ThreadRow title="Polish the pricing page" status="running" />
      </ProjectGroup>
    </div>
  );
  const pane = (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", fontFamily: FONT_BODY }}>
      <div style={{ height: 56, flexShrink: 0, borderBottom: `1px solid ${A.border}`, display: "flex", alignItems: "center", gap: 12, padding: "0 20px", fontSize: 20, color: A.muted }}>
        <span style={{ width: 12, height: 12, borderRadius: 4, background: PROJECTS[2].color }} /><b style={{ color: A.textHi }}>Build the signup dashboard</b>
        <div style={{ position: "absolute", left: 700, top: 8, width: 320, height: 40, borderRadius: 10, border: `1px solid ${switched ? "#7fd0a0" : A.input}`, background: "#202228", display: "flex", alignItems: "center", gap: 10, padding: "0 14px", color: A.textHi, fontSize: 19, fontWeight: 600 }}>
          <span style={{ width: 11, height: 11, borderRadius: 6, background: cur.color }} />{cur.provider} · {cur.label}<span style={{ marginLeft: "auto", color: A.muted }}><Icon name="chevron" size={18} /></span>
        </div>
      </div>
      <div style={{ padding: "26px 34px", fontFamily: FONT_MONO, fontSize: 23, lineHeight: 1.7, opacity: 1 - 0.85 * sloganP }}>
        <div style={{ fontFamily: FONT_BODY, alignSelf: "flex-end", marginBottom: 14, padding: "12px 20px", borderRadius: 14, background: "#2a2b31", color: A.textHi, fontSize: 22, display: "inline-block" }}>Build me a signup dashboard with a chart for each week</div>
        {TRANSCRIPT.filter((l) => l.at < 0 || s >= l.at).map((l, i) => <div key={i} style={{ color: l.c, whiteSpace: "pre" }}>{l.t}</div>)}
        {s >= 4.6 && <div style={{ fontFamily: FONT_BODY, color: A.textHi, fontSize: 22, marginTop: 8 }}>Done. The dashboard is in and the tests pass.</div>}
      </div>
      {frame >= limitAt && !switched && <Banner at={limitAt} text="Usage limit reached · Claude Code · Max · resets in 52m" size={27} style={{ left: 28, right: 28, bottom: 28 }} />}
      {switched && <Banner at={pickAt + 4} tone="green" text="Switched to Claude Code · work. Carrying on." size={27} style={{ left: 28, right: 28, bottom: 28 }} />}
      {/* account picker */}
      {pickerShown && (
        <div style={{ position: "absolute", left: 600, top: 60, width: 420, borderRadius: 12, background: "#24252a", border: `1px solid ${A.input}`, boxShadow: "0 30px 70px rgba(0,0,0,0.55)", padding: 6, zIndex: 8, opacity: interpolate(pickerP, [0, 0.6], [0, 1], clamp), transform: `translateY(${interpolate(pickerP, [0, 1], [-10, 0])}px)` }}>
          {ACCOUNTS.map((a, i) => (
            <div key={a.id} style={{ height: 56, display: "flex", alignItems: "center", gap: 14, padding: "0 14px", borderRadius: 8, fontSize: 20, color: A.textHi, background: hoverIdx === i ? "#34353d" : "transparent" }}>
              <span style={{ width: 12, height: 12, borderRadius: 6, background: a.color }} />{a.provider} · {a.label}
              <span style={{ marginLeft: "auto", fontSize: 16, color: a.left <= 10 ? A.amber : A.muted }}>{a.left <= 10 ? "limit reached" : `${a.left}% left`}</span>
            </div>
          ))}
        </div>
      )}
      {/* "no logging out / in / starting over" */}
      {sloganP > 0.01 && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 110, display: "flex", flexDirection: "column", alignItems: "center", gap: 34, opacity: sloganP }}>
          {[{ t: "Log out", at: 4.0 }, { t: "Log in", at: 5.0 }, { t: "Start over", at: 6.1 }].map((r) => <Struck key={r.t} text={r.t} at={sec2(r.at)} />)}
        </div>
      )}
    </div>
  );
  return (
    <LightBg>
      <div style={{ position: "absolute", left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h }}>
        <AppShell list={list} pane={pane} footer={<UsageFooter items={ACCOUNTS.map((a) => ({ a: a.id === "claude-max" && switched ? { ...a } : a, show: 1, fill: 1, pulse: a.id === "claude-max" && !switched && frame >= limitAt ? 0.5 + 0.5 * Math.sin(frame / 5) : a.id === "claude-work" && switched ? 0.4 + 0.4 * Math.sin(frame / 5) : 0 }))} />} />
        {frame < sec2(3.4) && <Pointer keys={pointer} />}
      </div>
    </LightBg>
  );
};

const Struck: React.FC<{ text: string; at: number }> = ({ text, at }) => {
  const frame = useCurrentFrame();
  const p = usePop(at, { damping: 14, stiffness: 220, mass: 0.7 });
  if (frame < at) return null;
  const strike = ease(frame, at + 6, at + 16);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "18px 44px", borderRadius: 18, background: "#2a1d1f", border: "2px solid #8f3a40", boxShadow: "0 30px 70px rgba(0,0,0,0.5)", opacity: interpolate(p, [0, 0.5], [0, 1], clamp), transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px) scale(${interpolate(p, [0, 1], [0.94, 1])})` }}>
      <Icon name="x" size={44} color="#ff8f95" stroke={3} />
      <div style={{ position: "relative", fontFamily: FONT_DISPLAY, fontSize: 56, fontWeight: 800, color: "#f3d4d6", letterSpacing: "-0.02em" }}>
        {text}
        <div style={{ position: "absolute", left: -6, top: "54%", height: 6, borderRadius: 3, background: "#ff8f95", width: `${strike * 104}%` }} />
      </div>
    </div>
  );
};

// ============================================================ 5. Phone caption (over the re-used phone chapter)
export const PhoneCaption: React.FC = () => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [sec2(3.0), sec2(3.5)], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <div style={{ position: "absolute", left: 80, top: 120, width: 760 }}>
        <Words text="Works on your phone too." delay={sec2(0.1)} size={84} color={C.textDark} align="left" style={{ textShadow: "0 10px 50px rgba(0,0,0,0.5)" }} />
      </div>
    </AbsoluteFill>
  );
};

// ============================================================ 6. Close: logo + tagline, then URL
export const CloseScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = sec2(0.1);
  const cta = sec2(2.3);
  const ctaP = spring({ frame: frame - cta, fps, config: { damping: 16, stiffness: 160, mass: 0.9 } });
  return (
    <AbsoluteFill style={{ background: C.cream, overflow: "hidden" }}>
      {frame < cta && (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 46 }}>
          <Glow x={960} y={520} color={C.mint} opacity={0.5} size={1400} drift={1} />
          <Pop at={logo} y={30} from={0.85} origin="50% 50%"><Logo size={170} /></Pop>
          <Words text="Vibe coding heaven." delay={logo + 6} size={104} color={C.forest} weight={800} />
        </AbsoluteFill>
      )}
      {frame >= cta && (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", background: C.cream }}>
          <Glow x={960} y={540} color={C.mint} opacity={0.5} size={1400} drift={1} />
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 112, letterSpacing: "-0.035em", color: C.ink, opacity: interpolate(ctaP, [0, 0.5], [0, 1], clamp), transform: `translateY(${interpolate(ctaP, [0, 1], [30, 0])}px)` }}>
            freddai.ai-juicing.com
            <div style={{ height: 8, borderRadius: 4, background: C.forest, marginTop: 14, width: `${ease(frame, cta + 6, cta + 26) * 100}%` }} />
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
