import React from "react";
import { Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { LoginForm } from "./OldWay";
import { V2_TIMELINES } from "./timelinesV2";
import { A, ACCOUNTS, Icon, Pointer } from "../ui";
import type { Account } from "../ui";
import { FONT_BODY } from "../fonts";
import { clamp } from "../theme";

const tl = V2_TIMELINES.twoacc;
const f = (s: number) => Math.round(s * 30);
const WIPE_END = f(tl.cues.turn + TURN_WIPE_SECONDS);
const DEMO = f(tl.cues.demo);
const END = f(tl.cues.endcard);
const L = (s: number) => f(s) - DEMO;
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: e });

// ---------------- old way: a pile of login forms ----------------
const FormSlot: React.FC<{ at: number; top: number; dx: number; rot: number; email: string }> = ({ at, top, dx, rot, email }) => (
  <div style={{ position: "absolute", left: 70 + dx, top, width: 940, height: 340, overflow: "hidden", transform: `rotate(${rot}deg)`, transformOrigin: "50% 0",
    WebkitMaskImage: "linear-gradient(#000 78%, transparent)", maskImage: "linear-gradient(#000 78%, transparent)" }}>
    <LoginForm at={at} email={email} />
  </div>
);

const Pile: React.FC = () => (
  <>
    <FormSlot at={0} top={590} dx={0} rot={0} email="work@studio.dev" />
    <FormSlot at={4.88} top={660} dx={-8} rot={-1.2} email="second@studio.dev" />
    <FormSlot at={5.95} top={730} dx={10} rot={1.4} email="third@studio.dev" />
    <FormSlot at={8.54} top={760} dx={-12} rot={-1.8} email="main@studio.dev" />
    <FormSlot at={9.9} top={790} dx={8} rot={1.1} email="work@studio.dev" />
  </>
);

// ---------------- demo: provider cards, two accounts each ----------------
const SC = 1.8, CW = 520, GAP = 16;
const cardH = (n: number) => 22 + 84 - 22 + 56 * n + 22; // header block 84 incl padding, rows, bottom pad
const Card: React.FC<{ provider: Account["provider"]; accounts: Account[]; defId: string; defAt: number; tickAt: number; glow: number; top: number }> = ({ provider, accounts, defId, defAt, tickAt, glow, top }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const color = accounts[0].color;
  const tagP = spring({ frame: frame - defAt, fps, config: { damping: 13, stiffness: 220, mass: 0.7 } });
  return (
    <div style={{ position: "absolute", left: 0, top, width: CW, fontFamily: FONT_BODY }}>
      <div style={{ border: `${1 + 2 * glow}px solid ${glow > 0.05 ? color : A.border}`, borderRadius: 14, background: A.card, padding: 22, boxSizing: "border-box", height: cardH(accounts.length), boxShadow: `0 0 ${40 * glow}px ${color}55` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, height: 46 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: `${color}26`, border: `1px solid ${color}77`, display: "grid", placeItems: "center", color, fontSize: 24, fontWeight: 800 }}>{accounts[0].glyph}</div>
          <div><div style={{ fontSize: 28, fontWeight: 700, color: A.textHi, lineHeight: 1.1 }}>{provider}</div><div style={{ fontSize: 19, color: A.muted }}>{accounts.length} account{accounts.length > 1 ? "s" : ""} connected</div></div>
        </div>
        {accounts.map((a, i) => {
          const isDef = a.id === defId;
          const justSet = defAt > 0 && isDef && accounts.length > 1 && frame >= defAt;
          const flash = justSet ? Math.max(0, 1 - (frame - defAt) / 24) : 0;
          const tick = ease(frame, tickAt + i * 9, tickAt + i * 9 + 8);
          return (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, height: 56, borderTop: `1px solid ${A.border}`, fontSize: 22, color: A.text, background: `rgba(127,208,160,${0.14 * flash})`, margin: "0 -8px", padding: "0 8px", boxSizing: "border-box" }}>
              <span style={{ width: 12, height: 12, borderRadius: 6, background: a.color }} />
              <span style={{ fontWeight: 600 }}>{a.label}</span>
              {isDef && <span style={{ fontSize: 18, padding: "2px 10px", borderRadius: 6, border: `1px solid ${A.input}`, color: A.textHi, transform: `scale(${justSet ? 0.8 + 0.2 * tagP : 1})`, opacity: justSet ? Math.min(1, tagP * 2) : 1 }}>Default</span>}
              <span style={{ marginLeft: "auto", fontSize: 20, color: A.done, display: "flex", alignItems: "center", gap: 6, opacity: tick, transform: `scale(${0.85 + 0.15 * tick})` }}><Icon name="check" size={20} />Signed in</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const claude = [ACCOUNTS[2], ACCOUNTS[3]];
  const codex = [ACCOUNTS[0], ACCOUNTS[1]];
  const gemini = [ACCOUNTS[4]];
  const grok = [ACCOUNTS[5]];
  const T = [0, cardH(2) + GAP, 2 * cardH(2) + 2 * GAP, 2 * cardH(2) + cardH(1) + 3 * GAP];
  const pulse = (a: number, b: number) => Math.sin(Math.PI * ease(frame, L(a), L(b)));
  // scroll: down to Gemini + Grok while the names are read, back to the top for the Default beat
  const off = ease(frame, L(16.0), L(16.5), 0, 770) - ease(frame, L(17.75), L(18.2), 0, 770);
  const defClaude = frame >= L(18.95) ? "claude-work" : "claude-max";
  const defCodex = frame >= L(20.45) ? "codex-work" : "codex-personal";
  return (
    <div style={{ position: "absolute", left: 72, top: 190, width: 936, height: 880, overflow: "hidden",
      WebkitMaskImage: "linear-gradient(transparent, #000 36px, #000 850px, transparent)", maskImage: "linear-gradient(transparent, #000 36px, #000 850px, transparent)" }}>
      <div style={{ position: "absolute", left: 0, top: 44, width: CW, transform: `translateY(${-off}px) scale(${SC})`, transformOrigin: "0 0" }}>
        {frame >= L(11.9) && <PopCard at={L(11.9)}><Card provider="Claude Code" accounts={claude} defId={defClaude} defAt={defClaude === "claude-work" ? L(18.95) : 0} tickAt={L(12.4)} glow={pulse(15.05, 15.75)} top={T[0]} /></PopCard>}
        {frame >= L(13.2) && <PopCard at={L(13.2)}><Card provider="Codex" accounts={codex} defId={defCodex} defAt={defCodex === "codex-work" ? L(20.45) : 0} tickAt={L(13.7)} glow={pulse(15.7, 16.4)} top={T[1]} /></PopCard>}
        {frame >= L(16.2) && <PopCard at={L(16.2)}><Card provider="Gemini" accounts={gemini} defId="gemini" defAt={0} tickAt={L(16.5)} glow={pulse(16.5, 17.2)} top={T[2]} /></PopCard>}
        {frame >= L(16.4) && <PopCard at={L(16.4)}><Card provider="Grok" accounts={grok} defId="grok" defAt={0} tickAt={L(16.7)} glow={pulse(17.25, 17.9)} top={T[3]} /></PopCard>}
        {frame < L(21.4) && <Pointer scale={0.8} keys={[
          { x: 330, y: 168, at: L(18.55), click: L(18.9), leave: L(19.3) },
          { x: 330, y: T[1] + 168, at: L(20.05), click: L(20.4), leave: L(20.9) },
        ]} />}
      </div>
    </div>
  );
};
// Pop wrapper that keeps absolute children positioned (children carry their own top)
const PopCard: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - at, fps, config: { damping: 15, stiffness: 190, mass: 0.8 } });
  return <div style={{ opacity: interpolate(p, [0, 0.5], [0, 1], clamp), transform: `translateY(${interpolate(p, [0, 1], [26, 0])}px)` }}>{children}</div>;
};

export const V2Short14TwoAcc: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={WIPE_END}>
      <Pile />
      <HookTitle lines={["One account is", "never enough."]} accent="never" />
    </Sequence>
    <Sequence from={DEMO} durationInFrames={END - DEMO + 30}>
      <Demo />
    </Sequence>
    <Turn at={tl.cues.turn} />
  </ShortShell>
);
