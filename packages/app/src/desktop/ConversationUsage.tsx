import { PopoverDetails } from "./PopoverDetails";
import { usageLabels, type ConversationUsage as Usage } from "./conversation-usage";
export function ConversationUsage({ usage }: { usage?: Usage | null }) {
  const labels = usageLabels(usage);
  if (!labels.context && !labels.cache) return null;
  return <PopoverDetails className="conversation-usage">
    <summary aria-label={`${[labels.context, labels.cache].filter(Boolean).join(". ")}. View last reported usage.`}>
      {labels.context && <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" className="context-track"/>{labels.remaining !== null && labels.remaining > 0 && <circle cx="12" cy="12" r="9" className="context-fill" pathLength="100" strokeDasharray={`${labels.remaining} 100`}/>}</svg>}
      {labels.context && <span>{labels.context}</span>}{labels.cache && <span>{labels.cache}</span>}
    </summary>
    <div className="conversation-usage-details">
      <strong>Last reported request</strong>
      {labels.context && <p>{usage?.context_tokens?.toLocaleString()} tokens / {usage?.context_window?.toLocaleString()} context window</p>}
      {typeof usage?.cached_input_tokens === "number" && Number.isFinite(usage.cached_input_tokens) && usage.cached_input_tokens >= 0 && <p>{usage?.cached_input_tokens?.toLocaleString()} cached input tokens</p>}
      <p>Cached tokens describe reuse by the last request. Your unsent draft is excluded.</p>
    </div>
  </PopoverDetails>;
}
