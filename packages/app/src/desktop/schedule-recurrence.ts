/** Deliberately small grammar: reject ambiguous requests rather than guess a time. */
export function recurrenceCron(text: string): string | null {
  const match = text.trim().match(/^(?:every\s+)?(day|daily|weekday|weekdays|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3] || 0), meridiem = match[4]?.toLowerCase();
  if (minute > 59 || hour > (meridiem ? 12 : 23) || (meridiem && hour < 1)) return null;
  if (meridiem) hour = hour % 12 + (meridiem === 'pm' ? 12 : 0);
  const day = match[1].toLowerCase();
  const weekday = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(day);
  return `${minute} ${hour} * * ${weekday >= 0 ? weekday : day.startsWith('weekday') ? '1-5' : '*'}`;
}
