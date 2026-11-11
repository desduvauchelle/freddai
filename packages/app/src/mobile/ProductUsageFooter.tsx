import { useState } from 'react';
import type { CompanionProductUsage } from './companion';
import { productUsageCards } from './product-usage';

function UsageRow({ label, text, remaining, aria }: { label: string; text: string | null; remaining: number | null; aria: string }) {
  if (text === null) return null;
  return <div className="companion-usage-row">
    <div className="companion-usage-top"><span className="companion-usage-label">{label}</span><span className="companion-usage-capacity">{text}</span></div>
    <progress max={100} value={100 - (remaining ?? 100)} aria-label={aria} aria-valuetext={text} data-low={remaining !== null && remaining < 20} />
  </div>;
}

export function ProductUsageFooter({ products }: { products?: CompanionProductUsage[] }) {
  const [expanded, setExpanded] = useState(false);
  const cards = productUsageCards(products);
  if (!cards.length) return null;
  return <footer className="companion-product-usage" aria-label="Product usage">
    <div className="companion-usage-heading"><strong>Usage</strong><button type="button" aria-expanded={expanded} aria-controls="companion-usage-details" onClick={() => setExpanded(v => !v)}>{expanded ? 'Hide details' : 'Details'} <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></button></div>
    <div className="companion-usage-grid">{cards.map(card => <div className="companion-usage-card" key={card.id}>
      <div className="companion-usage-identity"><strong>{card.product}</strong><span>{card.name}</span></div>
      {card.status ? <div className="companion-usage-status">{card.status}{card.stale ? ' · last known' : ''}</div> : <>
        <UsageRow label="5h" text={card.session} remaining={card.sessionRemaining} aria={`${card.product}, ${card.name}, 5 hour remaining`} />
        <UsageRow label="Week" text={card.weekly} remaining={card.weeklyRemaining} aria={`${card.product}, ${card.name}, weekly remaining`} />
      </>}
    </div>)}</div>
    {expanded && <div id="companion-usage-details">{cards.map(card => <p key={card.id}>{card.details}</p>)}</div>}
  </footer>;
}
