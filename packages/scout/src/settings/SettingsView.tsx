import { ArrowLeft } from "lucide-react";
import type { SettingsTab, SettingsViewProps } from "../contracts";
import { cx, GhostButton } from "../ui";
import { AgentsSources } from "./AgentsSources";
import { InlineError, useRun } from "./common";
import { RulesEditor } from "./Rules";
import { WorkspaceList } from "./Workspaces";
import "./settings.css";

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "agents", label: "Agents & sources" },
  { id: "workspaces", label: "Workspaces" },
  { id: "rules", label: "Rules" },
  { id: "account", label: "Account" },
];

const HEADINGS: Record<SettingsTab, { title: string; subtitle: string }> = {
  agents: { title: "Agents and sources", subtitle: "Everything your agents can reach, per agent and per account. Editable any time." },
  workspaces: { title: "Workspaces", subtitle: "Workspaces hold projects. Rename, reorder or import them from Freddai." },
  rules: { title: "Rules", subtitle: "What to do when something arrives, in plain words. Each rule can cover all projects or one." },
  account: { title: "Account", subtitle: "Where Scout keeps its data, and a way back to onboarding." },
};

function AccountTab({ state, actions, onBack }: Pick<SettingsViewProps, "state" | "actions" | "onBack">) {
  const { run, error, clearError } = useRun();
  return <div className="st-account">
    <InlineError error={error} onDismiss={clearError} />
    <section className="st-panel">
      <h3>Data</h3>
      <p>Scout keeps its data in the app data folder under <code>scout/state.json</code>.</p>
      <p className="st-muted">{state.workspaces.length} workspaces · {state.projects.length} projects · {state.items.length} items · {state.rules.length} rules · {state.sources.length} sources</p>
    </section>
    {state.settings.sample_data && <section className="st-panel">
      <h3>Sample data</h3>
      <p>The sample board is loaded. Clearing removes only what came with it.</p>
      <GhostButton onClick={() => void run(() => actions.sampleData(false))}>Clear sample data</GhostButton>
    </section>}
    <section className="st-panel">
      <h3>Onboarding</h3>
      <p>Walk through agents, workspaces, sources and rules again. Nothing is reset.</p>
      <GhostButton onClick={() => void run(async () => {
        await actions.settingsSave({ ...state.settings, onboarding_done: false, onboarding_step: 1 });
        onBack();
      })}>Revisit onboarding</GhostButton>
    </section>
  </div>;
}

export function SettingsView(props: SettingsViewProps) {
  const { tab, onTab, onBack } = props;
  const heading = HEADINGS[tab];
  return <div className="st-settings">
    <header className="st-topbar" data-tauri-drag-region>
      <span className="sc-brand" data-tauri-drag-region><span className="sc-brand__mark" aria-hidden data-tauri-drag-region />Scout</span>
      <button type="button" className="st-back" aria-label="Back to board" onClick={onBack}><ArrowLeft size={16} aria-hidden /> Back</button>
      <div className="st-tabs" data-tauri-drag-region role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map(t => <button key={t.id} type="button" role="tab" id={`st-tab-${t.id}`} aria-selected={t.id === tab}
          aria-controls="st-tabpanel" className={cx("st-tab", t.id === tab && "is-active")} onClick={() => onTab(t.id)}>{t.label}</button>)}
      </div>
      <span className="st-topbar__spacer" data-tauri-drag-region />
    </header>
    <main className="st-page" id="st-tabpanel" role="tabpanel" aria-labelledby={`st-tab-${tab}`}>
      <h1 className="st-title">{heading.title}</h1>
      <p className="st-subtitle">{heading.subtitle}</p>
      {tab === "agents" && <AgentsSources {...props} variant="settings" />}
      {tab === "workspaces" && <WorkspaceList state={props.state} actions={props.actions} />}
      {tab === "rules" && <RulesEditor state={props.state} actions={props.actions} />}
      {tab === "account" && <AccountTab state={props.state} actions={props.actions} onBack={onBack} />}
    </main>
  </div>;
}
