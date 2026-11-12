import React from "react";
import { Easing, Sequence, interpolate, useCurrentFrame } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { SHORT_TIMELINES } from "./timelines";
import { A, ACCOUNTS, Icon, Pop, ProjectGroup, ThreadRow } from "../ui";
import { FONT_BODY } from "../fonts";
import { clamp } from "../theme";

const tl = SHORT_TIMELINES.thousand;
const f = (s: number) => Math.round(s * 30);
const TURN = f(tl.cues.turn);
const WIPE_END = f(tl.cues.turn + TURN_WIPE_SECONDS);
const DEMO = f(tl.cues.demo);
const END = f(tl.cues.endcard);
const ease = (frame: number, a: number, b: number, from = 0, to = 1, e = Easing.inOut(Easing.cubic)) =>
  interpolate(frame, [a, b], [from, to], { ...clamp, easing: e });

// ---------------- pain: a generic chat list nobody can search ----------------
const VERBS = ["Fix", "Refactor", "Debug", "Add", "Update", "Migrate", "Review", "Write tests for"];
const THINGS = ["login redirect", "invoice export", "cache layer", "pricing page", "webhook retry", "dark mode toggle", "CSV importer", "rate limiter", "search index", "email templates", "auth middleware"];
const TITLES = Array.from({ length: 44 }, (_, i) => `${VERBS[(i * 3) % VERBS.length]} ${THINGS[(i * 5 + 2) % THINGS.length]}`);
const ROW_H = 66, HEAD_H = 104, PANEL_H = 520, PANEL_TOP = 540;
const MAX_OFF = TITLES.length * ROW_H - (PANEL_H - HEAD_H);
const QUERY = "invoice export";

const scrollAt = (fr: number) => {
  if (fr < 8) return 0;
  if (fr < 72) return ease(fr, 8, 72, 0, 2500);
  if (fr < 120) return ease(fr, 72, 120, 2500, 300);
  if (fr < 152) return ease(fr, 120, 152, 300, 1900);
  if (fr < 214) return 1900;
  return 0;
};

const PainList: React.FC = () => {
  const frame = useCurrentFrame();
  const off = Math.min(MAX_OFF, scrollAt(frame));
  const vel = Math.abs(scrollAt(frame) - scrollAt(frame - 1));
  const typedQ = frame < 158 || frame >= 214 ? "" : QUERY.slice(0, Math.min(QUERY.length, Math.floor((frame - 158) / 2)));
  const searching = frame >= 152 && frame < 214;
  const noRes = frame >= 192 && frame < 214;
  const snap = frame >= 214 ? ease(frame, 214, 224, 0.94, 1, Easing.out(Easing.back(2))) : 1;
  const thumbH = 70;
  const thumbY = HEAD_H + 10 + (off / MAX_OFF) * (PANEL_H - HEAD_H - thumbH - 20);
  return (
    <div style={{ position: "absolute", left: 60, top: PANEL_TOP, width: 960, height: PANEL_H, borderRadius: 28, background: "#202126", border: "1px solid #3a3b44", boxShadow: "0 30px 80px rgba(20,26,18,0.35)", overflow: "hidden", fontFamily: FONT_BODY }}>
      <div style={{ height: HEAD_H, display: "flex", alignItems: "center", padding: "0 28px", background: "#26272d", borderBottom: "1px solid #3a3b44" }}>
        <div style={{ flex: 1, height: 68, borderRadius: 14, border: `2px solid ${searching ? A.blue : "#4a4b55"}`, background: "#18191c", display: "flex", alignItems: "center", gap: 16, padding: "0 20px", fontSize: 36, color: typedQ ? A.textHi : A.muted }}>
          <Icon name="search" size={34} color={A.muted} />
          <span>{typedQ || "Search chats"}{searching && frame % 16 < 9 ? "|" : ""}</span>
          {frame < 152 && <span style={{ marginLeft: "auto", fontSize: 32, color: A.subtle }}>1,048 chats</span>}
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: HEAD_H, bottom: 0, overflow: "hidden" }}>
        {noRes ? (
          <div style={{ height: "100%", display: "grid", placeItems: "center", fontSize: 46, fontWeight: 600, color: A.muted }}>No results</div>
        ) : (
          <div style={{ transform: `translateY(${-off}px) scale(${snap})`, transformOrigin: "50% 0", filter: vel > 20 ? `blur(${Math.min(2.5, vel / 18)}px)` : undefined }}>
            {TITLES.map((t, i) => (
              <div key={i} style={{ height: ROW_H, display: "flex", alignItems: "center", padding: "0 32px", fontSize: 36, fontWeight: 500, color: "#b9bac3", borderBottom: "1px solid #2d2e35", whiteSpace: "nowrap" }}>{t}</div>
            ))}
          </div>
        )}
        {!noRes && <div style={{ position: "absolute", right: 8, top: thumbY - HEAD_H, width: 8, height: thumbH, borderRadius: 4, background: "#5a5b66" }} />}
      </div>
    </div>
  );
};

// ---------------- demo: threads grouped by project, live on top ----------------
const GROUPS = [
  { name: "Website", color: "#9a86e8", done: "Update pricing page copy", live: "Fix checkout redirect", acc: ACCOUNTS[0] },
  { name: "Mobile app", color: "#6fc2a0", done: "Ship v2.3 release notes", live: "Push notification retry", acc: ACCOUNTS[2] },
  { name: "API", color: "#e0a458", done: "Migrate invoices table", live: "Stream invoice export", acc: ACCOUNTS[1] },
];
const SLOT = 60;
const SCALE0 = 1.75, SCALE1 = 1.95;

const Demo: React.FC = () => {
  const frame = useCurrentFrame(); // local to Sequence from DEMO
  const L04 = f(tl.vo[3].start) - DEMO; // "What's live stays on top"
  const s = ease(frame, L04 + 28, L04 + 62, SCALE0, SCALE1);
  return (
    <div style={{ position: "absolute", left: 60, top: 200, width: 960, height: 900, opacity: ease(frame, 0, 3), borderRadius: 28, background: A.bg, border: "1px solid #303137", boxShadow: "0 30px 80px rgba(20,26,18,0.3)", overflow: "hidden" }}>
      <div style={{ width: 565, transform: `scale(${s})`, transformOrigin: "0 0" }}>
        {GROUPS.map((g, gi) => {
          const t0 = L04 + gi * 8;
          const sw = ease(frame, t0, t0 + 22); // 0 → 1 : swap done/live
          return (
            <Pop key={g.name} at={gi * 4} y={30} from={0.97} origin="50% 0%">
              <ProjectGroup name={g.name} color={g.color}>
                <div style={{ position: "relative", height: SLOT * 2 }}>
                  <div style={{ position: "absolute", left: 0, right: 0, top: 0, transform: `translateY(${sw * SLOT}px)`, zIndex: 1 }}>
                    <ThreadRow title={g.done} status="done" time="" dim={sw > 0.02} style={{ height: SLOT, opacity: interpolate(sw, [0, 1], [1, 0.4]) }} />
                  </div>
                  <div style={{ position: "absolute", left: 0, right: 0, top: SLOT, transform: `translateY(${-sw * SLOT}px)`, zIndex: 2 }}>
                    <ThreadRow title={g.live} status="running" time="" account={g.acc} style={{ height: SLOT }} />
                  </div>
                </div>
              </ProjectGroup>
            </Pop>
          );
        })}
      </div>
    </div>
  );
};

export const Short04Thousand: React.FC = () => (
  <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
    <Sequence from={0} durationInFrames={WIPE_END}>
      <PainList />
      <HookTitle lines={["A thousand old chats.", "One you need."]} accent="need" />
    </Sequence>
    <Sequence from={DEMO} durationInFrames={END - DEMO + 30}>
      <Demo />
    </Sequence>
    <Turn at={tl.cues.turn} />
  </ShortShell>
);
