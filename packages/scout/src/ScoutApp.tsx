import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTheme } from "@freddai/app/desktop/use-theme";
import { useFreddaiSnapshot } from "@freddai/shared/agent/useFreddaiSnapshot";
import { voice } from "@freddai/shared/voice/voice";
import type { ChatContext, ScoutView, SettingsTab } from "./contracts";
import { useScout } from "./store/useScout";
import { EmptyBoard, ErrorBar, SampleDataBanner, TopBar, type ErrorEntry } from "./shell";
import { HomeBoard } from "./home";
import { NewItemDialog, ProjectPanel } from "./project";
import { ItemThread } from "./item";
import { ChatPanel } from "./chat";
import { SettingsView } from "./settings";
import { Onboarding } from "./onboarding";
import { FreddaiErrorContext, OpenThreadsContext, useOpenThreadRegistry } from "./freddaiLink";
import "./scout.css";

type BaseView = Extract<ScoutView, { kind: "home" | "settings" | "onboarding" }>;
type SheetView = Extract<ScoutView, { kind: "project" | "item" }>;

const HOME: BaseView = { kind: "home" };

/** Swallow a rejection whose message the store already put in the ErrorBar. */
const shown = (p: Promise<unknown>) => { p.catch(() => undefined); };

export function ScoutApp() {
  const { appearance } = useTheme();
  const { state, error, actions } = useScout();
  // Only the threads a mounted chat shows (item sheet, side chat) carry transcripts; see freddaiLink.tsx.
  const [openThreads, registerOpenThread] = useOpenThreadRegistry();
  const { db, error: dbError, refresh: refreshDb } = useFreddaiSnapshot({ openThreads });

  const [baseOverride, setBase] = useState<BaseView | null>(null);
  const [sheets, setSheets] = useState<SheetView[]>([]);
  const [newItem, setNewItem] = useState<{ projectId: string | null } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  // Voice status powers every MicButton (card voice notes, composers); nothing else loads it in a Scout window.
  useEffect(() => {
    if (!/Mac/.test(navigator.platform)) return;
    void voice.refresh();
    const refresh = () => void voice.refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearchNext = useRef(false);

  const base: BaseView = baseOverride
    ?? (state && !state.settings.onboarding_done
      ? { kind: "onboarding", step: clampStep(state.settings.onboarding_step) }
      : HOME);
  const topSheet = base.kind === "home" ? sheets[sheets.length - 1] ?? null : null;
  const view: ScoutView = topSheet ?? base;

  const chatContext = useMemo<ChatContext>(() => {
    if (view.kind === "project") return { view, projectId: view.projectId };
    if (view.kind === "item") {
      const item = state?.items.find(i => i.id === view.itemId);
      return { view, itemId: view.itemId, projectId: item?.project };
    }
    return { view };
  }, [view, state?.items]);

  // Drop sheets whose target was deleted (e.g. sample data cleared) instead of rendering a blank panel.
  useEffect(() => {
    if (!state) return;
    setSheets(prev => {
      const next = prev.filter(s => s.kind === "project"
        ? state.projects.some(p => p.id === s.projectId)
        : state.items.some(i => i.id === s.itemId));
      return next.length === prev.length ? prev : next;
    });
  }, [state]);

  const goHome = useCallback(() => setBase(HOME), []);
  const openProject = useCallback((projectId: string) => {
    setBase(HOME);
    setSheets(prev => [...prev.filter(s => !(s.kind === "project" && s.projectId === projectId)), { kind: "project", projectId }]);
  }, []);
  const openItem = useCallback((itemId: string) => {
    setBase(HOME);
    setSheets(prev => [...prev.filter(s => !(s.kind === "item" && s.itemId === itemId)), { kind: "item", itemId }]);
  }, []);
  const popSheet = useCallback(() => setSheets(prev => prev.slice(0, -1)), []);
  const openNewItem = useCallback((projectId?: string | null) => setNewItem({ projectId: projectId ?? null }), []);
  const openSettings = useCallback((tab: SettingsTab = "agents") => setBase({ kind: "settings", tab }), []);

  // Keyboard: Esc closes the top-most sheet, Cmd/Ctrl+K focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (base.kind !== "home") { focusSearchNext.current = true; setBase(HOME); }
        else searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && !e.defaultPrevented && !newItem && topSheet) {
        e.preventDefault();
        popSheet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [base.kind, newItem, topSheet, popSheet]);
  useEffect(() => {
    if (base.kind === "home" && focusSearchNext.current) {
      focusSearchNext.current = false;
      searchRef.current?.focus();
    }
  }, [base.kind]);

  const run = useCallback((task: () => Promise<void>) => {
    setBusy(true);
    shown(task().finally(() => setBusy(false)));
  }, []);
  const retry = useCallback(() => {
    setRetrying(true);
    setAppError(null);
    shown(Promise.allSettled([actions.refresh(), refreshDb()]).finally(() => setRetrying(false)));
  }, [actions, refreshDb]);

  const errors: ErrorEntry[] = [];
  if (error) errors.push({ source: "Scout", message: error });
  if (dbError) errors.push({ source: "Freddai", message: dbError });
  if (appError) errors.push({ source: "App switcher", message: appError });

  const finishOnboarding = useCallback(() => {
    if (!state) return;
    run(async () => {
      await actions.settingsSave({ ...state.settings, onboarding_done: true });
      setBase(HOME);
    });
  }, [state, actions, run]);
  const onboardingStep = useCallback((step: number) => {
    const next = clampStep(step);
    setBase({ kind: "onboarding", step: next });
    if (state && state.settings.onboarding_step !== next) {
      shown(actions.settingsSave({ ...state.settings, onboarding_step: next }));
    }
  }, [state, actions]);

  const screen = state ? { state, db, actions } : null;
  const isHome = base.kind === "home";

  let content: ReactNode = null;
  if (!screen) {
    content = error ? null : <div className="sc-empty"><p className="sc-empty__text">Loading Scout…</p></div>;
  } else if (base.kind === "onboarding") {
    content = <Onboarding {...screen} step={base.step} onStep={onboardingStep} onDone={finishOnboarding} onSkip={finishOnboarding} />;
  } else if (base.kind === "settings") {
    content = <SettingsView {...screen} tab={base.tab} onTab={tab => setBase({ kind: "settings", tab })} onBack={goHome} />;
  } else if (screen.state.workspaces.length === 0) {
    content = <EmptyBoard
      busy={busy}
      onImport={() => run(actions.importFreddai)}
      onSample={() => run(() => actions.sampleData(true))}
      onOnboarding={() => setBase({ kind: "onboarding", step: 1 })}
    />;
  } else {
    content = <HomeBoard {...screen} workspaceFilter={workspaceFilter} search={search}
      onOpenProject={openProject} onOpenItem={openItem} onNewItem={openNewItem} />;
  }

  return <OpenThreadsContext.Provider value={registerOpenThread}><FreddaiErrorContext.Provider value={dbError}>
  <div className={`scout-app${chatOpen ? " is-chat-open" : ""}`} data-appearance={appearance}>
    <div className="sc-main">
      {/* Onboarding and Settings draw their own top bar (stepper / tabs) per the Figma frames. */}
      {base.kind !== "onboarding" && base.kind !== "settings" && <TopBar
        workspaces={state?.workspaces ?? []}
        mode={isHome ? "full" : "minimal"}
        search={search}
        onSearch={setSearch}
        searchRef={searchRef}
        workspaceFilter={workspaceFilter}
        onWorkspaceFilter={setWorkspaceFilter}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(o => !o)}
        onOpenSettings={() => openSettings()}
        onAppError={e => setAppError(e.message)}
      />}
      <ErrorBar errors={errors} onRetry={retry} retrying={retrying} />
      {state?.settings.sample_data && isHome && <SampleDataBanner
        busy={busy}
        onClear={() => run(() => actions.sampleData(false))}
        onImport={() => run(actions.importFreddai)}
      />}
      <main className="sc-content">{content}</main>
      {screen && topSheet && <div className="sc-sheet-layer">
        <button type="button" className="sc-sheet-backdrop" aria-label="Close panel" tabIndex={-1} onClick={popSheet} />
        <aside className="sc-sheet" role="dialog" aria-modal="false" aria-label={topSheet.kind === "project" ? "Project" : "Item"}>
          {topSheet.kind === "project"
            ? <ProjectPanel key={topSheet.projectId} {...screen} projectId={topSheet.projectId} onClose={popSheet} onOpenItem={openItem} onNewItem={openNewItem} />
            : <ItemThread key={topSheet.itemId} {...screen} itemId={topSheet.itemId} onClose={popSheet} onOpenProject={openProject} />}
        </aside>
      </div>}
    </div>
    {chatOpen && screen && <aside className="sc-rail" aria-label="Chat">
      <ChatPanel {...screen} context={chatContext} onClose={() => setChatOpen(false)} onOpenItem={openItem} />
    </aside>}
    {screen && <NewItemDialog {...screen} open={newItem !== null} projectId={newItem?.projectId ?? null}
      onClose={() => setNewItem(null)}
      onCreated={id => { setNewItem(null); openItem(id); }} />}
  </div>
  </FreddaiErrorContext.Provider></OpenThreadsContext.Provider>;
}

function clampStep(step: number | undefined): number {
  const n = Math.round(Number(step) || 1);
  return Math.min(6, Math.max(1, n));
}
