import React from "react";
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, clamp } from "./theme";
import { FONT_DISPLAY, FONT_MONO } from "./fonts";
import { Words } from "./text";
import { Dust, Glow } from "./fx";
import { CUE, T } from "./timeline";

// Phone chapter. Companion UI follows packages/app/tests/fixtures/companion-dashboard.tsx + apps/web/public/screenshots/companion.png
// (project groups, status dots, "Unread reply"), approval wording from packages/app/src/desktop/AgentRequest.tsx ("Allow once",
// "Allowed once · Waiting for agent…"), recap from DaySummaries ("generated HH:MM by <provider>").

const E = {
  flag: 91.3, tap: 92.5, open: 92.9, typeStart: 93.7, typeEnd: 94.4, send: 94.5, card: 94.85, approve: CUE.approve,
  result: 96.1, done: 96.8, androidIn: CUE.phoneIn + 1.5,
};
const REPLY = "20 per page";

const P = {
  bg: "#18191c", panel: "#202226", line: "#2c2e33", text: "#ececec", muted: "#8d9099",
  slateDim: "#5d6068", green: "#7bc89a", amber: "#d6963e", purple: "#9b8cf6", teal: "#5fbf8a", gold: "#d6a24a",
};

type Row = { title: string; group: number; status: string };
const GROUPS = [{ name: "Website", c: P.purple }, { name: "Mobile app", c: P.teal }, { name: "API", c: P.gold }];
const ROWS: Row[] = [
  { title: "Polish the pricing page", group: 0, status: "Running" },
  { title: "Fix navigation on tablets", group: 0, status: "Unread reply" },
  { title: "Add offline support", group: 1, status: "Running" },
  { title: "Ship the new onboarding", group: 1, status: "Unread reply" },
  { title: "Speed up search", group: 2, status: "Unread reply" },
  { title: "Add pagination", group: 2, status: "Running" }, // the thread that flags a question
];
const FLAGGED = 5;

type Phase = "running" | "needs" | "allowed" | "done";
const phaseAt = (t: number): Phase => (t < E.flag ? "running" : t < E.approve ? "needs" : t < E.done ? "allowed" : "done");

const FolderIcon: React.FC<{ c: string }> = ({ c }) => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
);

/** Threads list (the companion Home/Threads screen). */
const ThreadsList: React.FC<{ t: number; frame: number; android?: boolean }> = ({ t, frame, android }) => {
  const phase = phaseAt(t);
  const pulse = 0.5 + 0.5 * Math.sin(frame / 5);
  const rows = GROUPS.map((g, gi) => ({ g, items: ROWS.map((r, i) => ({ r, i })).filter((x) => x.r.group === gi) }));
  return (
    <div style={{ position: "absolute", inset: 0, background: P.bg, color: P.text, fontFamily: FONT }}>
      <div style={{ height: 54 }} />
      <div style={{ display: "flex", alignItems: "center", padding: "0 22px", height: 66, gap: 12 }}>
        <span style={{ fontSize: 21, fontWeight: 800 }}>freddai</span><span style={{ fontSize: 28, fontWeight: 700 }}>Threads</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 20, alignItems: "center", color: P.muted, fontSize: 30 }}>
          <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={P.green} strokeWidth={2}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>+
        </span>
      </div>
      <div style={{ margin: "8px 16px 0", height: 48, borderRadius: 10, background: P.panel, border: `1px solid ${P.line}`, display: "flex", alignItems: "center", padding: "0 16px", fontSize: 19, color: P.muted }}>Search projects and threads</div>
      <div style={{ display: "flex", gap: 12, margin: "12px 16px 0" }}>
        {["All projects", "All threads"].map((l) => <div key={l} style={{ height: 40, borderRadius: 10, border: `1px solid ${P.line}`, background: P.panel, padding: "0 16px", fontSize: 17, display: "flex", alignItems: "center" }}>{l} ▾</div>)}
      </div>
      <div style={{ marginTop: 14 }}>
        {rows.map(({ g, items }) => (
          <div key={g.name}>
            <div style={{ height: 44, display: "flex", alignItems: "center", gap: 10, padding: "0 22px", fontSize: 18, fontWeight: 700 }}><FolderIcon c={g.c} />{g.name}<span style={{ marginLeft: "auto", color: P.muted, fontSize: 26, fontWeight: 400 }}>+</span></div>
            {items.map(({ r, i }) => {
              const flagged = i === FLAGGED;
              const st = flagged ? (phase === "running" ? "Running" : phase === "needs" ? "Needs you" : phase === "allowed" ? "Running" : "Done") : r.status;
              const dot = st === "Running" ? P.green : st === "Done" ? P.slateDim : P.amber;
              const hot = flagged && phase === "needs";
              return (
                <div key={r.title} style={{ height: 68, display: "flex", alignItems: "center", padding: "0 22px", gap: 14, borderTop: `1px solid ${P.line}`, background: hot ? `rgba(214,150,62,${0.10 + 0.08 * pulse})` : "transparent", opacity: flagged && phase === "done" ? 0.6 : 1 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 6, background: dot, boxShadow: hot ? `0 0 ${10 + 10 * pulse}px ${P.amber}` : st === "Running" ? `0 0 ${4 + 6 * pulse}px ${P.green}` : "none" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 21, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div>
                    <div style={{ fontSize: 16, color: hot ? P.amber : P.muted, fontWeight: hot ? 700 : 400 }}>{st}</div>
                  </div>
                  <div style={{ color: P.muted, fontSize: 16 }}>Nov 4</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {android && <div style={{ position: "absolute", right: 22, bottom: 40, width: 66, height: 66, borderRadius: 20, background: "#3c4a35", color: "#d6e8bf", display: "grid", placeItems: "center", fontSize: 38, boxShadow: "0 8px 20px rgba(0,0,0,0.5)" }}>+</div>}
    </div>
  );
};

/** One thread: question, reply, approval, result. */
const ThreadView: React.FC<{ t: number; frame: number; fps: number }> = ({ t, frame, fps }) => {
  const typed = Math.max(0, Math.min(REPLY.length, Math.floor(((t - E.typeStart) / (E.typeEnd - E.typeStart)) * REPLY.length)));
  const sent = t >= E.send;
  const phase = phaseAt(t);
  const spr = (at: number) => spring({ frame: Math.round((t - at) * fps), fps, config: { damping: 16, stiffness: 190, mass: 0.8 } });
  const bubble = (txt: string, you: boolean, k = 1): React.ReactNode => (
    <div style={{ alignSelf: you ? "flex-end" : "flex-start", maxWidth: 340, padding: "14px 18px", borderRadius: 18, fontSize: 20, lineHeight: 1.35, background: you ? "#34373d" : "transparent", border: you ? "none" : `1px solid ${P.line}`, opacity: k, transform: `translateY(${(1 - k) * 16}px)` }}>{txt}</div>
  );
  const status = phase === "needs" ? "Needs you" : phase === "done" ? "Done" : "Running";
  const stc = phase === "needs" ? P.amber : phase === "done" ? "#6ff0a0" : P.green;
  const cardK = spr(E.card);
  const resK = spr(E.result);
  return (
    <div style={{ position: "absolute", inset: 0, background: P.bg, color: P.text, fontFamily: FONT }}>
      <div style={{ height: 54 }} />
      <div style={{ height: 66, display: "flex", alignItems: "center", padding: "0 20px", gap: 12, borderBottom: `1px solid ${P.line}` }}>
        <span style={{ fontSize: 34, color: P.muted }}>‹</span>
        <span style={{ fontSize: 23, fontWeight: 700 }}>Add pagination</span>
        <span style={{ marginLeft: "auto", fontSize: 16, fontWeight: 700, color: "#1b1a24", background: stc, borderRadius: 999, padding: "5px 12px" }}>{status}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "20px 18px" }}>
        {bubble("Add pagination to the list endpoint.", true)}
        {bubble("Cursor pagination is in. How many items per page should it return: 20 or 50?", false)}
        {sent && bubble(REPLY, true, spr(E.send))}
        {t >= E.approve + 0.4 ? (
          <div style={{ fontSize: 17, color: P.muted, padding: "4px 6px", opacity: spr(E.approve + 0.4) }}>Allowed once · Waiting for agent…</div>
        ) : null}
        {phase === "done" && bubble("Done. Pagination is in and the tests pass.", false, resK)}
      </div>
      {/* approval card (Permission in AgentRequest.tsx) */}
      {t >= E.card && t < E.approve + 0.4 && (
        <div style={{ position: "absolute", left: 16, right: 16, bottom: 104, borderRadius: 20, background: P.panel, border: `1.5px solid ${P.amber}`, padding: 20, opacity: cardK, transform: `translateY(${(1 - cardK) * 60}px)` }}>
          <div style={{ fontSize: 17, color: P.amber, fontWeight: 700, letterSpacing: 0.4 }}>AGENT REQUEST</div>
          <div style={{ fontSize: 21, fontWeight: 650, marginTop: 8 }}>Run a command</div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 19, color: "#cfd3c4", background: "#14151a", borderRadius: 10, padding: "10px 14px", marginTop: 10 }}>npm test</div>
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <div style={{ flex: 1, textAlign: "center", padding: "14px 0", borderRadius: 12, fontSize: 20, fontWeight: 700, color: "#17210f", background: t >= E.approve ? "#8fd6a8" : "#b9c99a", transform: t >= E.approve && t < E.approve + 0.15 ? "scale(0.96)" : "scale(1)" }}>Allow once</div>
            <div style={{ flex: 1, textAlign: "center", padding: "14px 0", borderRadius: 12, fontSize: 20, fontWeight: 600, border: `1px solid ${P.line}`, color: P.muted }}>Decline</div>
          </div>
        </div>
      )}
      {/* composer */}
      <div style={{ position: "absolute", left: 16, right: 16, bottom: 28, height: 62, borderRadius: 31, background: P.panel, border: `1px solid ${P.line}`, display: "flex", alignItems: "center", padding: "0 10px 0 22px", fontSize: 20 }}>
        <span style={{ flex: 1, color: sent || typed === 0 ? P.muted : P.text }}>{sent ? "Reply" : typed ? REPLY.slice(0, typed) : "Reply"}{!sent && typed > 0 && Math.floor(frame / 12) % 2 === 0 ? "|" : ""}</span>
        <div style={{ width: 44, height: 44, borderRadius: 22, background: typed > 0 && !sent ? "#b9c99a" : "#34373d", display: "grid", placeItems: "center", color: "#17210f", fontSize: 24, fontWeight: 800 }}>↑</div>
      </div>
    </div>
  );
};

/** Home with the day's recap card. */
const RecapHome: React.FC<{ k: number }> = ({ k }) => (
  <div style={{ position: "absolute", inset: 0, background: P.bg, color: P.text, fontFamily: FONT, transform: `translateY(${(1 - k) * 120}px)`, opacity: Math.min(1, k * 2) }}>
    <div style={{ height: 54 }} />
    <div style={{ height: 66, display: "flex", alignItems: "center", padding: "0 22px", gap: 12 }}>
      <span style={{ fontSize: 21, fontWeight: 800 }}>freddai</span><span style={{ fontSize: 28, fontWeight: 700 }}>Home</span>
    </div>
    <div style={{ margin: "10px 18px 0", borderRadius: 22, background: P.panel, border: `1px solid ${P.line}`, padding: "24px 24px 30px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 30, fontWeight: 800 }}>Today</span>
        <span style={{ fontSize: 19, color: P.muted, whiteSpace: "nowrap" }}>4 threads</span>
      </div>
      <div style={{ fontSize: 15, color: P.muted, marginTop: 4 }}>generated 5:42 PM by codex</div>
      <div style={{ marginTop: 22, fontSize: 19, fontWeight: 700, color: "#9ad1b0", letterSpacing: 0.5 }}>SHIPPED</div>
      {["Pagination for the API list endpoint", "Pricing page polish", "Offline support for the mobile app"].map((s) => (
        <div key={s} style={{ display: "flex", gap: 14, marginTop: 14, fontSize: 24, lineHeight: 1.3 }}><span style={{ color: P.green }}>✓</span>{s}</div>
      ))}
      <div style={{ marginTop: 30, fontSize: 19, fontWeight: 700, color: P.amber, letterSpacing: 0.5 }}>STILL NEEDS YOU</div>
      <div style={{ display: "flex", gap: 14, marginTop: 14, fontSize: 24, lineHeight: 1.3 }}><span style={{ color: P.amber }}>•</span>Onboarding flow is ready for your review</div>
    </div>
    <div style={{ position: "absolute", left: "50%", bottom: 50, marginLeft: -44, width: 88, height: 88, borderRadius: 44, background: P.panel, border: `1.5px solid ${P.line}`, display: "grid", placeItems: "center" }}>
      <svg width={38} height={38} viewBox="0 0 24 24" fill="none" stroke={P.green} strokeWidth={2} strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
    </div>
  </div>
);

const Finger: React.FC<{ x: number; y: number; at: number; t: number }> = ({ x, y, at, t }) => {
  const d = t - at;
  if (d < -0.25 || d > 0.55) return null;
  const grow = interpolate(d, [-0.25, 0, 0.5], [0.4, 1, 1.6], clamp);
  const o = interpolate(d, [-0.25, -0.1, 0.2, 0.55], [0, 0.85, 0.7, 0], clamp);
  return <div style={{ position: "absolute", left: x - 34, top: y - 34, width: 68, height: 68, borderRadius: 34, background: "rgba(255,255,255,0.35)", border: "3px solid rgba(255,255,255,0.7)", transform: `scale(${grow})`, opacity: o, pointerEvents: "none", zIndex: 20 }} />;
};

const SCREEN = { w: 430, h: 860 };
const PhoneFrame: React.FC<{ android?: boolean; children: React.ReactNode }> = ({ android, children }) => (
  <div style={{ width: SCREEN.w + 28, height: SCREEN.h + 28, borderRadius: android ? 50 : 76, background: "#0b0b0d", padding: 14, boxShadow: "0 50px 120px rgba(0,0,0,0.6), inset 0 0 0 2px #3a3b40", position: "relative" }}>
    <div style={{ width: SCREEN.w, height: SCREEN.h, borderRadius: android ? 38 : 62, overflow: "hidden", position: "relative", background: P.bg }}>
      {children}
      {/* status bar */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 54, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 34px", color: P.text, fontFamily: FONT, fontSize: 17, fontWeight: 700, zIndex: 10 }}>
        <span>9:41</span><span style={{ opacity: 0.85 }}>{android ? "▲ ▮" : "●●●"}</span>
      </div>
      {android ? <div style={{ position: "absolute", left: "50%", top: 14, marginLeft: -9, width: 18, height: 18, borderRadius: 9, background: "#000", zIndex: 11 }} /> : <div style={{ position: "absolute", left: "50%", top: 12, marginLeft: -60, width: 120, height: 34, borderRadius: 17, background: "#000", zIndex: 11 }} />}
      <div style={{ position: "absolute", left: "50%", bottom: 9, marginLeft: -70, width: 140, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.5)", zIndex: 11 }} />
    </div>
  </div>
);

/** Laptop with the Mac thread: dots pulse while the agent works; it waits on the question, then moves on after the phone approves. */
const Laptop: React.FC<{ t: number; frame: number }> = ({ t, frame }) => {
  const phase = phaseAt(t);
  const pulse = 0.5 + 0.5 * Math.sin(frame / 5);
  const line = (txt: string, c = "#cfd3c4", mono = true) => <div style={{ fontFamily: mono ? FONT_MONO : FONT, fontSize: 25, color: c, lineHeight: 1.45 }}>{txt}</div>;
  const dots = (c: string) => <span style={{ display: "inline-flex", gap: 8, marginLeft: 12 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 11, height: 11, borderRadius: 6, background: c, opacity: 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(frame / 4 - i * 1.1)) }} />)}</span>;
  const stc = phase === "needs" ? P.amber : phase === "done" ? "#6ff0a0" : P.green;
  const stText = phase === "needs" ? "Needs you" : phase === "done" ? "Done" : "Working";
  return (
    <div style={{ width: 1000, height: 580, background: C.bgDark, borderRadius: 10, overflow: "hidden", fontFamily: FONT, color: C.textDark, position: "relative" }}>
      <div style={{ height: 56, background: C.bgDark2, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", padding: "0 20px", gap: 10 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />)}
        <span style={{ marginLeft: 20, fontSize: 24, fontWeight: 700 }}>Add pagination</span>
        <span style={{ marginLeft: 12, fontSize: 20, color: C.slateLight }}>API</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", fontSize: 21, fontWeight: 700, color: stc }}>{stText}{phase === "done" ? <span style={{ marginLeft: 8 }}>✓</span> : phase === "needs" ? null : dots(stc)}</span>
      </div>
      <div style={{ padding: "26px 34px", display: "grid", gap: 10 }}>
        {line("Add pagination to the list endpoint.", C.textDark, false)}
        {line("$ edit api/list.ts")}
        {line("$ edit api/list.test.ts")}
        {t >= E.flag && <div style={{ marginTop: 8, padding: "14px 20px", border: `1.5px solid ${P.amber}`, borderRadius: 14, fontSize: 25, color: C.textDark, lineHeight: 1.35, opacity: interpolate(t, [E.flag, E.flag + 0.3], [0, 1], clamp) }}>How many items per page should it return: 20 or 50?</div>}
        {t >= E.send && <div style={{ alignSelf: "end", justifySelf: "end", padding: "12px 20px", borderRadius: 14, background: C.bgDark2, fontSize: 25, opacity: interpolate(t, [E.send + 0.15, E.send + 0.45], [0, 1], clamp) }}>{REPLY}</div>}
        {t >= E.card && t < E.approve && line("waiting for approval · npm test", P.amber)}
        {t >= E.approve && line("$ npm test", "#cfd3c4")}
        {t >= E.result - 0.4 && line("✓ tests passed", "#7bd88f")}
        {phase === "done" && <div style={{ fontSize: 25, color: C.textDark, lineHeight: 1.35 }}>Done. Pagination is in and the tests pass.</div>}
      </div>
    </div>
  );
};

export const PhoneBody: React.FC<{ t: number }> = ({ t }) => {
  const frame = useCurrentFrame(), { fps, width, height } = useVideoConfig();
  const f = (abs: number) => Math.round((abs - T.phone) * fps);
  const sp = (abs: number, cfg = { damping: 17, stiffness: 140, mass: 0.9 }) => spring({ frame: frame - f(abs), fps, config: cfg });
  const enter = sp(T.phone + 0.05, { damping: 20, stiffness: 110, mass: 1 });

  // dusk
  const dusk = interpolate(t, [T.phone, CUE.deskOptional + 1.5], [0.4, 1], clamp);
  const sloganIn = f(CUE.slogan2);
  const sloganOut = interpolate(t, [CUE.phoneIn - 0.5, CUE.phoneIn + 0.2], [1, 0], clamp);

  // layout progress
  const toPhones = sp(CUE.phoneIn - 0.1, { damping: 18, stiffness: 120, mass: 1 });
  const iphoneK = sp(CUE.phoneIn + 0.1, { damping: 16, stiffness: 120, mass: 1 });
  const andK = sp(E.androidIn, { damping: 16, stiffness: 120, mass: 1 });
  const recap = sp(CUE.recap, { damping: 18, stiffness: 130, mass: 0.9 });
  const recapScale = sp(CUE.recap - 0.2, { damping: 20, stiffness: 100, mass: 1 });

  const lapScale = interpolate(toPhones, [0, 1], [1, 0.7]);
  const lapLeft = interpolate(toPhones, [0, 1], [436, 20]);
  const lapTop = interpolate(toPhones, [0, 1], [250, 320]);
  const lapOut = interpolate(recapScale, [0, 1], [1, 0]);

  // iPhone screen transitions
  const open = sp(E.open, { damping: 20, stiffness: 190, mass: 0.8 });
  const homeK = recap;
  const iphoneX = interpolate(recapScale, [0, 1], [0, 0]);
  const phoneRowY = 54 + 66 + 8 + 48 + 12 + 40 + 14 + 44 * 3 + 68 * 5 + 34;

  const stars = Array.from({ length: 46 }).map((_, i) => ({ x: random(`sx${i}`) * width, y: random(`sy${i}`) * 520, r: 1 + random(`sr${i}`) * 2, ph: random(`sp${i}`) * 6 }));

  return (
    <AbsoluteFill style={{ background: "#10131a", opacity: Math.min(1, enter * 1.6) }}>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, #12161f 0%, #1d2135 38%, #3b2f3d 68%, #5a3f35 88%, #3c2b25 100%)", opacity: dusk }} />
      {stars.map((s, i) => <div key={i} style={{ position: "absolute", left: s.x, top: s.y, width: s.r, height: s.r, borderRadius: "50%", background: "#fff", opacity: dusk * (0.25 + 0.4 * Math.sin(frame / 20 + s.ph) ** 2) }} />)}
      <Glow x={960} y={1000} color="#c7893c" size={1500} opacity={0.35 * dusk} drift={1} />
      <Dust count={26} color="#ffd9a0" opacity={0.35} />
      {/* desk edge */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 150, background: "linear-gradient(180deg, #2c2420 0%, #1b1613 100%)", borderTop: "2px solid #4a3a30", opacity: 1 - toPhones * 0.7 }} />

      {/* slogan */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 96, display: "flex", justifyContent: "center", opacity: sloganOut }}>
        {t >= CUE.slogan2 - 0.05 && <Words text="From your desk or your phone." delay={sloganIn} size={96} color={C.textDark} family={FONT_DISPLAY} style={{ textShadow: "0 10px 50px rgba(0,0,0,0.5)" }} />}
      </div>

      {/* laptop */}
      <div style={{ position: "absolute", left: lapLeft, top: lapTop, transform: `scale(${lapScale})`, transformOrigin: "0 0", opacity: lapOut, filter: `brightness(${1 - 0.0 * toPhones})` }}>
        <div style={{ width: 1048, padding: 24, background: "#0d0d10", borderRadius: 24, boxShadow: "0 40px 100px rgba(0,0,0,0.55), inset 0 0 0 2px #34353a", transform: `translateY(${(1 - sp(T.phone + 0.2)) * 40}px)` }}>
          <Laptop t={t} frame={frame} />
        </div>
        <div style={{ width: 1240, height: 22, marginLeft: -96, background: "linear-gradient(180deg,#3b3c42,#1f2024)", borderRadius: "0 0 40px 40px", boxShadow: "0 20px 40px rgba(0,0,0,0.5)" }} />
      </div>

      {/* iPhone */}
      <div style={{ position: "absolute", left: interpolate(recapScale, [0, 1], [830, 1920 / 2 - 229]), top: interpolate(iphoneK, [0, 1], [1200, 96]) - recapScale * 12, transform: `scale(${1 + recapScale * 0.1})`, transformOrigin: "50% 0", opacity: Math.min(1, iphoneK * 1.5) }}>
        <PhoneFrame>
          <ThreadsList t={t} frame={frame} />
          <div style={{ position: "absolute", inset: 0, transform: `translateX(${(1 - open) * 100}%)` }}><ThreadView t={t} frame={frame} fps={fps} /></div>
          {homeK > 0.001 && <RecapHome k={homeK} />}
          <Finger x={215} y={phoneRowY} at={E.tap} t={t} />
          <Finger x={122} y={708} at={E.approve - 0.02} t={t} />
        </PhoneFrame>
      </div>

      {/* Android */}
      <div style={{ position: "absolute", left: 1330, top: interpolate(andK, [0, 1], [1250, 150]), transform: `scale(0.9)`, transformOrigin: "0 0", opacity: Math.min(1, andK * 1.5) * (1 - recapScale) }}>
        <PhoneFrame android>
          <ThreadsList t={t} frame={frame} android />
        </PhoneFrame>
      </div>
    </AbsoluteFill>
  );
};
