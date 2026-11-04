import { useEffect, useId, useMemo, useRef, useState, type ComponentProps, type Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Textarea } from "@freddai/ui/components/textarea";
import {
  applySuggestion, detectTrigger, fileIndex, menuKey, rankCommands, rankFiles, toFileItems,
  type SlashCommand, type Trigger,
} from "./composer-suggest";

/** Which thread/draft the menus describe: slash commands depend on the agent, files on the project. */
export type SuggestContext = { session?: string | null; project?: string | null; account?: string | null };
export type SuggestLoader = {
  commands: (context: SuggestContext) => Promise<SlashCommand[]>;
  files: (context: SuggestContext) => Promise<string[]>;
};
export const hostLoader: SuggestLoader = {
  commands: context => invoke<SlashCommand[]>("list_slash_commands", { session: context.session ?? null, project: context.project ?? null, account: context.account ?? null }),
  files: context => invoke<string[]>("list_project_files", { session: context.session ?? null, project: context.project ?? null }),
};

type Loaded<T> = { key: string; items: T[]; error?: string };
const keyOf = (c: SuggestContext) => `${c.session ?? ""}|${c.project ?? ""}|${c.account ?? ""}`;

type Props = Omit<ComponentProps<typeof Textarea>, "value" | "onChange" | "ref"> & {
  value: string;
  onValueChange: (value: string) => void;
  context: SuggestContext;
  loader?: SuggestLoader;
  composerRef?: Ref<HTMLTextAreaElement>;
};

export function SuggestTextarea({ value, onValueChange, context, loader = hostLoader, composerRef, onKeyDown, ...rest }: Props) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [commands, setCommands] = useState<Loaded<SlashCommand> | null>(null);
  const [files, setFiles] = useState<Loaded<string> | null>(null);
  const listId = useId();
  const key = keyOf(context);
  const trigger: Trigger | null = useMemo(() => detectTrigger(value, Math.min(caret, value.length)), [value, caret]);
  const triggerId = trigger ? `${trigger.kind}:${trigger.start}` : null;
  const open = !!trigger && dismissed !== triggerId;
  const kind = open ? trigger.kind : null;

  // Menus are fetched when first needed for this agent/project, and again when the context changes.
  useEffect(() => {
    if (kind !== "slash" || commands?.key === key) return;
    let live = true;
    loader.commands(context).then(items => live && setCommands({ key, items }), e => live && setCommands({ key, items: [], error: String(e) }));
    return () => { live = false; };
  }, [kind, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (kind !== "file" || files?.key === key) return;
    let live = true;
    loader.files(context).then(items => live && setFiles({ key, items }), e => live && setFiles({ key, items: [], error: String(e) }));
    return () => { live = false; };
  }, [kind, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const fileItems = useMemo(() => toFileItems(files?.key === key ? files.items : []), [files, key]);
  const index = useMemo(() => fileIndex(fileItems), [fileItems]);
  const slashLoaded = commands?.key === key ? commands : null;
  const fileLoaded = files?.key === key ? files : null;
  const results = useMemo(() => {
    if (!open || !trigger) return [];
    if (trigger.kind === "slash") return (slashLoaded ? rankCommands(slashLoaded.items, trigger.query) : []).map(c => ({ id: c.name, label: `/${c.name}`, hint: c.argumentHint, detail: c.description, insert: `/${c.name}` }));
    return rankFiles(fileItems, index, trigger.query).map(f => ({ id: f.path, label: f.base, hint: "", detail: f.path, insert: `@${f.path}` }));
  }, [open, trigger, slashLoaded, fileItems, index]);
  const loadError = open ? (trigger?.kind === "slash" ? slashLoaded?.error : fileLoaded?.error) : undefined;
  const loading = open && !loadError && (trigger?.kind === "slash" ? !slashLoaded : !fileLoaded);
  useEffect(() => setActive(0), [trigger?.query, trigger?.kind]);
  const visible = open && (results.length > 0 || !!loadError || loading);

  const choose = (n: number) => {
    const item = results[n];
    if (!item || !trigger) return;
    const next = applySuggestion(value, trigger, item.insert);
    onValueChange(next.value);
    setCaret(next.caret);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(next.caret, next.caret); });
  };

  return (
    <div className="composer-suggest-anchor">
      {visible && (
        <ul id={listId} role="listbox" aria-label={kind === "slash" ? "Slash commands" : "Project files"} className="composer-suggest">
          {loadError && <li role="alert" className="composer-suggest-note">{kind === "slash" ? "Could not load slash commands" : "Could not list project files"}: {loadError}</li>}
          {loading && <li className="composer-suggest-note">Loading…</li>}
          {results.map((item, n) => (
            <li key={item.id} id={`${listId}-${n}`} role="option" aria-selected={n === active} className="composer-suggest-item"
              onMouseDown={e => { e.preventDefault(); choose(n); }} onMouseMove={() => setActive(n)}>
              <span className="composer-suggest-name">{item.label}</span>
              {item.hint && <span className="composer-suggest-hint">{item.hint}</span>}
              {item.detail && <span className="composer-suggest-detail">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      <Textarea
        {...rest}
        ref={node => {
          area.current = node;
          if (typeof composerRef === "function") composerRef(node); else if (composerRef) (composerRef as { current: HTMLTextAreaElement | null }).current = node;
        }}
        value={value}
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible && results.length ? `${listId}-${active}` : undefined}
        onChange={e => { setCaret(e.target.selectionStart ?? e.target.value.length); setDismissed(null); onValueChange(e.target.value); }}
        onSelect={e => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={e => {
          if (visible && results.length && !e.nativeEvent.isComposing) {
            const step = menuKey(e.key, active, results.length);
            if (step && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
              e.preventDefault();
              if (step.action === "select") choose(active);
              else if (step.action === "close") setDismissed(triggerId);
              else setActive(step.active);
              return;
            }
          } else if (visible && e.key === "Escape") { e.preventDefault(); setDismissed(triggerId); return; }
          onKeyDown?.(e);
        }}
      />
    </div>
  );
}
