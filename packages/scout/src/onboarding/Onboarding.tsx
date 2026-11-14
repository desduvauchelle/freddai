import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, PanelRight } from "lucide-react";
import { ChatPanel } from "../chat";
import type { OnboardingProps } from "../contracts";
import { AgentsSources, RulesEditor, WorkspaceBoard } from "../settings";
import "../settings/settings.css";
import { cx, DarkButton, GhostButton } from "../ui";
import { Welcome } from "./Welcome";
import { PlaceSources } from "./PlaceSources";
import { PracticeRun } from "./PracticeRun";
import "./onboarding.css";

export const ONBOARDING_STEPS = [
  { step: 1, label: "Welcome", title: "Throw everything at me. I'll help you get it organized.", subtitle: "Email, calendars, chats, meetings — Scout gathers what's coming at you, per account, and sorts it into your projects.", next: "Next: where it all comes from" },
  { step: 2, label: "Agents & sources", title: "Where's it all coming from?", subtitle: "Here's what your assistants are already connected to. Untick anything Scout should ignore.", next: "Next: workspaces" },
  { step: 3, label: "Workspaces", title: "Set up your workspaces.", subtitle: "Workspaces hold projects. Add the ones you work on, or import them from Freddai.", next: "Next: place sources" },
  { step: 4, label: "Sources", title: "Place your sources.", subtitle: "Drag each source onto a project, or pick its project from the list.", next: "Next: rules" },
  { step: 5, label: "Rules", title: "Say what to do with what arrives.", subtitle: "Plain words: when something happens, then do this. Start from a template.", next: "Next: practice run" },
  { step: 6, label: "Practice run", title: "Practice run.", subtitle: "Create one real item to see where things land.", next: "Finish: see my projects" },
] as const;
const LAST_STEP = ONBOARDING_STEPS.length;

export function Onboarding(props: OnboardingProps) {
  const { state, actions, onStep, onDone, onSkip } = props;
  const step = Math.min(LAST_STEP, Math.max(1, Math.round(props.step) || 1));
  const meta = ONBOARDING_STEPS[step - 1];
  const [chatOpen, setChatOpen] = useState(true);

  const goTo = (next: number) => {
    // ScoutApp.onboardingStep persists the step and surfaces failures; saving here too wrote it twice.
    onStep(next);
  };

  return <div className={cx("ob", chatOpen && "has-chat")}>
    <header className="ob-topbar" data-tauri-drag-region>
      <span className="sc-brand" data-tauri-drag-region><span className="sc-brand__mark" aria-hidden data-tauri-drag-region />Scout</span>
      <ol className="ob-steps" data-tauri-drag-region aria-label="Onboarding progress">
        {ONBOARDING_STEPS.map((s, i) => <li key={s.step} className="ob-steps__item" data-tauri-drag-region>
          {i > 0 && <span className="ob-steps__sep" aria-hidden data-tauri-drag-region />}
          <button type="button" className={cx("ob-step", s.step === step && "is-current", s.step < step && "is-done")}
            aria-current={s.step === step ? "step" : undefined} onClick={() => s.step !== step && goTo(s.step)}>
            {s.step < step && <Check size={12} aria-hidden />}{s.step} {s.label}
          </button>
        </li>)}
      </ol>
      <span className="ob-topbar__right" data-tauri-drag-region>
        <button type="button" className="ob-skip" onClick={onSkip}>Skip for now</button>
        <button type="button" className={cx("sc-icon-btn", "ob-chat-toggle", chatOpen && "is-on")} aria-pressed={chatOpen}
          aria-label={chatOpen ? "Hide chat" : "Show chat"} onClick={() => setChatOpen(o => !o)}><PanelRight size={16} /></button>
      </span>
    </header>
    <main className="ob-main">
      <div className="ob-content">
        {step === 1 ? <Welcome title={meta.title} subtitle={meta.subtitle} /> : <>
          <h1 className="st-title">{meta.title}</h1>
          <p className="st-subtitle">{meta.subtitle}</p>
        </>}
        {step === 2 && <AgentsSources state={state} db={props.db} actions={actions} variant="onboarding" />}
        {step === 3 && <WorkspaceBoard state={state} actions={actions} />}
        {step === 4 && <PlaceSources state={state} actions={actions} />}
        {step === 5 && <RulesEditor state={state} actions={actions} />}
        {step === 6 && <PracticeRun state={state} actions={actions} />}
      </div>
      <footer className="ob-footer">
        {step > 1 ? <GhostButton icon={<ArrowLeft size={14} />} onClick={() => goTo(step - 1)}>Back</GhostButton> : <span />}
        <DarkButton onClick={() => (step < LAST_STEP ? goTo(step + 1) : onDone())}>{meta.next} <ArrowRight size={14} /></DarkButton>
      </footer>
    </main>
    {chatOpen && <aside className="ob-chat" aria-label="Chat">
      <ChatPanel state={state} db={props.db} actions={actions} context={{ view: { kind: "onboarding", step } }}
        onClose={() => setChatOpen(false)} onOpenItem={() => { /* items open from the board after onboarding */ }} />
    </aside>}
  </div>;
}
