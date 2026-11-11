import { UsageRing } from "./UsageRing";
import { agentDisplayName } from "./types";
import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Code2, Terminal } from "lucide-react";
import { usageErrorSummary, usageSummary, type UsageLine, type UsageWindow } from "./usage";
import type { Account } from "./types";
type Usage = { windows: UsageWindow[]; checked_at: number };
const pct = (l: UsageLine) => l.remaining === null ? "??" : `${Math.round(l.remaining)}%`;
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
    const summary=usageSummary(usage?.windows||[], now);
    const stale=!!result?.error || (!!usage && now-usage.checked_at>300000);
    const suffix=stale?" · last known":"";
    const rows:{key:string;name:string;line:UsageLine;label?:string}[]=[];
    if(summary.session) rows.push({key:"5h",name:"5h",line:summary.session});
    if(summary.weekly) rows.push({key:"Week",name:"Week",line:summary.weekly});
    if(!rows.length && summary.limiting) rows.push({key:"limit",name:summary.limiting.label,line:summary.limiting,label:summary.limiting.label});
    const errorText=usageErrorSummary(result?.error, a.provider);
    const remaining=summary.limiting?.remaining ?? null;
    const rowText=(r:typeof rows[number])=>`${r.label?`${r.label} · `:""}${pct(r.line)} left · ${r.line.resetText}${suffix}`;
    const visible=rows.length?rows.map(rowText).join("; "):(usage?"Usage unavailable":(result?.error?errorText:"Retrieving usage"));
    const detail=summary.lines.map(l=>`${l.label}: ${pct(l)} left · ${l.resetText}`).join("\n");
    const name=agentDisplayName(a);
    return <button key={a.id} className="footer-account-button usage-ring-button" style={{"--account-color":a.color} as CSSProperties} aria-label={`${name}, ${rows.length?rows.map(r=>`${pct(r.line)} left · ${r.line.resetText} (${r.name})${suffix}`).join("; "):visible}. View usage and reset times.`} title={`${name}\n${[detail, result?.error].filter(Boolean).join("\n")||"Retrieving usage"}`} onClick={onOpen}>
      <UsageRing remaining={remaining} color={a.color} stale={stale}>{a.provider==="codex"?<Code2 size={14}/>:<Terminal size={14}/>}</UsageRing>
      <small><span className="footer-connection-name">{name}</span>
        {rows.length ? rows.map(r=><span className="footer-usage-row" key={r.key}>
          <em>{r.name}</em><span className="footer-usage-text">{pct(r.line)} left · {r.line.resetText}{suffix}</span>
          <i className="footer-usage-bar" aria-hidden="true"><b style={{width:`${r.line.remaining===null?0:100-r.line.remaining}%`}}/></i>
        </span>) : <span className={`footer-usage-row footer-usage-empty${result?.error?" is-error":""}`}>{visible}</span>}
      </small>
    </button>;
  })}</>;
}
