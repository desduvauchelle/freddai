const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const label = (k: string) => k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
const brief = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() ? clip(v, 60) : null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
  return null;
};
const IDS = /^(id|thread|session|request_id|task|todo|todo_id)$/;

/** Human line for a proposal's result. Never returns raw JSON: structured results become a short sentence. */
export function formatProposalResult(result: string | null | undefined): string {
  const text = (result ?? "").trim();
  if (!text) return "Approved.";
  if (!/^[{[]/.test(text)) return text;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return "Done."; }
  if (!value || typeof value !== "object") return "Done.";
  if (Array.isArray(value)) return value.length ? `Done (${value.length} item${value.length === 1 ? "" : "s"}).` : "Done.";
  const obj = value as Record<string, unknown>;
  if (typeof obj.thread === "string" && Object.keys(obj).every(k => IDS.test(k))) return "Started";
  if (typeof obj.message === "string" && obj.message.trim()) return clip(obj.message.trim());
  const parts = Object.entries(obj).filter(([k]) => !IDS.test(k)).map(([k, v]) => { const b = brief(v); return b ? `${label(k)}: ${b}` : null; }).filter(Boolean);
  if (parts.length) return clip(parts.slice(0, 3).join(" · "));
  return typeof obj.thread === "string" ? "Started" : "Done.";
}
