import React from "react";
import { AbsoluteFill } from "remotion";
import { FONT_DISPLAY, FONT_BODY } from "./fonts";
import { C } from "./theme";
import { A, ACCOUNTS, Dormouse, Icon, UsageRing } from "./ui";

export const ThumbnailV2: React.FC = () => {
  const a = ACCOUNTS[3];
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1000px 700px at 78% 55%, ${C.mint} 0%, ${C.cream} 62%)`, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 64, top: 70, fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 172, lineHeight: 0.94, letterSpacing: "-0.05em", color: C.ink }}>
        <div>Vibe</div><div>coding</div><div style={{ color: C.forest }}>heaven</div>
      </div>
      <div style={{ position: "absolute", right: 40, top: 40 }}><Dormouse size={330} /></div>
      <div style={{ position: "absolute", right: 36, top: 430, width: 520, borderRadius: 22, background: "#1d1e22", border: `1px solid ${A.input}`, boxShadow: "0 30px 70px rgba(30,36,30,0.4)", padding: "22px 26px", fontFamily: FONT_BODY }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <UsageRing remaining={9} color="#e08f6c" size={64}><span style={{ fontSize: 24, color: A.amber, fontWeight: 700 }}>✳</span></UsageRing>
          <div style={{ fontSize: 28, fontWeight: 700, color: A.amber }}>Limit reached</div>
        </div>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", borderRadius: 14, background: "#12301f", border: "2px solid #7fd0a0", fontSize: 30, fontWeight: 700, color: "#bff0d0" }}>
          <Icon name="check" size={34} color="#7fd0a0" stroke={2.4} />Switched. Keep going.
        </div>
      </div>
    </AbsoluteFill>
  );
};
