import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { PermissionMode } from "./types";

export const effectivePermissionMode = (provider: string | undefined, mode: PermissionMode): PermissionMode =>
  provider === "codex" || provider === "claude" ? mode : "ask";

export function PermissionSelect({ provider, value, onChange, disabled }: {
  provider?: string; value: PermissionMode; onChange: (mode: PermissionMode) => void; disabled?: boolean;
}) {
  const supported = provider === "codex" || provider === "claude";
  return <span className="permission-control" data-mode={supported ? value : "default"}>
    {supported && value === "bypass" ? <ShieldAlert size={15} aria-hidden="true"/> : <ShieldCheck size={15} aria-hidden="true"/>}
    <select className="permission-select" aria-label="Permissions" title={supported ? `${value === "bypass" ? "Full access" : "Ask for approval"} · Applies to the next message. Bypass allows tools to run without approval.` : "Permission settings are unavailable for this provider."}
    value={supported ? value : "unsupported"} disabled={disabled || !supported}
    onChange={event => onChange(event.target.value as PermissionMode)}>
    {supported ? <><option value="ask">Ask for approval</option><option value="bypass">Full access</option></> : <option value="unsupported">Permissions: agent default</option>}
  </select></span>;
}
