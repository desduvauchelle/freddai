export type ConversationUsage = {
  context_tokens: number | null;
  context_window: number | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
};
export function usageLabels(usage?: ConversationUsage | null) {
  const tokens = usage?.context_tokens, window = usage?.context_window;
  const percent = typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0 && typeof window === "number" && Number.isFinite(window) && window > 0
    ? Math.min(100, Math.max(0, tokens / window * 100)) : null;
  return {
    percent,
    context: percent === null ? null : `Context ${Math.round(percent)}%`,
    // Cached token counts do not establish a cache expiry.
    cache: null,
  };
}
