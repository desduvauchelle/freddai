import { ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@freddai/ui/components/button";
import { Input } from "@freddai/ui/components/input";
import { ScrollArea } from "@freddai/ui/components/scroll-area";
import type { Pending } from "./types";
export function Permission({
  pending,
  provider,
  onReply,
}: {
  pending: Pending;
  provider: string;
  onReply: (allow: boolean, answers: Record<string, unknown>) => void | Promise<unknown>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<{ allow: boolean; sent: boolean } | null>(null);
  const [error, setError] = useState("");
  const locked = useRef(false);
  async function reply(allow: boolean, values: Record<string, unknown>) {
    if (locked.current) return;
    locked.current = true;
    setError(""); setDecision({ allow, sent: false });
    try {
      await onReply(allow, values);
      setDecision({ allow, sent: true });
    } catch (e) {
      locked.current = false; setDecision(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  if (decision) return <section className="approval-card" aria-label="Agent request"><p role="status">{decision.allow ? (pending.method === "item/tool/requestUserInput" || pending.request?.tool_name === "AskUserQuestion" ? "Answers submitted" : "Allowed once") : "Declined"}{decision.sent ? " · Waiting for agent…" : " · Sending…"}</p></section>;
  const raw =
    (provider !== "claude" ? pending.params : pending.request?.input) || {};
  const questions = (Array.isArray(raw.questions) ? raw.questions : []) as {
    id?: string;
    question: string;
    header?: string;
    options?: { label: string; description?: string }[];
  }[];
  const isQuestion =
    provider === "codex"
      ? pending.method === "item/tool/requestUserInput"
      : pending.request?.tool_name === "AskUserQuestion";
  const reason = typeof raw.reason === "string" ? raw.reason : typeof raw.justification === "string" ? raw.justification : "The agent needs your permission to continue.";
  const command = typeof raw.command === "string" ? raw.command : Array.isArray(raw.command) ? raw.command.join(" ") : Array.isArray(raw.proposedExecpolicyAmendment) ? raw.proposedExecpolicyAmendment.join(" ") : null;
  const tool = pending.request?.tool_name || (pending.method?.includes("commandExecution") ? "Run command" : pending.method?.includes("fileChange") ? "Change files" : "Use tool");
  return (
    <section className="approval-card" aria-label="Agent request">
      <header className="approval-heading">
        <ShieldCheck size={18} aria-hidden="true" />
        <strong>{isQuestion ? "Your input is needed" : "Approval needed"}</strong>
        {!isQuestion && <span>{tool}</span>}
      </header>
      {!isQuestion && <p>{reason}</p>}
      {isQuestion ? (
        questions.map((q, i) => (
          <fieldset key={i}>
            <legend>{q.question}</legend>
            {q.options?.map((o) => (
              <Button
                type="button"
                variant="outline"
                key={o.label}
                aria-pressed={answers[q.id || q.question] === o.label}
                onClick={() =>
                  setAnswers((a) => ({ ...a, [q.id || q.question]: o.label }))
                }
              >
                {o.label}
              </Button>
            ))}
            <Input
              aria-label={q.question}
              placeholder="Or type an answer"
              value={answers[q.id || q.question] || ""}
              onChange={(e) =>
                setAnswers((a) => ({
                  ...a,
                  [q.id || q.question]: e.target.value,
                }))
              }
            />
          </fieldset>
        ))
      ) : (
        <>
          {command && <pre className="approval-command"><code>{command}</code></pre>}
          {typeof raw.cwd === "string" && <p className="approval-directory">In {raw.cwd}</p>}
          <details className="approval-details">
            <summary>Technical details</summary>
            <ScrollArea orientation="both" viewportProps={{ style: { maxHeight: 240 }, "aria-label": "Agent request details" }}><pre>{JSON.stringify(raw, null, 2)}</pre></ScrollArea>
          </details>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="approval-actions">
        <Button
          onClick={() =>
            void reply(
              true,
              provider === "codex" && isQuestion
                ? Object.fromEntries(
                    Object.entries(answers).map(([k, v]) => [
                      k,
                      { answers: [v] },
                    ]),
                  )
                : answers,
            )
          }
          disabled={
            isQuestion &&
            (!questions.length ||
              questions.some((q) => !answers[q.id || q.question]?.trim()))
          }
        >
          {isQuestion ? "Send answers" : "Allow once"}
        </Button>
        {!isQuestion && (
          <Button variant="outline" onClick={() => void reply(false, {})}>
            Decline
          </Button>
        )}
      </div>
    </section>
  );
}
