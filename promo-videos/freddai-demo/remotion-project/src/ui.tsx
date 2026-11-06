import React, { CSSProperties, ReactNode } from "react";
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT_BODY, FONT_MONO } from "./fonts";
import { C, clamp } from "./theme";

// Desktop Freddai UI rebuilt from packages/app (workspace.css / appearance.css dark palette, DesktopApp layout).
// Everything is sized at ~1.5x the real app (12px base -> 18px) so it reads at 1080p.
// All `at` / `start` values are LOCAL frames (inside the chapter <Sequence>).

export const A = {
  bg: "#18191c", card: "#1d1e22", surface: "#25262b", accent: "#2d2e35", border: "#303137", input: "#383940",
  text: "#dedee3", textHi: "#f0f0f3", muted: "#93949f", subtle: "#6f7079",
  running: "#7fd0a0", unread: "#d49a4c", amber: "#e9b667", blue: "#86a8d4", done: "#81af96", red: "#e5646a",
};

// Real provider names. Colours are per-account swatches (the app lets each account carry a colour).
export type Account = { id: string; provider: "Codex" | "Claude Code" | "Gemini" | "Grok"; label: string; color: string; left: number; reset: string; glyph: string };
export const ACCOUNTS: Account[] = [
  { id: "codex-personal", provider: "Codex", label: "personal", color: "#7fd0a0", left: 82, reset: "4h 12m", glyph: "C" },
  { id: "codex-work", provider: "Codex", label: "work", color: "#5fb98a", left: 64, reset: "2h 40m", glyph: "C" },
  { id: "claude-max", provider: "Claude Code", label: "Max", color: "#e08f6c", left: 9, reset: "52m", glyph: "✳" },
  { id: "claude-work", provider: "Claude Code", label: "work", color: "#d9a070", left: 71, reset: "3h 05m", glyph: "✳" },
  { id: "gemini", provider: "Gemini", label: "personal", color: "#7ea6f0", left: 93, reset: "9h 30m", glyph: "G" },
  { id: "grok", provider: "Grok", label: "personal", color: "#c9c9d2", left: 58, reset: "1h 48m", glyph: "X" },
];
export const PROJECTS = [
  { name: "Website", color: "#9a86e8" },
  { name: "Mobile app", color: "#6fc2a0" },
  { name: "API", color: "#e0a458" },
];

// Window geometry (window-local coordinates) so scenes can aim cursors at real elements.
export const WIN = { x: 140, y: 80, w: 1640, h: 920, title: 56, foot: 64, listW: 600 };
export const PANE = { x: WIN.listW, y: WIN.title, w: WIN.w - WIN.listW, h: WIN.h - WIN.title - WIN.foot };

export const usePop = (start: number, cfg = { damping: 15, stiffness: 190, mass: 0.8 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - start, fps, config: cfg });
};

export const Pop: React.FC<{ at: number; children: ReactNode; style?: CSSProperties; from?: number; y?: number; origin?: string; hold?: boolean }> = ({ at, children, style, from = 0.94, y = 16, origin = "50% 100%" }) => {
  const frame = useCurrentFrame();
  const p = usePop(at);
  if (frame < at) return null;
  return <div style={{ transform: `translateY(${interpolate(p, [0, 1], [y, 0])}px) scale(${interpolate(p, [0, 1], [from, 1])})`, opacity: interpolate(p, [0, 0.5], [0, 1], clamp), transformOrigin: origin, ...style }}>{children}</div>;
};

// ---------- icons (lucide-style strokes) ----------
const ICONS: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  mic: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /></>,
  arrowUp: <path d="M12 19V5M5 12l7-7 7 7" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  home: <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></>,
  panel: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  branch: <><path d="M6 3v12" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  folder: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
  folderPlus: <><path d="M12 10v6M9 13h6" /><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></>,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  alert: <><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></>,
  help: <><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
  repeat: <><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></>,
};
export const Icon: React.FC<{ name: keyof typeof ICONS | string; size?: number; color?: string; stroke?: number; style?: CSSProperties }> = ({ name, size = 22, color = "currentColor", stroke = 1.7, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>{ICONS[name]}</svg>
);

export const Dormouse: React.FC<{ size?: number; style?: CSSProperties }> = ({ size = 120, style }) => (
  <Img src={staticFile("brand/dormouse.svg")} style={{ width: size, height: size, ...style }} />
);

// ---------- window chrome ----------
export const TrafficLights: React.FC = () => (
  <div style={{ display: "flex", gap: 9 }}>{["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />)}</div>
);

const TitleBtn: React.FC<{ icon: string; active?: boolean }> = ({ icon, active }) => (
  <div style={{ width: 38, height: 38, borderRadius: 8, display: "grid", placeItems: "center", color: active ? A.textHi : A.muted, background: active ? A.surface : "transparent" }}><Icon name={icon} size={22} /></div>
);

export const FreddaiTitlebar: React.FC<{ homeActive?: boolean }> = ({ homeActive }) => (
  <div style={{ height: WIN.title, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 18px", borderBottom: `1px solid ${A.border}`, background: "#202126", position: "relative" }}>
    <TrafficLights />
    <div style={{ display: "flex", gap: 4, marginLeft: 26 }}><TitleBtn icon="home" active={homeActive} /><TitleBtn icon="panel" active /></div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, pointerEvents: "none" }}>
      <Dormouse size={34} />
      <span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 24, color: A.textHi, letterSpacing: "-0.01em" }}>freddai</span>
    </div>
    <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}><TitleBtn icon="plus" /><TitleBtn icon="more" /></div>
  </div>
);

// Generic dark Mac window. `titlebar` defaults to a plain bar with `title`; pass <FreddaiTitlebar/> for the product.
export const MacWindow: React.FC<{ width: number; height: number; title?: string; titlebar?: ReactNode; children: ReactNode; style?: CSSProperties; radius?: number; light?: boolean }> = ({ width, height, title, titlebar, children, style, radius = 16, light }) => (
  <div style={{ width, height, borderRadius: radius, overflow: "hidden", background: light ? "#f4f3ee" : A.bg, border: `1px solid ${light ? "#d9d8d0" : "#3a3b42"}`, boxShadow: "0 60px 140px rgba(20,26,18,0.42), 0 14px 36px rgba(20,26,18,0.22)", display: "flex", flexDirection: "column", fontFamily: FONT_BODY, color: A.text, position: "relative", ...style }}>
    {titlebar ?? (
      <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 18px", gap: 20, borderBottom: `1px solid ${light ? "#dedcd3" : A.border}`, background: light ? "#ecebe4" : "#202126" }}>
        <TrafficLights />
        {title && <div style={{ fontSize: 19, fontWeight: 600, color: light ? "#5b5b57" : A.muted, flex: 1, textAlign: "center", marginRight: 70 }}>{title}</div>}
      </div>
    )}
    <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>{children}</div>
  </div>
);

// ---------- thread list ("Sidebar" = the real thread-browser pane) ----------
const Picker: React.FC<{ label: string; width?: number; strong?: boolean }> = ({ label, width, strong }) => (
  <div style={{ height: 40, padding: "0 14px", width, border: `1px solid ${A.input}`, borderRadius: 8, display: "flex", alignItems: "center", gap: 10, fontSize: 18, color: strong ? A.textHi : A.text, background: "transparent", whiteSpace: "nowrap" }}>
    <span style={{ flex: 1 }}>{label}</span><Icon name="chevron" size={16} color={A.muted} />
  </div>
);
export { Picker };

export const Sidebar: React.FC<{ children: ReactNode; width?: number; style?: CSSProperties; query?: string }> = ({ children, width = WIN.listW, style, query }) => (
  <div style={{ width, flexShrink: 0, borderRight: `1px solid ${A.border}`, background: A.bg, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", ...style }}>
    <div style={{ height: 62, display: "flex", alignItems: "center", gap: 12, padding: "0 18px", flexShrink: 0 }}>
      <div style={{ flex: 1, height: 42, borderRadius: 8, border: `1px solid ${A.input}`, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", color: A.muted, fontSize: 18 }}>
        <Icon name="search" size={19} /><span style={{ color: query ? A.text : A.muted }}>{query || "Filter threads…"}</span>
      </div>
      <Icon name="folderPlus" size={24} color={A.muted} />
    </div>
    <div style={{ display: "flex", gap: 12, padding: "0 18px 14px", flexShrink: 0 }}><Picker label="All projects" width={200} /><Picker label="All threads" width={190} /></div>
    <div style={{ flex: 1, overflow: "hidden" }}>{children}</div>
  </div>
);

export const ProjectGroup: React.FC<{ name: string; color: string; children?: ReactNode; style?: CSSProperties }> = ({ name, color, children, style }) => (
  <div style={style}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px 12px", fontSize: 18, fontWeight: 700, color: A.textHi }}>
      <Icon name="folder" size={22} color={color} /><span>{name}</span><span style={{ marginLeft: "auto", color: A.muted }}><Icon name="plus" size={20} /></span>
    </div>
    {children}
  </div>
);

export type ThreadStatus = "running" | "unread" | "done" | "question" | "starting";
const STATUS: Record<ThreadStatus, { color: string; sub: string }> = {
  running: { color: A.running, sub: "Running" }, unread: { color: A.unread, sub: "Unread reply" }, done: { color: A.done, sub: "Done" },
  question: { color: A.amber, sub: "Needs you" }, starting: { color: A.blue, sub: "Starting…" },
};
export const ThreadRow: React.FC<{ title: string; status: ThreadStatus; time?: string; account?: Account; dim?: boolean; worktree?: boolean; selected?: boolean; sub?: string; style?: CSSProperties; pulse?: number }> = ({ title, status, time = "Nov 4", account, dim, worktree, selected, sub, style, pulse = 0 }) => {
  const s = STATUS[status];
  const frame = useCurrentFrame();
  const beat = status === "running" || status === "starting" ? 0.78 + 0.22 * Math.sin(frame / 5) : 1;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 20px", height: 84, borderBottom: `1px solid ${A.border}`, background: selected ? "#262b36" : `rgba(134,168,212,${0.14 * pulse})`, boxShadow: selected ? "inset 3px 0 #8c9fce" : undefined, opacity: dim ? 0.42 : 1, ...style }}>
      <div style={{ width: 13, height: 13, borderRadius: 7, background: s.color, opacity: beat, boxShadow: status === "running" ? `0 0 ${10 * beat}px ${s.color}` : undefined, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 21, fontWeight: 600, color: A.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ fontSize: 16, color: A.muted, marginTop: 5, display: "flex", gap: 10, alignItems: "center" }}>
          <span>{sub ?? s.sub}</span>
          {account && <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: account.color }} />{account.provider} · {account.label}</span>}
          {worktree && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#b4a0f0" }}><Icon name="branch" size={15} />Worktree</span>}
        </div>
      </div>
      <div style={{ fontSize: 16, color: A.muted, flexShrink: 0 }}>{time}</div>
    </div>
  );
};

// ---------- usage rings + footer ----------
export const UsageRing: React.FC<{ remaining: number | null; color: string; size?: number; children?: ReactNode; fill?: number }> = ({ remaining, color, size = 40, children, fill = 1 }) => {
  const shown = remaining === null ? 0 : remaining * fill;
  const low = remaining !== null && remaining <= 10;
  return (
    <div style={{ width: size, height: size, position: "relative", display: "grid", placeItems: "center", flexShrink: 0 }}>
      <svg viewBox="0 0 36 36" width={size} height={size} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx="18" cy="18" r="15" fill="none" stroke="#33343b" strokeWidth="3" />
        {shown > 0 && <circle cx="18" cy="18" r="15" fill="none" stroke={low ? "#e9b667" : color} strokeWidth="3" strokeLinecap="round" pathLength={100} strokeDasharray={`${shown} 100`} />}
      </svg>
      {children}
    </div>
  );
};

export const AccountButton: React.FC<{ a: Account; fill?: number; label?: boolean; pulse?: number; style?: CSSProperties; size?: number }> = ({ a, fill = 1, label = true, pulse = 0, style, size = 40 }) => {
  const low = a.left <= 10;
  const shown = Math.round(a.left * fill);
  return (
    <div style={{ fontFamily: FONT_BODY, display: "flex", alignItems: "center", gap: 12, padding: "6px 12px", borderRadius: 10, background: pulse ? `rgba(233,182,103,${0.16 * pulse})` : "transparent", ...style }}>
      <UsageRing remaining={a.left} color={a.color} fill={fill} size={size}><span style={{ fontSize: size * 0.4, color: low && fill > 0.5 ? A.amber : A.muted, fontWeight: 700 }}>{a.glyph}</span></UsageRing>
      <div style={{ lineHeight: 1.25, whiteSpace: "nowrap" }}>
        <div style={{ fontSize: size * 0.4, fontWeight: 600, color: A.text }}>{a.provider} · {a.label}</div>
        <div style={{ fontSize: size * 0.36, color: low && fill > 0.5 ? A.amber : A.muted }}>{label && fill > 0.02 ? `${shown}% left - ${a.reset}` : "—"}</div>
      </div>
    </div>
  );
};

export const UsageFooter: React.FC<{ items: { a: Account; show: number; fill: number; pulse?: number }[] }> = ({ items }) => (
  <div style={{ height: WIN.foot, flexShrink: 0, borderTop: `1px solid ${A.border}`, background: "#1c1d21", display: "flex", alignItems: "center", padding: "0 10px", gap: 0, overflow: "hidden" }}>
    {items.map(({ a, show, fill, pulse }) => (
      <div key={a.id} style={{ opacity: interpolate(show, [0, 0.5], [0, 1], clamp), transform: `translateY(${interpolate(show, [0, 1], [14, 0])}px)` }}>
        <AccountButton a={a} fill={fill} pulse={pulse} size={36} />
      </div>
    ))}
  </div>
);

// ---------- accounts panel ----------
export const ProviderCard: React.FC<{ provider: Account["provider"]; accounts: Account[]; at: number; width?: number }> = ({ provider, accounts, at, width = 470 }) => {
  const color = accounts[0].color;
  return (
    <Pop at={at} y={26} from={0.92} origin="50% 50%" style={{ width }}>
      <div style={{ border: `1px solid ${A.border}`, borderRadius: 14, background: A.card, padding: 22, height: 250 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: `${color}26`, border: `1px solid ${color}77`, display: "grid", placeItems: "center", color, fontSize: 24, fontWeight: 800 }}>{accounts[0].glyph}</div>
          <div><div style={{ fontSize: 24, fontWeight: 700, color: A.textHi }}>{provider}</div><div style={{ fontSize: 16, color: A.muted }}>{accounts.length} account{accounts.length > 1 ? "s" : ""} connected</div></div>
        </div>
        {accounts.map((a, i) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, height: 54, borderTop: `1px solid ${A.border}`, fontSize: 19, color: A.text }}>
            <span style={{ width: 11, height: 11, borderRadius: 6, background: a.color }} />
            <span style={{ fontWeight: 600 }}>{a.label}</span>
            {i === 0 && <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 6, border: `1px solid ${A.input}`, color: A.muted }}>Default</span>}
            <span style={{ marginLeft: "auto", fontSize: 16, color: A.done, display: "flex", alignItems: "center", gap: 6 }}><Icon name="check" size={16} />Signed in</span>
          </div>
        ))}
      </div>
    </Pop>
  );
};

// ---------- composer (new thread) ----------
export const COMPOSER = { w: 920, h: 280, bottom: 36 };
const Wave: React.FC<{ level: number; n?: number; color?: string; h?: number }> = ({ level, n = 26, color = A.amber, h = 44 }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, height: h }}>
      {Array.from({ length: n }).map((_, i) => {
        const v = (0.5 + 0.5 * Math.sin(frame / 3.2 + i * 0.9)) * (0.55 + 0.45 * Math.sin(frame / 7 + i * 2.1));
        return <div key={i} style={{ width: 5, borderRadius: 3, background: color, height: Math.max(4, v * h * level) }} />;
      })}
    </div>
  );
};
export { Wave };

export const MicButton: React.FC<{ listening?: number; size?: number }> = ({ listening = 0, size = 44 }) => {
  const frame = useCurrentFrame();
  const ring = listening ? 0.5 + 0.5 * Math.sin(frame / 4) : 0;
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2, display: "grid", placeItems: "center", color: listening ? "#2a1c08" : A.muted, background: listening ? A.amber : "transparent", boxShadow: listening ? `0 0 0 ${6 + ring * 8}px rgba(233,182,103,${0.2 - ring * 0.1})` : undefined, border: listening ? "none" : `1px solid ${A.input}` }}>
      <Icon name="mic" size={size * 0.5} />
    </div>
  );
};

export const Composer: React.FC<{
  text?: string; placeholder?: string; project?: string; account?: Account; worktree?: boolean; listening?: number;
  sendActive?: number; pickerOpen?: number; pickerHover?: number | null; pickerChosen?: string; pickerAccounts?: Account[]; caret?: boolean; worktreeGlow?: number;
}> = ({ text = "", placeholder = "What should we work on?", project = "Website", account = ACCOUNTS[0], worktree = false, listening = 0, sendActive = 0, pickerOpen = 0, pickerHover = null, pickerChosen, pickerAccounts = ACCOUNTS, caret = false, worktreeGlow = 0 }) => (
  <div style={{ width: COMPOSER.w, height: COMPOSER.h, border: `1px solid ${A.input}`, borderRadius: 16, background: "#202228", padding: 20, display: "flex", flexDirection: "column", position: "relative", boxSizing: "border-box" }}>
    <div style={{ height: 110, fontSize: 24, lineHeight: 1.45, color: text ? A.textHi : A.subtle, overflow: "hidden" }}>
      {text || placeholder}{caret && <span style={{ display: "inline-block", width: 2, height: 28, background: A.textHi, marginLeft: 2, verticalAlign: -5 }} />}
    </div>
    <div style={{ height: 52, marginTop: 14, display: "flex", gap: 12, alignItems: "center", position: "relative" }}>
      <Picker label={project} width={200} />
      <div style={{ position: "relative" }}>
        <Picker label={`${account.provider} · ${account.label}`} width={330} strong />
        {pickerOpen > 0 && (
          <div style={{ position: "absolute", left: 0, bottom: 52, width: 420, borderRadius: 12, background: "#24252a", border: `1px solid ${A.input}`, boxShadow: "0 30px 70px rgba(0,0,0,0.55)", padding: 6, opacity: interpolate(pickerOpen, [0, 0.6], [0, 1], clamp), transform: `translateY(${interpolate(pickerOpen, [0, 1], [10, 0])}px)`, zIndex: 5 }}>
            {pickerAccounts.map((a, i) => (
              <div key={a.id} style={{ height: 56, display: "flex", alignItems: "center", gap: 14, padding: "0 14px", borderRadius: 8, fontSize: 20, color: A.textHi, background: pickerHover === i ? "#34353d" : "transparent" }}>
                <span style={{ width: 12, height: 12, borderRadius: 6, background: a.color }} />{a.provider} · {a.label}
                {pickerChosen === a.id && <span style={{ marginLeft: "auto" }}><Icon name="check" size={20} color={A.textHi} /></span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 19, color: A.text, padding: "0 10px", borderRadius: 8, height: 44, background: `rgba(180,160,240,${0.2 * worktreeGlow})` }}>
        <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${worktree ? "#b4a0f0" : A.input}`, background: worktree ? "#b4a0f0" : "transparent", display: "grid", placeItems: "center" }}>{worktree && <Icon name="check" size={17} color="#1a1530" stroke={3} />}</div>
        Separate worktree
      </div>
    </div>
    <div style={{ height: 60, marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 44, height: 44, display: "grid", placeItems: "center", color: A.muted }}><Icon name="plus" size={28} /></div>
      <MicButton listening={listening} />
      <div style={{ fontSize: 17, color: A.muted, border: `1px solid ${A.input}`, borderRadius: 8, padding: "6px 14px" }}>Ask first</div>
      <div style={{ marginLeft: "auto", fontSize: 17, color: A.muted }}>Default model</div>
      <div style={{ width: 46, height: 46, borderRadius: 23, display: "grid", placeItems: "center", background: sendActive ? "#e1e1e7" : "#3a3b43", color: sendActive ? "#202126" : "#888994", transform: `scale(${1 - 0.12 * Math.max(0, sendActive - 1)})` }}><Icon name="arrowUp" size={24} stroke={2.2} /></div>
    </div>
  </div>
);

// Center hero above the composer ("What should we work on today?")
export const NewThreadPane: React.FC<{ children: ReactNode; hero?: boolean }> = ({ children, hero = true }) => (
  <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
    <div style={{ height: 56, flexShrink: 0, borderBottom: `1px solid ${A.border}`, display: "flex", alignItems: "center", padding: "0 20px", fontSize: 18, color: A.muted, fontFamily: FONT_MONO }}>
      <span>New thread</span><span style={{ marginLeft: "auto" }}><Icon name="x" size={20} /></span>
    </div>
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
      {hero && <><Dormouse size={150} /><div style={{ fontSize: 30, fontWeight: 600, color: A.textHi }}>What should we work on today?</div></>}
    </div>
    <div style={{ padding: `0 ${(PANE.w - COMPOSER.w) / 2}px ${COMPOSER.bottom}px` }}>{children}</div>
  </div>
);

// ---------- Home tiles ----------
export const HomeTile: React.FC<{ name: string; color: string; working: number; done: number; needs?: number; listening?: number; agent?: string; children?: ReactNode; width?: number; glow?: number }> = ({ name, color, working, done, needs = 0, listening = 0, agent, children, width = 300, glow = 0 }) => (
  <div style={{ width, border: `1px solid ${glow ? `rgba(233,182,103,${0.3 + 0.5 * glow})` : A.border}`, borderRadius: 14, background: A.card, padding: "18px 20px", boxSizing: "border-box", alignSelf: "flex-start" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, background: color }} />
      <span style={{ fontSize: 22, fontWeight: 700, color: A.textHi }}>{name}</span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <MicButton listening={listening} size={42} />
        <div style={{ width: 42, height: 42, borderRadius: 8, border: `1px solid ${A.input}`, display: "grid", placeItems: "center", color: A.muted }}><Icon name="plus" size={22} /></div>
      </span>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", marginTop: 14, fontSize: 17, color: A.muted }}>
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}><Icon name="activity" size={17} />{working} working</span>
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}><Icon name="check" size={17} />{done} done</span>
      <span style={{ display: "flex", gap: 6, alignItems: "center", color: needs ? A.amber : A.muted }}><Icon name="alert" size={17} />{needs} needs you</span>
    </div>
    {agent && <div style={{ marginTop: 14, fontSize: 16, color: A.muted, display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 9, height: 9, borderRadius: 5, background: A.running }} />Agent: {agent}</div>}
    {children}
  </div>
);

// ---------- git history ----------
const LANE = ["#7ea6f0", "#b4a0f0", "#7fd0a0"];
export type GitRow = { subject: string; lane: number; refs?: string[]; author: string; hash: string; date: string; merge?: boolean; up?: boolean; down?: boolean; through?: number[]; forkFrom?: number };
export const GitGraph: React.FC<{ rows: GitRow[]; reveal: number; rowH?: number }> = ({ rows, reveal, rowH = 62 }) => {
  const gw = 110;
  const lx = (l: number) => 30 + l * 34;
  return (
    <div style={{ fontFamily: FONT_BODY }}>
      <div style={{ display: "grid", gridTemplateColumns: `${gw}px 1fr 120px 120px 110px`, height: 44, alignItems: "center", fontSize: 15, color: A.subtle, letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: `1px solid ${A.border}` }}>
        <span>Graph</span><span>Description</span><span>Date</span><span>Author</span><span>Commit</span>
      </div>
      {rows.map((r, i) => {
        const p = interpolate(reveal, [i * 0.1, i * 0.1 + 0.4], [0, 1], clamp);
        const cx = lx(r.lane), mid = rowH / 2;
        return (
          <div key={r.hash} style={{ display: "grid", gridTemplateColumns: `${gw}px 1fr 120px 120px 110px`, height: rowH, alignItems: "center", fontSize: 19, color: A.text, borderBottom: `1px solid #25262b`, opacity: p, transform: `translateX(${(1 - p) * 20}px)` }}>
            <svg width={gw} height={rowH} style={{ display: "block" }}>
              {r.through?.map((l) => <path key={l} d={`M ${lx(l)} 0 V ${rowH}`} stroke={LANE[l]} strokeWidth="2.5" fill="none" />)}
              {r.up && <path d={`M ${cx} 0 V ${mid}`} stroke={LANE[r.lane]} strokeWidth="2.5" fill="none" />}
              {r.down && <path d={`M ${cx} ${mid} V ${rowH}`} stroke={LANE[r.lane]} strokeWidth="2.5" fill="none" />}
              {r.forkFrom !== undefined && <path d={`M ${lx(r.forkFrom)} 0 C ${lx(r.forkFrom)} ${mid * 0.9}, ${cx} ${mid * 0.1}, ${cx} ${mid}`} stroke={LANE[r.forkFrom]} strokeWidth="2.5" fill="none" />}
              <circle cx={cx} cy={mid} r={r.merge ? 8 : 6.5} fill={LANE[r.lane]} />
            </svg>
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              {r.refs?.map((ref) => <span key={ref} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 16, padding: "3px 9px", borderRadius: 7, border: `1px solid ${LANE[r.lane]}`, color: A.textHi, whiteSpace: "nowrap" }}><Icon name="branch" size={14} />{ref}</span>)}
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.subject}</span>
            </span>
            <span style={{ fontSize: 16, color: A.muted }}>{r.date}</span>
            <span style={{ fontSize: 16, color: A.muted }}>{r.author}</span>
            <code style={{ fontSize: 16, color: A.muted, fontFamily: FONT_MONO }}>{r.hash}</code>
          </div>
        );
      })}
    </div>
  );
};

// ---------- schedules ----------
export const ScheduleCard: React.FC<{ name: string; project: string; color: string; when: string; next: string; account: Account; at: number; width?: number; highlight?: number }> = ({ name, project, color, when, next, account, at, width = 920, highlight = 0 }) => (
  <Pop at={at} y={24} from={0.96} origin="50% 0%" style={{ width }}>
    <div style={{ border: `1px solid ${highlight ? `rgba(127,208,160,${0.35 + 0.5 * highlight})` : A.border}`, borderRadius: 14, background: A.card, padding: "20px 24px", display: "flex", alignItems: "center", gap: 20 }}>
      <div style={{ width: 54, height: 54, borderRadius: 14, background: "#25262b", display: "grid", placeItems: "center", color: A.muted }}><Icon name="clock" size={28} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: A.textHi }}>{name}</div>
        <div style={{ fontSize: 18, color: A.muted, marginTop: 6, display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ display: "flex", gap: 7, alignItems: "center" }}><span style={{ width: 11, height: 11, borderRadius: 3, background: color }} />{project}</span>
          <span>{when}</span>
          <span style={{ display: "flex", gap: 7, alignItems: "center" }}><span style={{ width: 9, height: 9, borderRadius: 5, background: account.color }} />{account.provider} · {account.label}</span>
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 15, color: A.subtle, letterSpacing: "0.08em", textTransform: "uppercase" }}>Next run</div>
        <div style={{ fontSize: 21, fontWeight: 600, color: A.running, marginTop: 4 }}>{next}</div>
      </div>
      <div style={{ width: 54, height: 30, borderRadius: 15, background: A.running, position: "relative" }}><div style={{ position: "absolute", right: 4, top: 4, width: 22, height: 22, borderRadius: 11, background: "#12301f" }} /></div>
    </div>
  </Pop>
);

// ---------- pointer ----------
export type PointerKey = { x: number; y: number; at: number; leave?: number; click?: number };
// A cursor that travels between real targets and HOLDS on each until its `leave` frame (default at+14).
export const Pointer: React.FC<{ keys: PointerKey[]; color?: string; scale?: number }> = ({ keys, color = "#fff", scale = 1.3 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < keys[0].at - 14) return null;
  let x = keys[0].x, y = keys[0].y;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const next = keys[i + 1];
    const leave = k.leave ?? k.at + 14;
    if (!next || frame < leave) { x = k.x; y = k.y; break; }
    if (frame < next.at) {
      const p = spring({ frame: frame - leave, fps, config: { damping: 22, stiffness: 120, mass: 0.9 }, durationInFrames: Math.max(8, next.at - leave) });
      x = k.x + (next.x - k.x) * p; y = k.y + (next.y - k.y) * p; break;
    }
    x = next.x; y = next.y;
  }
  const appear = interpolate(frame, [keys[0].at - 14, keys[0].at - 4], [0, 1], clamp);
  const click = keys.find((k) => k.click !== undefined && frame >= k.click! && frame < k.click! + 14);
  const press = click ? interpolate(frame - click.click!, [0, 3, 8], [1, 0.82, 1], clamp) : 1;
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: 40, opacity: appear, pointerEvents: "none", transform: `scale(${scale * press})`, transformOrigin: "2px 2px" }}>
      {click && <div style={{ position: "absolute", left: -22, top: -22, width: 48, height: 48, borderRadius: 24, border: `3px solid ${A.amber}`, opacity: 1 - (frame - click.click!) / 14, transform: `scale(${0.4 + (frame - click.click!) / 14})` }} />}
      <svg width="26" height="32" viewBox="0 0 26 32" style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.5))" }}><path d="M2 2 L2 24 L8 18.5 L12.5 28.5 L17 26.5 L12.6 16.8 L21 16.8 Z" fill={color} stroke="#111" strokeWidth="2" strokeLinejoin="round" /></svg>
    </div>
  );
};

// ---------- shared product shell (title bar + list + pane + footer) ----------
export const AppShell: React.FC<{ list: ReactNode; pane: ReactNode; footer?: ReactNode; homeActive?: boolean; style?: CSSProperties }> = ({ list, pane, footer, homeActive, style }) => (
  <MacWindow width={WIN.w} height={WIN.h} titlebar={<FreddaiTitlebar homeActive={homeActive} />} style={style}>
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <Sidebar>{list}</Sidebar>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "#1b1c20", position: "relative" }}>{pane}</div>
    </div>
    {footer}
  </MacWindow>
);
