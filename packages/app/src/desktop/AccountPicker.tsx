import type { CSSProperties } from "react";
import { Code2, Terminal } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@freddai/ui/components/select";
import { UsageRing } from "./UsageRing";
import { agentDisplayName, type Account } from "./types";
import { useAccountUsageView } from "./useAccountUsage";

/** One-step agent/account picker whose rows mirror the footer: account colour, usage ring and usage/reset text. */
export function AccountPicker({ accounts, value, onChange, disabled = false, label = "Agent and account", placeholderOption }: {
  accounts: Account[]; value: string; onChange: (id: string) => void; disabled?: boolean; label?: string;
  placeholderOption?: { value: string; label: string };
}) {
  const viewOf = useAccountUsageView();
  const selected = accounts.find(a => a.id === value);
  return <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
    <SelectTrigger aria-label={label} className="account-picker-trigger">
      <SelectValue placeholder={label}>
        {selected ? <span className="account-picker-current"><i className="account-picker-dot" style={{ background: selected.color }}/>{agentDisplayName(selected)}</span> : placeholderOption?.value === value ? placeholderOption.label : undefined}
      </SelectValue>
    </SelectTrigger>
    <SelectContent className="dev-popup" position="item-aligned" side="bottom" align="start">
      {placeholderOption && <SelectItem value={placeholderOption.value}>{placeholderOption.label}</SelectItem>}
      {accounts.map(a => {
        const v = viewOf(a);
        return <SelectItem key={a.id} value={a.id} className="account-picker-item" style={{ "--account-color": a.color } as CSSProperties}>
          <span className="account-picker-row">
            <UsageRing remaining={v.remaining} color={a.color} stale={v.stale} size={18}>{a.provider === "codex" ? <Code2 size={10}/> : <Terminal size={10}/>}</UsageRing>
            <span className="account-picker-copy">
              <span className="account-picker-name">{agentDisplayName(a)}</span>
              <small className={v.isError ? "is-error" : undefined}>{v.text}</small>
            </span>
          </span>
        </SelectItem>;
      })}
    </SelectContent>
  </Select>;
}
