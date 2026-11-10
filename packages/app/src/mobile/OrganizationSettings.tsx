import { useState } from 'react';
import { Button } from '@freddai/ui/components/button';
import { Input } from '@freddai/ui/components/input';
import { ColorField } from '../desktop/ColorField';
import type { CompanionProject, CompanionSnapshot } from './companion';

function ProjectEditor({ project, disabled, onSave }: {
  project: CompanionProject; disabled: boolean;
  onSave: (id: string, name: string, color: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  return <form className="companion-organization-project" aria-label={`Edit ${project.name}`} onSubmit={async e => {
    e.preventDefault();
    if (!disabled && name.trim() && /^#[0-9a-f]{6}$/i.test(color)) await onSave(project.id, name.trim(), color);
  }}>
    <label>Project name<Input aria-label={`Project name for ${project.name}`} value={name} disabled={disabled} maxLength={200} onChange={e => setName(e.target.value)}/></label>
    <ColorField label={`Project color for ${project.name}`} value={color} disabled={disabled} onChange={setColor}/>
    <Button type="submit" disabled={disabled || !name.trim() || (name.trim() === project.name && color === project.color)}>Save project</Button>
  </form>;
}

export function OrganizationSettings({ snapshot, disabled, onSave, onMove }: {
  snapshot: CompanionSnapshot; disabled: boolean;
  onSave?: (id: string, name: string, color: string) => Promise<unknown>;
  onMove?: (id: string, target: string, after: boolean) => Promise<unknown>;
}) {
  const order = [...new Set([...(snapshot.threadList?.projectOrder ?? []), ...snapshot.projects.map(p => p.id)])];
  const projects = order.flatMap(id => snapshot.projects.find(p => p.id === id) ?? []);
  return <section aria-label="Project organization" className="space-y-4">
    <h2>Projects</h2>
    <p>Names, colors, and sorting sync with your Mac and other companions.</p>
    {!projects.length && <p>Your Mac has no projects yet.</p>}
    {projects.map((project, index) => <div key={project.id} className="companion-organization-card">
      {onSave ? <ProjectEditor key={`${project.id}:${project.name}:${project.color}`} project={project} disabled={disabled} onSave={onSave}/> : <h3>{project.name}</h3>}
      {onMove && snapshot.canReorderProjects && <div className="flex gap-2">
        <Button variant="outline" disabled={disabled || index === 0} aria-label={`Move ${project.name} up`} onClick={() => void onMove(project.id, projects[index - 1].id, false)}>Move up</Button>
        <Button variant="outline" disabled={disabled || index === projects.length - 1} aria-label={`Move ${project.name} down`} onClick={() => void onMove(project.id, projects[index + 1].id, true)}>Move down</Button>
      </div>}
    </div>)}
  </section>;
}
