import { RotateCw } from "lucide-react";
import { GhostButton } from "../ui";

export type ErrorEntry = { source: string; message: string };

/** Sticky red bar listing every current failure. Never auto-hides: it goes away only when
 *  the underlying error clears (e.g. after Retry succeeds). */
export function ErrorBar({ errors, onRetry, retrying }: { errors: ErrorEntry[]; onRetry: () => void; retrying?: boolean }) {
  if (errors.length === 0) return null;
  return <div className="sc-errorbar" role="alert">
    <ul className="sc-errorbar__list">
      {errors.map((e, i) => <li key={`${e.source}-${i}`}><strong>{e.source}</strong>{e.message}</li>)}
    </ul>
    <GhostButton icon={<RotateCw size={14} aria-hidden />} onClick={onRetry} disabled={retrying}>Retry</GhostButton>
  </div>;
}
