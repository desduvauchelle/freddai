import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Calendar, CodeXml, FileText, Mail, Sparkles, SquareCheck, User, Zap, type LucideIcon } from "lucide-react";
import type { Item } from "../api";

export type PillVariant = "neutral" | "danger" | "focus" | "backlog" | "success" | "purple";

/** Count / status chip. `danger` is the red "needs you" chip, `focus` is dark. */
export function Pill({ variant = "neutral", icon, children, className, title }: {
  variant?: PillVariant; icon?: ReactNode; children: ReactNode; className?: string; title?: string;
}) {
  return <span className={cx("sc-pill", `sc-pill--${variant}`, className)} title={title}>{icon}{children}</span>;
}

const kindIcons: Record<Item["kind"], LucideIcon> = {
  email: Mail,
  meeting: Calendar,
  task: SquareCheck,
  contact: User,
  note: FileText,
  code: CodeXml,
};
const kindLabels: Record<Item["kind"], string> = {
  email: "Email", meeting: "Meeting", task: "Task", contact: "Contact", note: "Note", code: "Code",
};

export function KindIcon({ kind, size = 16, className }: { kind: Item["kind"]; size?: number; className?: string }) {
  const Icon = kindIcons[kind] ?? FileText;
  return <Icon size={size} strokeWidth={1.8} className={cx("sc-kind-icon", className)} role="img" aria-label={kindLabels[kind] ?? kind} />;
}

const statusLabels: Record<Item["status"], string> = {
  needs_you: "Needs you", agent_working: "Agent working", ready: "Ready", none: "",
};

/** needs_you: red "!" circle, agent_working: purple sparkle, ready: green bolt, none: nothing. */
export function StatusDot({ status, className }: { status: Item["status"]; className?: string }) {
  if (status === "none") return null;
  const label = statusLabels[status];
  return <span className={cx("sc-status", `sc-status--${status}`, className)} role="img" aria-label={label} title={label}>
    {status === "needs_you" && <span aria-hidden>!</span>}
    {status === "agent_working" && <Sparkles size={10} strokeWidth={2.4} aria-hidden />}
    {status === "ready" && <Zap size={10} strokeWidth={2.4} aria-hidden />}
  </span>;
}

/** Rounded letter avatar (workspace / project / agent). */
export function Avatar({ name, color, size = 20, className }: { name: string; color?: string; size?: number; className?: string }) {
  const style: CSSProperties = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.5)), background: color ?? "var(--scout-muted)" };
  return <span className={cx("sc-avatar", className)} style={style} aria-hidden>{(name.trim()[0] ?? "?").toUpperCase()}</span>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode };

/** Dark pill button (primary action, e.g. "Let's go"). */
export function DarkButton({ icon, children, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={cx("sc-btn", "sc-btn--dark", className)} {...rest}>{icon}{children}</button>;
}

/** White bordered pill button (secondary action, e.g. "+ Add"). */
export function GhostButton({ icon, children, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={cx("sc-btn", "sc-btn--ghost", className)} {...rest}>{icon}{children}</button>;
}

/** Section heading with an optional muted count/meta and right-side slot. */
export function SectionTitle({ children, meta, action, as: Tag = "h2", className }: {
  children: ReactNode; meta?: ReactNode; action?: ReactNode; as?: "h1" | "h2" | "h3"; className?: string;
}) {
  return <div className={cx("sc-section-title", className)}>
    <Tag className="sc-section-title__text">{children}</Tag>
    {meta != null && <span className="sc-section-title__meta">{meta}</span>}
    {action != null && <span className="sc-section-title__action">{action}</span>}
  </div>;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
