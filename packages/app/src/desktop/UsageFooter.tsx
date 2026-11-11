import { UsageRing } from "./UsageRing";
import { agentDisplayName } from "./types";
import type { CSSProperties } from "react";
import { Code2, Terminal } from "lucide-react";
import type { Account } from "./types";
import { useAccountUsageView } from "./useAccountUsage";
/** Renders polled usage; polling is owned by `useAccountUsagePoller` (mounted once in the app shell). */
export function UsageFooter({accounts,onOpen}:{accounts:Account[];native?:boolean;onOpen:()=>void}) {
  const viewOf = useAccountUsageView();
  return <>{accounts.map(a=>{
    const v=viewOf(a), name=agentDisplayName(a);
    return <button key={a.id} className="footer-account-button usage-ring-button" style={{"--account-color":a.color} as CSSProperties} aria-label={`${name}, ${v.ariaText}. View usage and reset times.`} title={`${name}\n${[v.detail, v.error].filter(Boolean).join("\n")||"Retrieving usage"}`} onClick={onOpen}>
      <UsageRing remaining={v.remaining} color={a.color} stale={v.stale}>{a.provider==="codex"?<Code2 size={14}/>:<Terminal size={14}/>}</UsageRing>
      <small><span className="footer-connection-name">{name}</span>
        {v.rows.length ? v.rows.map(r=><span className="footer-usage-row" key={r.key}>
          {r.label&&<em>{r.label}</em>}<span className="footer-usage-text">{r.text}</span>
        </span>) : <span className={`footer-usage-row footer-usage-empty${v.isError?" is-error":""}`}>{v.text}</span>}
      </small>
    </button>;
  })}</>;
}
