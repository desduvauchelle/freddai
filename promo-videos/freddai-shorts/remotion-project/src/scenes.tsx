import React, { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Words } from "./text";
import { Glow, Vignette, shakeOffset } from "./fx";
import { C, clamp } from "./theme";
import { FONT_BODY, FONT_DISPLAY, FONT_MONO } from "./fonts";
import { CUE, T, sec } from "./timeline";
import {
  A, ACCOUNTS, AccountButton, Composer, COMPOSER, Dormouse, GitGraph, HomeTile, Icon, MacWindow, NewThreadPane, PANE, Pointer, Pop, ProjectGroup,
  ProviderCard, ScheduleCard, ThreadRow, UsageFooter, UsageRing, Wave, WIN, AppShell, usePop, PROJECTS, TrafficLights,
  type PointerKey, type ThreadStatus,
} from "./ui";

// Each scene is mounted inside its own <Sequence>, so useCurrentFrame() is 0 at the chapter start.
const L = (abs: number, ch: number) => sec(abs - ch);
const typed = (text: string, frame: number, start: number, cps = 24, fps = 30) => text.slice(0, Math.max(0, Math.min(text.length, Math.floor(((frame - start) / fps) * cps))));
const ease = (frame: number, a: number, b: number) => interpolate(frame, [a, b], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

const acct = (id: string) => ACCOUNTS.find((a) => a.id === id)!;

// ============================================================ shared: terminal (Ch1 + Close)
const TERM_LINES: { t: string; c?: string }[] = [
  { t: "> refactor the invoice export to stream rows instead of loading them all", c: A.textHi },
  { t: "● Read(src/billing/export.ts)", c: "#9bb7e8" },
  { t: "● Read(src/billing/rows.ts)", c: "#9bb7e8" },
  { t: "● Edit(src/billing/export.ts)   +42 −17", c: "#9bd3ad" },
  { t: "● Bash(pnpm test billing)", c: "#9bb7e8" },
  { t: "    ✓ 37 passed   ✗ 1 failed (csv header order)", c: "#d9d9df" },
  { t: "● Edit(src/billing/stream.ts)   +58", c: "#9bd3ad" },
  { t: "● Edit(src/billing/export.ts)   +6 −2", c: "#9bd3ad" },
];

const Terminal: React.FC<{ tabs: number; lines: number; children?: ReactNode; width?: number; height?: number; style?: React.CSSProperties; extra?: { t: string; c?: string }[] }> = ({ tabs, lines, children, width = 1360, height = 780, style, extra = [] }) => {
  const all = [...TERM_LINES, ...extra];
  const tabW = Math.min(210, 1000 / tabs);
  const names = ["api — session", "login", "accounts", "api — session", "folder", "api", "login", "settings", "api — new", "session", "folder", "api"];
  return (
    <MacWindow width={width} height={height} radius={14} style={{ background: "#14161a", ...style }}
      titlebar={
        <div style={{ height: 56, flexShrink: 0, display: "flex", alignItems: "flex-end", padding: "0 16px", gap: 18, background: "#202126", borderBottom: `1px solid ${A.border}` }}>
          <div style={{ alignSelf: "center" }}><TrafficLights /></div>
          <div style={{ display: "flex", gap: 3, alignItems: "flex-end", flex: 1, overflow: "hidden" }}>
            {Array.from({ length: tabs }).map((_, i) => (
              <div key={i} style={{ width: tabW, height: 38, flexShrink: 0, borderRadius: "9px 9px 0 0", background: i === 0 ? "#14161a" : "#2a2b31", color: i === 0 ? A.textHi : A.muted, fontFamily: FONT_BODY, fontSize: 16, padding: "0 12px", display: "flex", alignItems: "center", whiteSpace: "nowrap", overflow: "hidden" }}>{names[i % names.length]}</div>
            ))}
          </div>
        </div>
      }>
      <div style={{ padding: "28px 34px", fontFamily: FONT_MONO, fontSize: 23, lineHeight: 1.7, flex: 1, overflow: "hidden" }}>
        {all.slice(0, lines).map((l, i) => <div key={i} style={{ color: l.c ?? A.text, whiteSpace: "pre" }}>{l.t}</div>)}
        {children}
      </div>
    </MacWindow>
  );
};

const LimitBanner: React.FC<{ at: number; text?: string; tone?: "amber" | "green"; shake?: number }> = ({ at, text = "Usage limit reached · resets in 4h 52m", tone = "amber", shake = 0 }) => {
  const frame = useCurrentFrame();
  const p = usePop(at, { damping: 13, stiffness: 220, mass: 0.7 });
  if (frame < at) return null;
  const s = shakeOffset(frame, shake, "lim");
  const bg = tone === "amber" ? "#3d2a0d" : "#12301f", bd = tone === "amber" ? "#e9b667" : "#7fd0a0", fg = tone === "amber" ? "#f6d9a5" : "#bff0d0";
  return (
    <div style={{ position: "absolute", left: 34, right: 34, bottom: 34, height: 92, borderRadius: 14, background: bg, border: `2px solid ${bd}`, display: "flex", alignItems: "center", gap: 22, padding: "0 30px", fontFamily: FONT_BODY, fontSize: 32, fontWeight: 700, color: fg, opacity: interpolate(p, [0, 0.5], [0, 1], clamp), transform: `translate(${s.x}px, ${interpolate(p, [0, 1], [40, 0]) + s.y}px)` }}>
      <Icon name={tone === "amber" ? "alert" : "check"} size={40} color={bd} stroke={2} />{text}
    </div>
  );
};

const Dialog: React.FC<{ at: number; end: number; title: string; icon: string; children: ReactNode; w?: number }> = ({ at, end, title, icon, children, w = 820 }) => {
  const frame = useCurrentFrame();
  const p = usePop(at, { damping: 15, stiffness: 240, mass: 0.7 });
  const out = interpolate(frame, [end - 5, end], [1, 0], clamp);
  if (frame < at || frame >= end) return null;
  return (
    <div style={{ position: "absolute", left: "50%", top: "50%", width: w, marginLeft: -w / 2, marginTop: -230, borderRadius: 18, background: "#23242a", border: `1px solid #44454e`, boxShadow: "0 50px 120px rgba(0,0,0,0.6)", fontFamily: FONT_BODY, color: A.text, opacity: Math.min(out, interpolate(p, [0, 0.5], [0, 1], clamp)), transform: `translateY(${interpolate(p, [0, 1], [40, 0])}px) scale(${interpolate(p, [0, 1], [0.94, 1])})`, zIndex: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "20px 28px", borderBottom: `1px solid #36373f`, fontSize: 26, fontWeight: 700, color: A.textHi }}><Icon name={icon} size={30} color={A.muted} />{title}</div>
      <div style={{ padding: 28 }}>{children}</div>
    </div>
  );
};

const Field: React.FC<{ label: string; value: string; caret?: boolean; mono?: boolean }> = ({ label, value, caret, mono }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontSize: 17, color: A.muted, marginBottom: 8 }}>{label}</div>
    <div style={{ height: 60, borderRadius: 10, border: `1px solid ${A.input}`, background: "#1a1b1f", display: "flex", alignItems: "center", padding: "0 18px", fontSize: 26, fontFamily: mono ? FONT_MONO : FONT_BODY, color: A.textHi }}>
      {value}{caret && <span style={{ display: "inline-block", width: 2, height: 32, background: A.textHi, marginLeft: 2 }} />}
    </div>
  </div>
);
const Btn: React.FC<{ label: string; pressed?: boolean; tone?: "primary" | "danger" }> = ({ label, pressed, tone = "primary" }) => (
  <div style={{ display: "inline-block", padding: "14px 34px", borderRadius: 10, fontSize: 24, fontWeight: 700, background: tone === "danger" ? "#4a2326" : "#e1e1e7", color: tone === "danger" ? "#ffb4b8" : "#202126", transform: `scale(${pressed ? 0.94 : 1})`, filter: pressed ? "brightness(0.8)" : undefined }}>{label}</div>
);

const Logo: React.FC<{ size?: number; color?: string }> = ({ size = 150, color = C.ink }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.16 }}>
    <Dormouse size={size} />
    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: size * 0.92, letterSpacing: "-0.04em", color }}>freddai</div>
  </div>
);

// ============================================================ Ch1 · The juggle
export const Ch1: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = (abs: number) => L(abs, T.ch1);
  const banner = f(CUE.limitBanner), routine = f(CUE.oldRoutine), again = f(CUE.again), mouse = f(CUE.mouse), slogan = f(CUE.slogan1);
  // steps of the old routine, in spoken order (line 02)
  const s1 = routine + 3, s2 = f(5.5), s3 = f(7.4), s4 = f(9.0), end = again;
  const tabs = frame < s1 ? 1 : frame < s2 ? 3 : frame < s3 ? 6 : frame < s4 ? 9 : 12;
  const inRoutine = frame >= routine && frame < again;
  const sloganP = ease(frame, slogan - 2, slogan + 14);
  const dim = inRoutine ? 0.5 : 1;
  const blur = interpolate(sloganP, [0, 1], [0, 8]);
  const lines = Math.min(TERM_LINES.length, 5 + Math.floor(frame / 8));
  const mouseP = spring({ frame: frame - mouse, fps, config: { damping: 11, stiffness: 150, mass: 0.9 } });
  const camScale = interpolate(frame, [0, sec(T.ch2 - T.ch1)], [1, 1.04], clamp);
  return (
    <AbsoluteFill style={{ background: C.bgDark, overflow: "hidden" }}>
      <Glow x={960} y={560} color="#4d613d" opacity={0.4} drift={1} size={1500} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", transform: `scale(${camScale * interpolate(sloganP, [0, 1], [1, 0.94])})`, opacity: interpolate(sloganP, [0, 1], [1, 0.28]), filter: `blur(${blur}px)` }}>
        <div style={{ opacity: dim, filter: inRoutine ? "blur(2px)" : undefined }}>
          <Terminal tabs={tabs} lines={lines} extra={[]}>
            <div style={{ color: "#8f9099", marginTop: 6 }}>{frame < banner ? "✻ Working… (esc to interrupt)" : ""}</div>
          </Terminal>
        </div>
        <div style={{ position: "absolute", left: 280, top: 150, width: 1360, height: 780, pointerEvents: "none" }}>
          {frame < again && <LimitBanner at={banner} />}
          {frame >= again && <LimitBanner at={again} shake={frame < again + 8 ? 7 : 0} text="Usage limit reached again · resets in 4h 31m" />}
        </div>
        {/* 1 log out */}
        <Dialog at={s1} end={s2} title="Account" icon="x">
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ width: 70, height: 70, borderRadius: 35, background: "#3a3b43", display: "grid", placeItems: "center", fontSize: 30, fontWeight: 700 }}>P</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 28, fontWeight: 700, color: A.textHi }}>personal@studio.dev</div><div style={{ fontSize: 20, color: A.red, marginTop: 4 }}>Usage limit reached</div></div>
            {frame - s1 > 34 ? <div style={{ fontSize: 26, color: A.muted }}>Signed out</div> : <Btn label="Log out" tone="danger" pressed={frame - s1 > 28} />}
          </div>
        </Dialog>
        {/* 2 log in */}
        <Dialog at={s2} end={s3} title="Sign in to your other account" icon="refresh">
          <Field label="Email" value={typed("work@studio.dev", frame, s2 + 6, 18)} caret={frame - s2 < 24} />
          <Field label="Password" value={"•".repeat(Math.min(10, Math.max(0, Math.floor((frame - s2 - 24) / 2.5))))} caret={frame - s2 >= 24 && frame - s2 < 50} />
          <Btn label="Sign in" pressed={frame - s2 > 56} />
        </Dialog>
        {/* 3 set the project up again */}
        <Dialog at={s3} end={s4} title="Open folder" icon="folder">
          <Field label="Path" value={typed("~/code/studio/api", frame, s3 + 4, 20)} mono />
          {["api", "web", "mobile"].map((n, i) => <div key={n} style={{ height: 48, display: "flex", alignItems: "center", gap: 12, fontSize: 22, color: i === 0 ? A.textHi : A.muted, background: i === 0 && frame - s3 > 22 ? "#2f3038" : "transparent", borderRadius: 8, padding: "0 12px" }}><Icon name="folder" size={22} />{n}</div>)}
          {frame - s3 > 36 && <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 20, fontSize: 21, color: A.amber }}>Trust the authors of this folder?<Btn label="Yes, trust" pressed={frame - s3 > 46} /></div>}
        </Dialog>
        {/* 4 find your place */}
        <Dialog at={s4} end={end} title="New session" icon="activity">
          <div style={{ height: 230, fontSize: 25, lineHeight: 1.5, color: A.textHi, border: `1px solid ${A.input}`, borderRadius: 10, padding: 18, background: "#1a1b1f" }}>
            {typed("Okay, so earlier we were halfway through streaming the invoice export. The tests were passing except the CSV one, and I had already changed export.ts and stream.ts…", frame, s4 + 4, 70)}
            <span style={{ display: "inline-block", width: 2, height: 30, background: A.textHi, verticalAlign: -5 }} />
          </div>
        </Dialog>
      </AbsoluteFill>
      <Vignette strength={0.55} />
      {/* dormouse peeks in, then the slogan */}
      {frame >= mouse && (
        <div style={{ position: "absolute", right: 150, bottom: -30, transform: `translateY(${interpolate(mouseP, [0, 1], [380, 0])}px) rotate(${interpolate(mouseP, [0, 1], [8, -3])}deg)` }}>
          <Dormouse size={360} />
        </div>
      )}
      {frame >= slogan && (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 6, paddingRight: 120 }}>
          <Words text="Switch agents." size={132} color={C.cream} delay={slogan} weight={800} />
          <Words text="Not your whole workflow." size={132} color={C.sage} delay={slogan + 10} weight={800} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ============================================================ shared: thread list + shell
type RowDef = { title: string; status: ThreadStatus; account?: typeof ACCOUNTS[number]; worktree?: boolean; dim?: boolean; pulse?: number; time?: string };
const GroupList: React.FC<{ groups: { project: number; rows: (RowDef & { show?: number; h?: number })[] }[]; finished?: number }> = ({ groups, finished = 0 }) => (
  <div>
    {groups.map((g) => (
      <ProjectGroup key={g.project} name={PROJECTS[g.project].name} color={PROJECTS[g.project].color}>
        {g.rows.map((r) => {
          const show = r.show ?? 1, h = r.h ?? 1;
          if (show <= 0 || h <= 0.01) return null;
          return (
            <div key={r.title} style={{ height: 84 * h * Math.min(1, show), overflow: "hidden", opacity: Math.min(1, show) * Math.max(0, Math.min(1, (h - 0.15) / 0.6)), transform: show < 1 ? `translateY(${(1 - show) * -16}px)` : undefined }}>
              <ThreadRow title={r.title} status={r.status} account={r.account} worktree={r.worktree} dim={r.dim} pulse={r.pulse} time={r.time} />
            </div>
          );
        })}
      </ProjectGroup>
    ))}
    {finished > 0 && (
      <div style={{ height: 64, display: "flex", alignItems: "center", gap: 12, padding: "0 20px", color: A.muted, fontSize: 18, borderTop: `1px solid ${A.border}`, opacity: Math.min(1, finished) }}>
        <Icon name="check" size={20} color={A.done} />Finished · 4<span style={{ marginLeft: "auto" }}><Icon name="chevron" size={20} /></span>
      </div>
    )}
  </div>
);

const Stage: React.FC<{ children: ReactNode; pointer?: PointerKey[]; scale?: number; origin?: string; opacity?: number }> = ({ children, pointer, scale = 1, origin = "50% 50%" }) => (
  <div style={{ position: "absolute", left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h, transform: `scale(${scale})`, transformOrigin: origin }}>
    {children}
    {pointer && <Pointer keys={pointer} />}
  </div>
);

const LightBg: React.FC<{ children: ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: C.cream, overflow: "hidden" }}>
    <Glow x={300} y={200} color={C.mint} opacity={0.35} size={1100} drift={1} />
    <Glow x={1700} y={900} color={C.mint} opacity={0.3} size={1000} drift={1} seed={3} />
    {children}
  </AbsoluteFill>
);

// ============================================================ Ch2 · One app, every account
export const Ch2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = (abs: number) => L(abs, T.ch2);
  const win = f(CUE.window), chips = [f(CUE.chipCodex), f(CUE.chipClaude), f(CUE.chipGemini), f(CUE.chipGrok)];
  const rings = f(CUE.rings), amber = f(CUE.ringAmber), pick = f(CUE.pickAccount);
  const winP = spring({ frame: frame - win, fps, config: { damping: 16, stiffness: 140, mass: 0.9 } });
  const providerIdx = (a: typeof ACCOUNTS[number]) => ["Codex", "Claude Code", "Gemini", "Grok"].indexOf(a.provider);
  const footerItems = ACCOUNTS.map((a) => {
    const at = chips[providerIdx(a)];
    const show = spring({ frame: frame - at - (a.label === "work" || a.id === "claude-work" ? 4 : 0), fps, config: { damping: 15, stiffness: 190, mass: 0.8 } });
    const fill = ease(frame, rings + providerIdx(a) * 4, rings + providerIdx(a) * 4 + 26);
    const pulse = a.id === "claude-max" && frame >= amber ? 0.5 + 0.5 * Math.sin((frame - amber) / 5) : 0;
    return { a, show: frame < at ? 0 : show, fill: frame < rings ? 0 : fill, pulse };
  });
  // pick-an-account flow (composer)
  const picked = frame >= pick + 90;
  const account = picked ? acct("codex-work") : acct("claude-work");
  const popPicker = usePop(pick + 56);
  const pickerOpen = frame >= pick + 56 && frame < pick + 92 ? popPicker : 0;
  const hover = frame >= pick + 76 && frame < pick + 92 ? 1 : null;
  const started = frame >= pick + 112;
  const text = typed("Add retry logic to the webhook handler", frame, pick + 8, 30);
  const sendActive = frame >= pick + 108 && frame < pick + 116 ? 2 : frame >= pick + 100 ? 1 : 0;
  const pointer: PointerKey[] = [
    { x: 1100, y: 420, at: pick + 30, leave: pick + 34 },
    { x: 1057, y: 710, at: pick + 52, click: pick + 54, leave: pick + 70 },
    { x: 1080, y: 425, at: pick + 84, click: pick + 88, leave: pick + 98 },
    { x: 1537, y: 776, at: pick + 108, click: pick + 110, leave: pick + 130 },
  ];
  const list = (
    <GroupList groups={[
      { project: 0, rows: [{ title: "Polish the pricing page", status: "running" }, { title: "Fix navigation on tablets", status: "unread" }] },
      { project: 1, rows: [{ title: "Add offline support", status: "running" }, { title: "Ship the new onboarding", status: "unread" }] },
      { project: 2, rows: [{ title: "Add retry logic to the webhook handler", status: "starting", account: acct("codex-work"), show: started ? ease(frame, pick + 112, pick + 124) : 0 }, { title: "Speed up search", status: "unread" }, { title: "Add pagination", status: "unread" }] },
    ]} />
  );
  const accountsPane = (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ height: 56, flexShrink: 0, borderBottom: `1px solid ${A.border}`, display: "flex", alignItems: "center", padding: "0 24px", fontSize: 19, color: A.muted, fontFamily: FONT_MONO }}>Agents &amp; accounts</div>
      <div style={{ padding: "34px 38px", display: "grid", gridTemplateColumns: "470px 470px", gap: 26, alignContent: "start" }}>
        <ProviderCard provider="Codex" accounts={[acct("codex-personal"), acct("codex-work")]} at={chips[0]} />
        <ProviderCard provider="Claude Code" accounts={[acct("claude-max"), acct("claude-work")]} at={chips[1]} />
        <ProviderCard provider="Gemini" accounts={[acct("gemini")]} at={chips[2]} />
        <ProviderCard provider="Grok" accounts={[acct("grok")]} at={chips[3]} />
      </div>
    </div>
  );
  const newPane = (
    <div style={{ flex: 1, display: "flex", opacity: ease(frame, pick, pick + 8) }}>
      <NewThreadPane>
        <Composer text={text} project="API" account={account} pickerOpen={pickerOpen} pickerHover={hover} pickerChosen={account.id} caret={frame < pick + 40} sendActive={sendActive} pickerAccounts={ACCOUNTS} />
      </NewThreadPane>
    </div>
  );
  // usage spotlight (the footer "usage and reset times" popover, enlarged)
  const spot = ease(frame, rings - 6, rings + 6) * (1 - ease(frame, pick - 18, pick - 6));
  const spotP = usePop(rings - 2, { damping: 16, stiffness: 150, mass: 0.9 });
  const open = interpolate(winP, [0, 1], [0.9, 1]);
  return (
    <LightBg>
      <Stage scale={open * (1 + 0.03 * spot)} pointer={frame >= pick ? pointer : undefined}>
        <div style={{ width: WIN.w, height: WIN.h, opacity: interpolate(winP, [0, 0.4], [0, 1], clamp), transform: `translateY(${interpolate(winP, [0, 1], [50, 0])}px)` }}>
          <AppShell list={list} pane={frame >= pick ? newPane : accountsPane} homeActive={false} footer={<UsageFooter items={footerItems} />} />
        </div>
      </Stage>
      {spot > 0.01 && (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <div style={{ position: "absolute", inset: 0, background: `rgba(14,18,12,${0.62 * spot})` }} />
          <div style={{ position: "relative", width: 1360, borderRadius: 24, background: "#1d1e22", border: `1px solid ${A.input}`, boxShadow: "0 60px 140px rgba(0,0,0,0.6)", padding: "34px 40px 40px", opacity: spot, transform: `translateY(${interpolate(spotP, [0, 1], [60, 0])}px) scale(${interpolate(spotP, [0, 1], [0.94, 1])})`, fontFamily: FONT_BODY }}>
            <div style={{ fontSize: 22, color: A.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 26 }}>Usage left · resets</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "26px 30px" }}>
              {ACCOUNTS.map((a, i) => {
                const fill = ease(frame, rings + i * 4, rings + i * 4 + 28);
                const low = a.left <= 10, hot = low && frame >= amber;
                const pulse = hot ? 0.5 + 0.5 * Math.sin((frame - amber) / 5) : 0;
                return (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 22, padding: "20px 22px", borderRadius: 16, background: hot ? `rgba(233,182,103,${0.1 + 0.1 * pulse})` : "#25262b", border: `1px solid ${hot ? A.amber : A.border}` }}>
                    <UsageRing remaining={a.left} color={a.color} size={84} fill={fill}><span style={{ fontSize: 30, fontWeight: 700, color: hot ? A.amber : A.muted }}>{a.glyph}</span></UsageRing>
                    <div style={{ lineHeight: 1.3 }}>
                      <div style={{ fontSize: 23, fontWeight: 700, color: A.textHi }}>{a.provider}</div>
                      <div style={{ fontSize: 19, color: A.muted }}>{a.label}</div>
                      <div style={{ fontSize: 26, fontWeight: 700, color: hot ? A.amber : A.running, marginTop: 4 }}>{Math.round(a.left * fill)}% left</div>
                      <div style={{ fontSize: 18, color: A.muted }}>resets in {a.reset}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </AbsoluteFill>
      )}
    </LightBg>
  );
};

// ============================================================ Ch3 · Say it, let it run
const GIT_ROWS = [
  { subject: "Add ranking tests", lane: 1, refs: ["worktree · search-ranking"], author: "Codex", hash: "a41f9c2", date: "now", down: true },
  { subject: "Rank results by recency", lane: 1, author: "Codex", hash: "7be03d1", date: "2 min ago", up: true, down: true },
  { subject: "Add pagination to /search", lane: 0, refs: ["main"], author: "Claude Code", hash: "c92aa10", date: "1 h ago", down: true, through: [1] },
  { subject: "Speed up the search index", lane: 0, author: "Claude Code", hash: "55d8e7f", date: "3 h ago", up: true, down: true, forkFrom: 1 },
  { subject: "Fix cursor bug in list view", lane: 0, author: "Gemini", hash: "0c1d4be", date: "Yesterday", up: true, down: true },
  { subject: "Update dependencies", lane: 0, author: "Grok", hash: "e3f6a81", date: "Yesterday", up: true },
];

export const Ch3: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = (abs: number) => L(abs, T.ch3);
  const voice = f(CUE.voice), grouped = f(CUE.threadsGrouped), wt = f(CUE.worktree), sched = f(CUE.schedules);
  // --- voice -> thread (Home) ---
  const listen0 = voice + 18, listen1 = voice + 74, textAt = voice + 58, startAt = voice + 100;
  const listening = frame >= listen0 && frame < listen1 + 6 ? 1 : 0;
  const dictated = typed("Add a dark mode toggle to the settings page", frame, textAt, 26);
  const homeStarted = frame >= startAt + 6;
  const newRowShow = homeStarted ? ease(frame, startAt + 8, startAt + 22) : 0;
  // --- threads grouped: unread -> read/done, dim, fold ---
  const read = grouped + 26, fold = grouped + 62;
  const rd = frame >= read;
  const dimP = ease(frame, read, read + 14), foldP = ease(frame, fold, fold + 18);
  const doneRow = (title: string, account?: typeof ACCOUNTS[number]): RowDef & { h: number } => ({ title, status: rd ? "done" : "unread", dim: rd, account, h: 1 - foldP });
  // --- worktree ---
  const wtFlow = frame >= wt && frame < wt + 100;
  const wtText = typed("Refactor search ranking for recent results", frame, wt + 4, 40);
  const wtOn = frame >= wt + 34;
  const wtStart = wt + 66;
  const wtRow = frame >= wtStart + 6 ? ease(frame, wtStart + 8, wtStart + 22) : 0;
  const gitAt = wt + 82, gitP = ease(frame, gitAt + 4, gitAt + 50);
  const inGit = frame >= gitAt && frame < sched;
  const inSched = frame >= sched;
  const fin = foldP;
  const list = (
    <GroupList finished={fin} groups={[
      { project: 0, rows: [{ title: "Add a dark mode toggle", status: "running", account: acct("codex-personal"), show: newRowShow, pulse: frame < startAt + 40 ? 1 - ease(frame, startAt + 10, startAt + 40) : 0 }, { title: "Polish the pricing page", status: "running" }, { ...doneRow("Fix navigation on tablets") }] },
      { project: 1, rows: [{ title: "Add offline support", status: "running" }, { ...doneRow("Ship the new onboarding") }] },
      { project: 2, rows: [
        { title: "Refactor search ranking", status: "running", account: acct("codex-work"), worktree: true, show: wtRow },
        { title: "Add retry logic to the webhook handler", status: "running", account: acct("codex-work") },
        { ...doneRow("Speed up search") }, { ...doneRow("Add pagination") }] },
    ]} />
  );
  // --- right pane ---
  const tileBusy = frame >= startAt + 8;
  const homePane = (
    <div style={{ flex: 1, padding: 36, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, height: 76 }}>
        <Dormouse size={76} />
        <div><div style={{ fontSize: 28, fontWeight: 700, color: A.textHi }}>Working</div><div style={{ fontSize: 19, color: A.muted }}>{tileBusy ? "3 working" : "2 working"}</div></div>
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 16, color: A.muted, letterSpacing: "0.12em", margin: "30px 0 14px", paddingBottom: 10, borderBottom: `1px solid ${A.border}` }}>TODAY</div>
      <div style={{ display: "flex", gap: 18 }}>
        <HomeTile name="Website" color={PROJECTS[0].color} working={tileBusy ? 2 : 1} done={1} listening={listening} width={310} agent={frame >= listen0 - 8 ? "Codex · personal" : undefined}>
          {frame >= listen0 - 8 && !tileBusy && (
            <div style={{ marginTop: 14 }}>
              <div style={{ minHeight: 70, borderRadius: 10, border: `1px solid ${A.input}`, background: "#1a1b1f", padding: "12px 14px", fontSize: 19, lineHeight: 1.4, color: A.textHi }}>
                {frame < textAt ? <Wave level={interpolate(frame, [listen0, listen0 + 10, listen1, listen1 + 6], [0.2, 1, 1, 0.1], clamp)} n={21} h={46} /> : <>{dictated}<span style={{ display: "inline-block", width: 2, height: 22, background: A.textHi, verticalAlign: -3 }} /></>}
              </div>
              {frame >= textAt + 30 && <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}><div style={{ padding: "9px 22px", borderRadius: 8, background: "#e1e1e7", color: "#202126", fontSize: 19, fontWeight: 700, transform: `scale(${frame >= startAt && frame < startAt + 8 ? 0.9 : 1})` }}>Start</div></div>}
            </div>
          )}
          {tileBusy && <div style={{ marginTop: 14, fontSize: 18, color: A.running }}>Started “Add a dark mode toggle”</div>}
        </HomeTile>
        <HomeTile name="Mobile app" color={PROJECTS[1].color} working={1} done={1} width={310} />
        <HomeTile name="API" color={PROJECTS[2].color} working={1} done={2} width={310} />
      </div>
      <div style={{ position: "absolute", left: 36, right: 36, bottom: 30 }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 16, color: A.muted, letterSpacing: "0.12em", paddingBottom: 10, borderBottom: `1px solid ${A.border}` }}>NEEDS YOU  0</div>
        <div style={{ fontSize: 19, color: A.muted, margin: "14px 0 22px" }}>Nothing is waiting on you.</div>
        <div style={{ border: `1px solid ${A.border}`, borderRadius: 12, padding: "16px 22px", fontSize: 19, lineHeight: 1.55, color: A.text }}>
          <div style={{ display: "flex", gap: 14, fontWeight: 700, color: A.textHi, marginBottom: 6 }}>Today <span style={{ fontWeight: 400, color: A.muted }}>6 threads</span></div>
          Across three projects: shipped onboarding, fixed tablet navigation, and added search pagination.
        </div>
      </div>
    </div>
  );
  const newPane = (
    <NewThreadPane>
      <Composer text={wtText} project="API" account={acct("codex-work")} worktree={wtOn} worktreeGlow={wtOn ? 1 - ease(frame, wt + 34, wt + 52) : 0} caret={frame < wt + 30} sendActive={frame >= wt + 60 && frame < wt + 70 ? 2 : frame >= wt + 52 ? 1 : 0} />
    </NewThreadPane>
  );
  const gitPane = (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ height: 56, flexShrink: 0, borderBottom: `1px solid ${A.border}`, display: "flex", alignItems: "center", gap: 14, padding: "0 24px", fontSize: 19, color: A.muted }}>
        <span style={{ width: 12, height: 12, borderRadius: 4, background: PROJECTS[2].color }} /><b style={{ color: A.textHi }}>API</b>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_MONO }}><Icon name="branch" size={18} />main</span>
        <span style={{ marginLeft: "auto", fontSize: 17 }}>6 commits · 2 branches</span>
      </div>
      <div style={{ padding: "6px 30px" }}><GitGraph rows={GIT_ROWS} reveal={gitP} /></div>
    </div>
  );
  const schedPane = (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ height: 56, flexShrink: 0, borderBottom: `1px solid ${A.border}`, display: "flex", alignItems: "center", padding: "0 24px", fontSize: 19, color: A.muted, fontFamily: FONT_MONO }}>Schedules</div>
      <div style={{ padding: "40px 60px", display: "flex", flexDirection: "column", gap: 22 }}>
        <ScheduleCard at={sched + 6} name="Check overnight failures" project="API" color={PROJECTS[2].color} when="Weekdays · 9:00 AM" next="Tomorrow 9:00 AM" account={acct("codex-work")} width={920} highlight={ease(frame, sched + 10, sched + 30) * (1 - ease(frame, sched + 60, sched + 90))} />
        <ScheduleCard at={sched + 30} name="Draft the weekly changelog" project="Website" color={PROJECTS[0].color} when="Fridays · 4:30 PM" next="Fri 4:30 PM" account={acct("claude-work")} width={920} />
        <ScheduleCard at={sched + 54} name="Triage new store reviews" project="Mobile app" color={PROJECTS[1].color} when="Weekdays · 8:30 AM" next="Tomorrow 8:30 AM" account={acct("gemini")} width={920} />
        <Pop at={sched + 78} style={{ fontSize: 22, color: A.muted, textAlign: "center", marginTop: 8 }}>Runs while you do something else.</Pop>
      </div>
    </div>
  );
  const pane = inSched ? schedPane : inGit ? gitPane : wtFlow ? newPane : homePane;
  // pointer
  const mic: PointerKey = { x: 855, y: 281, at: voice + 10, click: voice + 16, leave: voice + 90 };
  const pointer: PointerKey[] = frame < wt ? [mic, { x: 880, y: 514, at: startAt - 2, click: startAt, leave: startAt + 30 }, { x: 1400, y: 440, at: startAt + 50 }] : [{ x: 1300, y: 420, at: wt + 20, leave: wt + 22 }, { x: 1256, y: 710, at: wt + 32, click: wt + 34, leave: wt + 46 }, { x: 1537, y: 776, at: wt + 62, click: wt + 64, leave: wt + 80 }];
  // camera: push to the list while the groups read
  const camIn = ease(frame, grouped - 8, grouped + 14) * (1 - ease(frame, wt - 14, wt - 2));
  return (
    <LightBg>
      <Stage scale={1 + 0.22 * camIn} origin="12% 40%" pointer={frame < grouped - 10 || (frame >= wt && frame < wt + 84) ? pointer : undefined}>
        <AppShell list={list} pane={pane} homeActive={!inSched && !inGit && !wtFlow} footer={<UsageFooter items={ACCOUNTS.map((a) => ({ a, show: 1, fill: 1, pulse: a.id === "claude-max" ? 0.5 + 0.5 * Math.sin(frame / 5) : 0 }))} />} />
      </Stage>
    </LightBg>
  );
};

// ============================================================ Close
export const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = (abs: number) => L(abs, T.close);
  const again = f(CUE.limitAgain), logo = f(CUE.logo), cta = f(CUE.cta);
  const sw = again + 62; // account switch
  const termP = spring({ frame: frame - again + 6, fps, config: { damping: 16, stiffness: 120, mass: 0.9 } });
  const extra = [
    { t: "", c: A.text },
    { t: "● Switched account · Codex · work", c: "#9bd3ad" },
    { t: "● Bash(pnpm test billing)", c: "#9bb7e8" },
    { t: "    ✓ 38 passed", c: "#9bd3ad" },
  ];
  const lines = TERM_LINES.length + (frame >= sw + 14 ? 1 : 0) + (frame >= sw + 30 ? 1 : 0) + (frame >= sw + 46 ? 1 : 0);
  const waveP = spring({ frame: frame - (sw + 40), fps, config: { damping: 9, stiffness: 150, mass: 0.8 } });
  const wave = Math.sin((frame - sw - 40) / 3.5) * 14 * Math.min(1, Math.max(0, (frame - sw - 40) / 6)) * (frame < logo - 6 ? 1 : 0);
  const darkP = 1 - ease(frame, logo - 1, logo + 4);
  const showLogo = frame >= logo && frame < cta;
  const termFade = frame < logo ? 1 : 0;
  const ctaP = usePop(cta, { damping: 16, stiffness: 160, mass: 0.9 });
  return (
    <AbsoluteFill style={{ background: C.cream, overflow: "hidden" }}>
      {frame < logo && (
        <AbsoluteFill style={{ background: C.bgDark, opacity: darkP }}>
          <Glow x={960} y={560} color="#4d613d" opacity={0.4} drift={1} size={1500} />
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: termFade * interpolate(termP, [0, 0.4], [0, 1], clamp), transform: `scale(${interpolate(termP, [0, 1], [0.96, 1.0])})` }}>
            <Terminal tabs={1} lines={lines} extra={extra} style={{ position: "relative" }}>
              <div style={{ color: "#8f9099", marginTop: 6 }}>{frame >= sw + 54 ? "✻ Working… (esc to interrupt)" : ""}</div>
            </Terminal>
            <div style={{ position: "absolute", left: 280, top: 150, width: 1360, height: 780 }}>
              {frame < sw ? <LimitBanner at={again + 16} /> : <LimitBanner at={sw} tone="green" text="Switched to Codex · work — carrying on" />}
            </div>
          </AbsoluteFill>
          {/* switch chip: the account swap in Freddai, one click */}
          <Pop at={again + 38} y={30} style={{ position: "absolute", left: 1210, top: 120, opacity: frame >= sw + 10 ? 0.0 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "16px 24px", borderRadius: 16, background: "#23242a", border: `1px solid #44454e`, boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}>
              <AccountButton a={acct(frame >= sw - 8 ? "codex-work" : "claude-max")} size={50} />
            </div>
          </Pop>
          {frame >= sw + 36 && (
            <div style={{ position: "absolute", right: 140, bottom: 0, transform: `translateY(${interpolate(waveP, [0, 1], [320, 0])}px) rotate(${wave * 0.4}deg)`, transformOrigin: "50% 100%" }}>
              <Dormouse size={320} />
            </div>
          )}
          <Vignette strength={0.5} />
        </AbsoluteFill>
      )}
      {showLogo && (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 46 }}>
          <Glow x={960} y={520} color={C.mint} opacity={0.5} size={1400} drift={1} />
          <Pop at={logo} y={30} from={0.85} origin="50% 50%"><Logo size={170} /></Pop>
          <Words text="Give all your agents a home." delay={logo + 10} size={84} color={C.forest} weight={700} />
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
