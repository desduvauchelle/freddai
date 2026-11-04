import { useCallback, useEffect, useRef, useState } from "react";

export function ThreadTitle({ title, displayTitle = title, onRename, editRequest = 0 }: {
  title: string;
  displayTitle?: string;
  onRename: (title: string) => Promise<void>;
  /** Increment to start editing from outside (e.g. a Rename menu item). */
  editRequest?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const committing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const focusInput = useCallback((node: HTMLInputElement | null) => {
    input.current = node;
    if (node) { node.focus(); node.select(); }
  }, []);
  useEffect(() => { if (editRequest > 0) begin(); }, [editRequest]);
  function begin() {
    setValue(title);
    setError("");
    setEditing(true);
  }
  function close(returnFocus: boolean) {
    setEditing(false);
    if (returnFocus) requestAnimationFrame(() => trigger.current?.focus());
  }
  async function save(returnFocus: boolean) {
    if (committing.current) return;
    const next = value.trim();
    if (!next || next === title) { close(returnFocus); return; }
    committing.current = true;
    setSaving(true);
    setError("");
    try {
      await onRename(next);
      close(returnFocus);
    } catch (e) {
      setError(String(e));
      input.current?.focus();
    } finally {
      committing.current = false;
      setSaving(false);
    }
  }
  if (editing) return <span className="thread-title-editor" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <input
      ref={focusInput}
      aria-label="Thread name"
      aria-invalid={!!error}
      aria-description="Enter to save, Escape to cancel. Clicking away also saves."
      value={value}
      readOnly={saving}
      aria-busy={saving}
      onChange={e => setValue(e.target.value)}
      onBlur={() => void save(false)}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") { e.preventDefault(); void save(true); }
        if (e.key === "Escape" && !committing.current) { e.preventDefault(); close(true); }
      }}
    />
    {error && <span className="thread-title-error" role="alert">{error}</span>}
  </span>;
  return <span ref={trigger} className="thread-title-label" tabIndex={0} role="button"
    aria-label={`Rename thread: ${title}`} title="Double-click to rename (or press F2)"
    onDoubleClick={e => { e.stopPropagation(); begin(); }}
    onKeyDown={e => {
      if (e.key === "F2" || e.key === "Enter" || e.key === " ") {
        e.preventDefault(); e.stopPropagation(); begin();
      }
    }}
  >{displayTitle}</span>;
}
