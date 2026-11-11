import { FolderGit2, Layers, CircleDot, X } from 'lucide-react';
import { Badge } from '@freddai/ui/components/badge';
import './active-filter-chips.css';

export type ActiveFilterChip = { kind: 'workspace' | 'project' | 'status'; label: string; onClear: () => void };

const icons = { workspace: Layers, project: FolderGit2, status: CircleDot };

/** One dismissible pill per active sidebar filter, shown under the search field. Renders nothing when no filter is active. */
export function ActiveFilterChips({ chips }: { chips: ActiveFilterChip[] }) {
  if (!chips.length) return null;
  return <div className="active-filter-chips" role="list" aria-label="Active filters">
    {chips.map(chip => {
      const Icon = icons[chip.kind];
      return <Badge key={chip.kind} variant="outline" className="active-filter-chip" data-kind={chip.kind} role="listitem">
        <Icon aria-hidden="true" />
        <span className="active-filter-chip-label" title={chip.label}>{chip.label}</span>
        <button type="button" className="active-filter-chip-clear" aria-label={`Remove ${chip.kind} filter ${chip.label}`} onClick={chip.onClear}><X aria-hidden="true" /></button>
      </Badge>;
    })}
  </div>;
}
