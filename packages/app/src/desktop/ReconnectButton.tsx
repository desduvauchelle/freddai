import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@freddai/ui/components/button";
import { canReconnect } from "./reconnect";
import { reportLoginSuccess } from "./accountAuth";

type LoginProgress = { status: string; error: string | null; url?: string | null } | null;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** Re-runs the provider sign-in on an existing account (same id, name, colour, default) via the `login` command, then
 * polls `login_state` until it finishes. Failures are shown inline. */
export function ReconnectButton({ account, provider, label = "Reconnect", size = "sm", variant = "outline", onReconnected }: {
  account: string; provider: string; label?: string; size?: "sm" | "default"; variant?: "outline" | "default" | "ghost"; onReconnected?: () => void;
}) {
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  const run = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!canReconnect(provider)) return null;
  async function start() {
    const mine = ++run.current;
    setState("pending"); setError(""); setUrl(""); setCopied(false);
    try {
      await invoke("login", { account });
      const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
      for (;;) {
        await new Promise(r => setTimeout(r, 1000));
        if (!alive.current || run.current !== mine) return;
        const progress = await invoke<LoginProgress>("login_state", { account });
        if (progress?.status === "ready") {
          // Login only proves credentials were written: verify live, and let every surface pick up the result.
          void reportLoginSuccess(account);
          setState("idle"); onReconnected?.(); return;
        }
        if (progress?.status === "cancelled") { setState("idle"); return; }
        if (progress && progress.status !== "pending") throw new Error(progress.error || "Sign-in did not complete. Try again.");
        if (!progress) throw new Error("Sign-in did not complete. Try again.");
        if (progress.url) setUrl(progress.url);
        if (Date.now() > deadline) {
          await invoke("cancel_login", { account }).catch(e => console.error("[reconnect] cancel after timeout failed", e));
          throw new Error("Sign-in timed out. Try again.");
        }
      }
    } catch (e) {
      console.error("[reconnect] failed", e);
      if (alive.current) { setState("error"); setError(e instanceof Error ? e.message : String(e)); }
    }
  }
  async function cancel() {
    run.current++; // stop the poll loop
    try { await invoke("cancel_login", { account }); } catch (e) { console.error("[reconnect] cancel failed", e); }
    if (alive.current) { setState("idle"); setUrl(""); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch (e) { console.error("[reconnect] copy failed", e); setError("Could not copy the link."); }
  }
  return <span className="reconnect-action">
    <Button type="button" size={size} variant={variant} disabled={state === "pending"} onClick={() => void start()}>
      {state === "pending" ? "Waiting for sign-in…" : label}
    </Button>
    {state === "pending" && <>
      <span role="status" className="capture-help">Complete sign-in in your browser.</span>
      {url && <Button type="button" size={size} variant="ghost" onClick={() => void copyLink()}>{copied ? "Link copied" : "Copy sign-in link"}</Button>}
      <Button type="button" size={size} variant="ghost" onClick={() => void cancel()}>Cancel</Button>
    </>}
    {state === "error" && <span role="alert" className="inline-error">{error}</span>}
  </span>;
}
