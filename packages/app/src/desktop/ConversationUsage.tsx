import { PopoverDetails } from "./PopoverDetails";
import { usageLabels, type ConversationUsage as Usage } from "./conversation-usage";
export function ConversationUsage({ usage }: { usage?: Usage | null }) {
  const labels = usageLabels(usage);
  if (!labels.context && !labels.cache) return null;
  return <PopoverDetails className="conversation-usage">
    <summary aria-label={`${[labels.context, labels.cache].filter(Boolean).join(". ")}. View last reported usage.`}>
      {labels.context && <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" className="context-track"/>{labels.percent !== null && <circle cx="12" cy="12" r="9" className="context-fill" strokeDasharray={`${labels.percent * .56549} 56.549`}/>}</svg>}
      {labels.context && <span>{labels.context}</span>}{labels.cache && <span>{labels.cache}</span>}
    </summary>
    <div className="conversation-usage-details">
      <strong>Last reported request</strong>
      {labels.context && <p>{usage?.context_tokens?.toLocaleString()} tokens / {usage?.context_window?.toLocaleString()} context window</p>}
      {labels.cache && <p>{usage?.cached_input_tokens?.toLocaleString()} cached input tokens</p>}
      <p>The provider does not report when cached input expires, so time remaining is unknown. Cached tokens describe reuse by the last request, not how long the cache will remain available. Your unsent draft is excluded.</p>
    </div>
  </PopoverDetails>;
}
