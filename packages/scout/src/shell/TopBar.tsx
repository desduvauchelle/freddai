import type { Ref } from "react";
import { ChevronDown, PanelRight, Search, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@freddai/ui/components/dropdown-menu";
import { AppSwitcher } from "@freddai/shared/apps/AppSwitcher";
import type { Workspace } from "../api";
import { Avatar } from "../ui";

const ALL = "__all__";

export function Brand() {
  return <span className="sc-brand" data-tauri-drag-region><span className="sc-brand__mark" aria-hidden data-tauri-drag-region />Scout</span>;
}

export type TopBarProps = {
  workspaces: Workspace[];
  /** "full" on home (search + filter), "minimal" on settings / onboarding. */
  mode?: "full" | "minimal";
  search: string;
  onSearch: (value: string) => void;
  searchRef?: Ref<HTMLInputElement>;
  workspaceFilter: string | null;
  onWorkspaceFilter: (id: string | null) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  onOpenSettings: () => void;
  onAppError?: (error: Error) => void;
};

export function TopBar({
  workspaces, mode = "full", search, onSearch, searchRef, workspaceFilter, onWorkspaceFilter,
  chatOpen, onToggleChat, onOpenSettings, onAppError,
}: TopBarProps) {
  const ordered = [...workspaces].sort((a, b) => a.order - b.order);
  const active = ordered.find(w => w.id === workspaceFilter) ?? null;
  const stack = active ? [active] : ordered.slice(0, 4);
  return <header className="sc-topbar" data-tauri-drag-region>
    <div className="sc-topbar__brand" data-tauri-drag-region><Brand /></div>
    <div className="sc-topbar__center" data-tauri-drag-region>
      {mode === "full" && <label className="sc-search">
        <Search size={16} className="sc-search__icon" aria-hidden />
        <input
          ref={searchRef}
          type="search"
          aria-label="Search everything"
          placeholder="Search everything"
          value={search}
          onChange={e => onSearch(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape" && search) { e.stopPropagation(); onSearch(""); } }}
        />
        <kbd className="sc-kbd" aria-hidden>⌘K</kbd>
      </label>}
    </div>
    <div className="sc-topbar__right" data-tauri-drag-region>
      {mode === "full" && <DropdownMenu>
        <DropdownMenuTrigger className="sc-filter" aria-label={`Workspace filter: ${active?.name ?? "All workspaces"}`}>
          {stack.length > 0 && <span className="sc-avatar-stack">
            {stack.map(w => <Avatar key={w.id} name={w.name} color={w.color} size={18} />)}
          </span>}
          <span className="sc-filter__label">{active?.name ?? "All workspaces"}</span>
          <ChevronDown size={14} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="scout-menu">
          <DropdownMenuRadioGroup value={workspaceFilter ?? ALL} onValueChange={v => onWorkspaceFilter(v === ALL ? null : v)}>
            <DropdownMenuRadioItem value={ALL}>All workspaces</DropdownMenuRadioItem>
            {ordered.length > 0 && <DropdownMenuSeparator />}
            {ordered.map(w => <DropdownMenuRadioItem key={w.id} value={w.id}>
              <Avatar name={w.name} color={w.color} size={16} />{w.name}
            </DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>}
      <button type="button" className="sc-icon-btn" aria-label={chatOpen ? "Close chat" : "Open chat"} aria-pressed={chatOpen} onClick={onToggleChat}>
        <PanelRight size={18} aria-hidden />
      </button>
      <AppSwitcher current="scout" className="sc-app-switcher" onError={onAppError} />
      <button type="button" className="sc-icon-btn" aria-label="Settings" onClick={onOpenSettings}>
        <Settings size={18} aria-hidden />
      </button>
    </div>
  </header>;
}
