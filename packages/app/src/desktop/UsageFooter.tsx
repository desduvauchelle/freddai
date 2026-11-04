import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Code2, Terminal } from "lucide-react";
import { limitingWindow, resetCountdown } from "./usage";
import type { Account } from "./types";
type Usage = { windows: {label: string; used_percent: number; resets_at: number | null}[]; checked_at: number };
export function UsageFooter({accounts,native,onOpen}:{accounts:Account[];native:boolean;onOpen:()=>void}) {
  const [values,setValues] = useState<Record<string,{usage?:Usage;error?:string}>>({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const ids = accounts.map(a=>a.id).join("|");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1);
    window.addEventListener("freddai:usage-refresh", refresh);
    return () => window.removeEventListener("freddai:usage-refresh", refresh);
  }, []);
  useEffect(()=>{
    if (!native) return;
    let disposed=false, timer:ReturnType<typeof setTimeout>;
    async function refresh() {
      await Promise.all(accounts.map(async a=>{
        try { const usage=await invoke<Usage>("account_usage",{account:a.id}); if(!disposed)setValues(v=>({...v,[a.id]:{usage}})); }
        catch(e){if(!disposed)setValues(v=>({...v,[a.id]:{...v[a.id],error:String(e)}}));}
      }));
      if(!disposed)timer=setTimeout(refresh,120000);
    }
    void refresh();return()=>{disposed=true;clearTimeout(timer);};
  },[ids,native,revision]);
  return <>{accounts.map(a=>{
    const result=values[a.id], usage=result?.usage;
    const window = limitingWindow(usage?.windows || []);
    const remaining=window ? Math.max(0,Math.min(100,100-window.used_percent)) : null;
    const reset = resetCountdown(window?.resets_at, now);
    const stale=!!result?.error || (!!usage && now-usage.checked_at>300000);
    const label=remaining===null ? "Usage unavailable" : `${Math.round(remaining)}%`;
    const resetUnknown = window?.resets_at == null || !Number.isFinite(window.resets_at);
    const compactLabel = remaining === null && resetUnknown ? "??"
      : `${remaining === null ? "??" : label} - ${resetUnknown ? "??" : reset}${stale ? " · last known" : ""}`;
    const detail=usage?.windows.map(w=>`${w.label}: ${Math.round(w.used_percent)}% used; ${w.resets_at?`resets ${new Date(w.resets_at*1000).toLocaleString()}`:"reset unavailable"}`).join("\n");
    return <button key={a.id} className="footer-account-button usage-ring-button" style={{"--account-color":a.color} as CSSProperties} aria-label={`${a.name}, ${label}. ${reset}${stale ? ", last known" : ""}. View usage and reset times.`} title={`${a.name} · ${label}\n${detail||result?.error||"Retrieving usage"}`} onClick={onOpen}>
      <span className="usage-ring"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" className="usage-ring-track"/>{remaining!==null&&<circle cx="18" cy="18" r="15" stroke={remaining<=10?"#e9b667":a.color} strokeDasharray={`${remaining*.94248} 94.248`} opacity={stale?.45:1}/>}</svg>{a.provider==="codex"?<Code2 size={14}/>:<Terminal size={14}/>}</span>
      <small><span className="footer-connection-name">{a.name}</span><span>{compactLabel}</span></small>
    </button>;
  })}</>;
}
