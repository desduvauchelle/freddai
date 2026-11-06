export type ResetCredit = {
  id: string;
  title: string | null;
  status: string;
  expires_at: number | null;
  expiry_known: boolean;
};
export type ResetCredits = { available_count: number; credits: ResetCredit[] | null };

export function resetExpiry(credit: ResetCredit, now: number): string {
  if (!credit.expiry_known) return "Expiry date unavailable";
  if (credit.expires_at === null) return "Does not expire";
  const date = new Date(credit.expires_at * 1000).toLocaleString([], {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
  const remaining = credit.expires_at * 1000 - now;
  if (remaining <= 0) return `Expired ${date}`;
  const [count, unit] = remaining >= 86400000
    ? [Math.floor(remaining / 86400000), "day"]
    : remaining >= 3600000
      ? [Math.floor(remaining / 3600000), "hour"]
      : [Math.ceil(remaining / 60000), "minute"];
  return `Expires in ${count} ${unit}${count === 1 ? "" : "s"} · ${date}`;
}
export function availableResets(resets: ResetCredits): ResetCredit[] {
  return (resets.credits || []).filter(c => c.status === "available").sort((a, b) =>
    (a.expires_at ?? Infinity) - (b.expires_at ?? Infinity));
}

export function resetOutcome(outcome: string): string {
  switch (outcome) {
    case "reset": return "Reset used. Refreshing your usage limits…";
    case "alreadyRedeemed": return "This reset was already used. Refreshing your usage limits…";
    case "nothingToReset": return "No eligible usage limit needs a reset. No reset was used.";
    case "noCredit": return "This reset is no longer available. Refreshing your balance…";
    default: return "Reset outcome unavailable. Refresh usage before trying again.";
  }
}
