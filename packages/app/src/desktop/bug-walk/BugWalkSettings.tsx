import { useEffect, useState } from "react";
import { Button } from "@freddai/ui/components/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@freddai/ui/components/field";
import { Switch } from "@freddai/ui/components/switch";
import { DEFAULT_SHORTCUT, bugWalk, type BugWalkSettings as Settings, type BugWalkStore } from "./bugWalk";

/** Pure: Tauri accelerator sanity check (non-empty, modifiers then one key). Rust validates for real when saving. */
export function validateShortcut(value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter a shortcut, for example CommandOrControl+Shift+R.";
  const parts = v.split("+").map(p => p.trim());
  if (parts.some(p => !p)) return "Use modifier and key names joined by +, for example CommandOrControl+Shift+R.";
  if (parts.length < 2) return "Include at least one modifier (Command, Control, Alt or Shift).";
  return null;
}

export function BugWalkSettings({ native, store = bugWalk }: { native: boolean; store?: BugWalkStore }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!native) return;
    store.settings.get().then(s => { if (!s) return; setSettings({ shortcut: s.shortcut, enabled: s.enabled, last_split: s.last_split ?? "single" }); setDraft(s.shortcut); if (s.error) setError(s.error); }).catch(e => { console.error("[bug-walk] settings load failed", e); setError(String(e)); });
  }, [native, store]);
  if (!native) return null;
  const save = async (next: Settings) => {
    try { await store.settings.set(next); setSettings(next); setError(""); }
    catch (e) { console.error("[bug-walk] settings save failed", e); setError(String(e)); }
  };
  const invalid = validateShortcut(draft);
  return <section aria-labelledby="bug-walk-settings-heading" className="space-y-6 bug-walk-settings">
    <h3 id="bug-walk-settings-heading">Bug walk</h3>
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="bug-walk-enabled">Enable bug walk shortcut</FieldLabel>
        <FieldDescription>Record a screen region while you talk, and hand the bugs you mention to an agent. Works when Freddai is in the background.</FieldDescription>
      </FieldContent>
      <Switch id="bug-walk-enabled" checked={!!settings?.enabled} disabled={!settings} onCheckedChange={enabled => settings && void save({ ...settings, enabled })} />
    </Field>
    <Field>
      <FieldLabel htmlFor="bug-walk-shortcut">Bug walk shortcut</FieldLabel>
      <div className="bug-walk-shortcut">
        <input id="bug-walk-shortcut" className="voice-select" value={draft} disabled={!settings} spellCheck={false} aria-invalid={!!invalid} aria-describedby="bug-walk-shortcut-help"
          onChange={e => setDraft(e.target.value)} placeholder={DEFAULT_SHORTCUT} />
        <Button type="button" variant="outline" size="sm" disabled={!settings || !!invalid || draft.trim() === settings.shortcut} onClick={() => settings && void save({ ...settings, shortcut: draft.trim() })}>Save</Button>
      </div>
      <FieldDescription id="bug-walk-shortcut-help">{invalid ?? `Current: ${settings?.shortcut ?? DEFAULT_SHORTCUT}. Uses Tauri accelerator syntax; CommandOrControl is ⌘ on Mac.`}</FieldDescription>
    </Field>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}
