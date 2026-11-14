import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Calendar, Gamepad2, Hash, Mail, MessageCircle, Phone, Plug, Video, X, type LucideIcon } from "lucide-react";
import type { Source } from "../api";
import { cx } from "../ui";

export type SourceKind = Source["kind"];
export type SourceAccess = Source["access"];

export const SOURCE_KINDS: { kind: SourceKind; label: string; icon: LucideIcon }[] = [
  { kind: "gmail", label: "Gmail", icon: Mail },
  { kind: "slack", label: "Slack", icon: Hash },
  { kind: "calendar", label: "Google Calendar", icon: Calendar },
  { kind: "meet", label: "Google Meet", icon: Video },
  { kind: "imessage", label: "iMessage", icon: MessageCircle },
  { kind: "whatsapp", label: "WhatsApp", icon: Phone },
  { kind: "discord", label: "Discord", icon: Gamepad2 },
  { kind: "custom", label: "Custom", icon: Plug },
];

export const ACCESS_LABELS: Record<SourceAccess, string> = {
  direct: "Direct",
  computer_use: "Computer use",
  browser: "Browser",
};

export const STATUS_LABELS: Record<Source["status"], string> = {
  connected: "Connected",
  needs_sign_in: "Needs sign-in",
  not_connected: "Not connected yet",
};

export function sourceKindLabel(kind: SourceKind): string {
  return SOURCE_KINDS.find(k => k.kind === kind)?.label ?? kind;
}

export function SourceKindIcon({ kind, size = 15 }: { kind: SourceKind; size?: number }) {
  const Icon = SOURCE_KINDS.find(k => k.kind === kind)?.icon ?? Plug;
  return <Icon size={size} strokeWidth={1.9} role="img" aria-label={sourceKindLabel(kind)} className="st-kind-icon" />;
}

/** Display name for a source, unique enough to tell two Gmail inboxes apart. */
export function sourceName(source: Pick<Source, "label" | "detail">): string {
  return source.detail.trim() ? `${source.label} · ${source.detail.trim()}` : source.label;
}

export const PALETTE = ["#3b6cf6", "#7c5cff", "#e08a1e", "#2fb344", "#f0582c", "#e5484d", "#12a37a", "#8a8a8a"];

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

/** Runs an action and keeps its error visible locally (the store also shows it). */
export function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      console.error("[scout] action failed", e);
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, error, busy, clearError: () => setError(null) };
}

export function InlineError({ error, onDismiss }: { error: string | null; onDismiss?: () => void }) {
  if (!error) return null;
  return <div className="st-error" role="alert">
    <span>{error}</span>
    {onDismiss && <button type="button" className="st-error__close" aria-label="Dismiss error" onClick={onDismiss}><X size={13} /></button>}
  </div>;
}

/** Small dialog: Escape closes, focus moves into it on open and back on close. */
export function Modal({ title, subtitle, onClose, children, footer, wide }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.st-modal__close)");
    first?.focus();
    return () => previous?.focus?.();
  }, []);
  return <div className="st-modal-layer" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} className={cx("st-modal", wide && "st-modal--wide")} role="dialog" aria-modal="true" aria-label={title}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="st-modal__head">
        <div>
          <h2 className="st-modal__title">{title}</h2>
          {subtitle && <p className="st-modal__subtitle">{subtitle}</p>}
        </div>
        <button type="button" className="st-modal__close sc-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="st-modal__body">{children}</div>
      {footer && <div className="st-modal__foot">{footer}</div>}
    </div>
  </div>;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
    className={cx("st-switch", checked && "is-on")} onClick={() => onChange(!checked)}>
    <span className="st-switch__knob" />
  </button>;
}
