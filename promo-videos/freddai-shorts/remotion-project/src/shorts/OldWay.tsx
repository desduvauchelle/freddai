import React, { CSSProperties, ReactNode } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { A, Icon, MacWindow, Pop, TrafficLights, usePop } from "../ui";
import { FONT_BODY, FONT_MONO } from "../fonts";
import { C, clamp } from "../theme";
import { shakeOffset } from "../fx";

// The "old way" pain-beat pieces, rebuilt for 940 px wide windows (film chapter 1 look: dark windows, amber limit banner).
// Every piece takes `at` in SECONDS and `style` (position it with position:absolute + left/top, or stack it in a column).
export const OLD_W = 940;

const useAt = (at: number) => { const { fps } = useVideoConfig(); return Math.round(at * fps); };
const typed = (text: string, frame: number, start: number, cps = 24) => text.slice(0, Math.max(0, Math.min(text.length, Math.floor(((frame - start) / 30) * cps))));
// at <= 0: visible and static from frame 0 (thumbnail frame), no entrance.
const Enter: React.FC<{ a: number; style?: CSSProperties; y?: number; from?: number; origin?: string; children: ReactNode }> = ({ a, children, ...rest }) =>
  a <= 0 ? <div style={rest.style}>{children}</div> : <Pop at={a} {...rest}>{children}</Pop>;
const wrap = (style?: CSSProperties): CSSProperties => ({ width: OLD_W, ...style });

const LINES: { t: string; c: string }[] = [
  { t: "> refactor invoice export to stream", c: A.textHi },
  { t: "● Read(src/billing/export.ts)", c: "#9bb7e8" },
  { t: "● Edit(src/billing/export.ts) +42", c: "#9bd3ad" },
  { t: "● Bash(pnpm test billing)", c: "#9bb7e8" },
  { t: "   ✓ 37 passed  ✗ 1 failed", c: "#d9d9df" },
  { t: "● Edit(src/billing/stream.ts) +58", c: "#9bd3ad" },
  { t: "● Edit(src/billing/export.ts) +6", c: "#9bd3ad" },
];

// Dark terminal with a typing agent log and an optional amber "Usage limit reached" banner.
export const TerminalPane: React.FC<{ at?: number; banner?: boolean; bannerAt?: number; height?: number; lineEvery?: number; style?: CSSProperties }> = ({ at = 0, banner = true, bannerAt = 1, height = 520, lineEvery = 0.35, style }) => {
  const frame = useCurrentFrame();
  const a = useAt(at), b = useAt(bannerAt);
  const n = Math.min(LINES.length, 1 + Math.floor((frame - a) / (lineEvery * 30)));
  const bp = usePop(b, { damping: 13, stiffness: 220, mass: 0.7 });
  const s = shakeOffset(frame, frame >= b && frame < b + 8 ? 7 : 0, "lim");
  return (
    <Enter a={a} y={40} from={0.94} origin="50% 50%" style={wrap(style)}>
      <MacWindow width={OLD_W} height={height} radius={18} style={{ background: "#14161a" }}
        titlebar={<div style={{ height: 60, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 20px", gap: 20, background: "#202126", borderBottom: `1px solid ${A.border}` }}><TrafficLights /><div style={{ fontFamily: FONT_BODY, fontSize: 30, color: A.muted }}>api — session</div></div>}>
        <div style={{ padding: "22px 28px", fontFamily: FONT_MONO, fontSize: 32, lineHeight: 1.45, flex: 1, overflow: "hidden" }}>
          {LINES.slice(0, Math.max(0, n)).map((l, i) => <div key={i} style={{ color: l.c, whiteSpace: "pre" }}>{l.t}</div>)}
          {!(banner && frame >= b) && <div style={{ color: "#8f9099", marginTop: 6 }}>✻ Working…</div>}
        </div>
        {banner && frame >= b && (
          <div style={{ position: "absolute", left: 24, right: 24, bottom: 24, height: 96, borderRadius: 16, background: "#3d2a0d", border: "2px solid #e9b667", display: "flex", alignItems: "center", gap: 20, padding: "0 28px", fontFamily: FONT_BODY, fontSize: 38, fontWeight: 700, color: "#f6d9a5", opacity: interpolate(bp, [0, 0.5], [0, 1], clamp), transform: `translate(${s.x}px, ${interpolate(bp, [0, 1], [40, 0]) + s.y}px)` }}>
            <Icon name="alert" size={46} color="#e9b667" stroke={2} />Usage limit reached
          </div>
        )}
      </MacWindow>
    </Enter>
  );
};

const Card: React.FC<{ title: string; icon: string; children: ReactNode }> = ({ title, icon, children }) => (
  <div style={{ width: OLD_W, borderRadius: 22, background: "#23242a", border: "1px solid #44454e", boxShadow: "0 40px 100px rgba(20,26,18,0.45)", fontFamily: FONT_BODY, color: A.text }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "22px 32px", borderBottom: "1px solid #36373f", fontSize: 36, fontWeight: 700, color: A.textHi }}><Icon name={icon} size={38} color={A.muted} />{title}</div>
    <div style={{ padding: 32 }}>{children}</div>
  </div>
);
const Field: React.FC<{ label: string; value: string; caret?: boolean; mono?: boolean }> = ({ label, value, caret, mono }) => (
  <div style={{ marginBottom: 22 }}>
    <div style={{ fontSize: 30, color: A.muted, marginBottom: 8 }}>{label}</div>
    <div style={{ height: 80, borderRadius: 12, border: `1px solid ${A.input}`, background: "#1a1b1f", display: "flex", alignItems: "center", padding: "0 22px", fontSize: 38, fontFamily: mono ? FONT_MONO : FONT_BODY, color: A.textHi }}>
      {value}{caret && <span style={{ display: "inline-block", width: 3, height: 44, background: A.textHi, marginLeft: 2 }} />}
    </div>
  </div>
);
const Btn: React.FC<{ label: string; pressed?: boolean }> = ({ label, pressed }) => (
  <div style={{ display: "inline-block", padding: "18px 48px", borderRadius: 12, fontSize: 36, fontWeight: 700, background: "#e1e1e7", color: "#202126", transform: `scale(${pressed ? 0.94 : 1})`, filter: pressed ? "brightness(0.8)" : undefined }}>{label}</div>
);

// Email + password typing, then the Sign in button presses.
export const LoginForm: React.FC<{ at?: number; email?: string; style?: CSSProperties }> = ({ at = 0, email = "work@studio.dev", style }) => {
  const frame = useCurrentFrame();
  const a = useAt(at), t = frame - a;
  return (
    <Enter a={a} y={40} from={0.94} origin="50% 50%" style={wrap(style)}>
      <Card title="Sign in to your other account" icon="refresh">
        <Field label="Email" value={typed(email, frame, a + 6, 18)} caret={t < 24} />
        <Field label="Password" value={"•".repeat(Math.min(10, Math.max(0, Math.floor((t - 24) / 2.5))))} caret={t >= 24 && t < 50} />
        <Btn label="Sign in" pressed={t > 56} />
      </Card>
    </Enter>
  );
};

// "Open folder" dialog: path typing, folder list, trust prompt.
export const FolderDialog: React.FC<{ at?: number; path?: string; style?: CSSProperties }> = ({ at = 0, path = "~/code/studio/api", style }) => {
  const frame = useCurrentFrame();
  const a = useAt(at), t = frame - a;
  return (
    <Enter a={a} y={40} from={0.94} origin="50% 50%" style={wrap(style)}>
      <Card title="Open folder" icon="folder">
        <Field label="Path" value={typed(path, frame, a + 4, 20)} mono />
        {["api", "web", "mobile"].map((n, i) => (
          <div key={n} style={{ height: 64, display: "flex", alignItems: "center", gap: 16, fontSize: 36, color: i === 0 ? A.textHi : A.muted, background: i === 0 && t > 22 ? "#2f3038" : "transparent", borderRadius: 10, padding: "0 16px" }}><Icon name="folder" size={34} />{n}</div>
        ))}
        {t > 36 && <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 24, fontSize: 32, color: A.amber }}>Trust this folder?<Btn label="Yes, trust" pressed={t > 46} /></div>}
      </Card>
    </Enter>
  );
};

const TAB_NAMES = ["api — session", "login", "accounts", "folder", "settings", "api — new", "session", "usage"];
// A cascade of `count` stacked window cards (the tab pile): each new one lands 0.18 s after the last, 64 px lower.
export const TabPile: React.FC<{ count: number; at?: number; style?: CSSProperties }> = ({ count, at = 0, style }) => {
  const a = useAt(at);
  return (
    <div style={{ position: "relative", width: OLD_W, height: 120 + count * 64, ...style }}>
      {Array.from({ length: count }).map((_, i) => (
        <Enter key={i} a={a + Math.round(i * 5.4)} y={30} from={0.96} origin="50% 0%" style={{ position: "absolute", left: 0, top: i * 64, width: OLD_W }}>
          <div style={{ height: 120, borderRadius: "18px 18px 0 0", background: i === count - 1 ? "#202126" : "#2a2b31", border: "1px solid #44454e", borderBottom: "none", boxShadow: "0 -6px 24px rgba(20,26,18,0.25)", display: "flex", alignItems: "flex-start", paddingTop: 14, gap: 18, paddingLeft: 24, fontFamily: FONT_BODY, fontSize: 32, color: i === count - 1 ? A.textHi : A.muted }}>
            <TrafficLights />{TAB_NAMES[i % TAB_NAMES.length]}
          </div>
        </Enter>
      ))}
    </div>
  );
};
