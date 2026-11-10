import { useState } from 'react';
import type { CompanionProductUsage } from './companion';
import { productUsageCards } from './product-usage';

export function ProductUsageFooter({ products }: { products?: CompanionProductUsage[] }) {
  const [expanded, setExpanded] = useState(false);
  const cards = productUsageCards(products);
  if (!cards.length) return null;
  return <footer className="companion-product-usage" aria-label="Product usage">
    <div className="companion-usage-heading"><strong>Usage</strong><button type="button" aria-expanded={expanded} aria-controls="companion-usage-details" onClick={() => setExpanded(v => !v)}>{expanded ? 'Hide details' : 'Details'} <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></button></div>
    <div className="companion-usage-grid">{cards.map(card => <div className="companion-usage-card" key={card.id}>
      <div className="companion-usage-identity"><strong>{card.product}</strong><span>{card.name}</span></div>
      <div className="companion-usage-top"><div className="companion-usage-capacity" data-unavailable={card.remaining === null}>{card.capacity}</div><span className="companion-usage-reset">{card.remaining === null ? '' : card.stale ? 'Last known' : card.reset.replace('Resets in ', 'Reset ')}</span></div>
      <progress max={100} value={card.remaining ?? 0} aria-label={`${card.product}, ${card.name}, remaining capacity`} aria-valuetext={card.capacity} data-low={card.remaining !== null && card.remaining < 20} />
    </div>)}</div>
    {expanded && <div id="companion-usage-details">{cards.map(card => <p key={card.id}>{card.details}</p>)}</div>}
  </footer>;
}
