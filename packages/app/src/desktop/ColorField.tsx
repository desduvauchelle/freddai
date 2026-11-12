import { useEffect, useRef, useState } from "react";
import { Input } from "@freddai/ui/components/input";
import { Button } from "@freddai/ui/components/button";

const palette = [
  "#b59ae9", "#77b9df", "#8ec6a2", "#e7a17d", "#e89cbd",
  "#d9c079", "#ef4444", "#3b82f6", "#22c55e", "#64748b",
  "#f87171", "#fb923c", "#fbbf24", "#a3e635", "#34d399",
  "#2dd4bf", "#22d3ee", "#38bdf8", "#818cf8", "#a78bfa",
  "#c084fc", "#e879f9", "#f472b6", "#fb7185", "#d6a779",
  "#94a3b8", "#cbd5e1", "#bef264", "#5eead4", "#fda4af",
];
/** Keep color selection inside the WebView: native color wells can crash NSColorPanel. */
export function ColorField({ label, value, onChange, disabled = false, compact = false }: {
  label: string; value: string; onChange: (color: string) => void; disabled?: boolean; compact?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!compact || !expanded) return;
    const close = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setExpanded(false); setDraft(value); }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [compact, expanded, value]);
  const valid = /^#[0-9a-f]{6}$/i.test(draft);
  const commit = () => {
    if (disabled) return;
    if (valid) { setExpanded(false); if (draft.toLowerCase() !== value.toLowerCase()) onChange(draft.toLowerCase()); }
    else setDraft(value);
  };
  return <span ref={root} className={`color-field ${compact ? "color-field-compact" : ""}`} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setExpanded(false); setDraft(value); } }}>
    <span className="color-field-controls">
      <Button type="button" variant="outline" size="icon" aria-label={`Choose ${label.toLowerCase()}`} aria-expanded={expanded} disabled={disabled} onClick={() => setExpanded(open => !open)}>
        <span className="color-field-preview" style={{ backgroundColor: value }} aria-hidden="true" />
      </Button>
      {!compact && <Input aria-label={label} value={draft} disabled={disabled} placeholder="#b59ae9" maxLength={7} spellCheck={false} autoCapitalize="off" aria-invalid={!valid} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(value); setExpanded(false); }
        }} />}

    </span>
    {expanded && <span className="color-field-picker">
    <span className="color-field-palette" role="group" aria-label={`${label} presets`}>
      {palette.map(color => <button key={color} type="button" className="color-field-swatch" style={{ backgroundColor: color }} aria-label={`${label}: ${color}`} aria-pressed={value.toLowerCase() === color} disabled={disabled}
        onClick={e => { e.preventDefault(); setExpanded(false); setDraft(color); onChange(color); }} />)}
    </span>
    {compact && <Input aria-label={label} value={draft} disabled={disabled} placeholder="#b59ae9" maxLength={7} spellCheck={false} autoCapitalize="off" aria-invalid={!valid} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(value); setExpanded(false); }
        }} />}
    {compact && <Button type="button" variant="outline" disabled={disabled || !valid} onClick={commit}>Apply color</Button>}
    </span>}
  </span>;
}
