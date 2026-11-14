import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@freddai/ui/components/dropdown-menu";
import { apps, openApp, type AppId } from "./registry";

export function AppSwitcher({ current, className, onError }: { current: AppId; className?: string; onError?: (e: Error) => void }) {
  const [message, setMessage] = useState("");
  const active = apps.find(a => a.id === current) ?? apps[0];
  const choose = (id: AppId) => {
    if (id === current) return;
    setMessage("");
    openApp(id).catch(e => {
      const error = e instanceof Error ? e : new Error(String(e));
      if (onError) onError(error); else setMessage(error.message);
    });
  };
  return <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Switch app" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: 0, padding: "2px 6px", font: "inherit", cursor: "pointer", color: "inherit" }}>
        <Dot color={active.accent} />{active.name}<ChevronDown size={14} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {apps.map(app => <DropdownMenuItem key={app.id} disabled={app.status === "soon"} onSelect={() => choose(app.id)} aria-current={app.id === current ? "true" : undefined}>
          <Dot color={app.accent} />
          <span style={{ flex: 1, fontWeight: app.id === current ? 600 : 400 }}>{app.name}</span>
          {app.id === current && <span aria-hidden>✓</span>}
          {app.status === "soon" && <span style={{ fontSize: 11, opacity: 0.7 }}>Soon</span>}
        </DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
    {message && <span role="alert" style={{ color: "#e5484d", fontSize: 12 }}>{message}</span>}
  </span>;
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: color, display: "inline-block" }} />;
}
