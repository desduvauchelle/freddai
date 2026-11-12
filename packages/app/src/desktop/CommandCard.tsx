import { formatProjectName } from "../projectName";
import { ComposerAgentPicker } from './ComposerAgentPicker';
import { X } from 'lucide-react';
import type { CommandDraft } from './commandCenter';
import { agentDisplayName, type Account, type Project } from './types';
import './CommandCard.css';

export type CommandSelection = { accountId: string; model: string; effort: string; speed?: string };

/** Review card for a spoken dashboard command: project, editable instruction, agent/model/difficulty, Send and dismiss. */
export function CommandCard({ draft, projects, accounts, native, selection, onChangeSelection, onChangeInstruction, onSend, onDismiss, error, sending = false, modelConfiguration, projectNameUppercase }: {
  projectNameUppercase?: boolean;
  modelConfiguration?: import("./model-levels").ModelConfiguration;
  draft: CommandDraft; projects: Project[]; accounts: Account[]; native: boolean; selection: CommandSelection;
  onChangeSelection: (selection: CommandSelection) => void; onChangeInstruction: (text: string) => void;
  onSend: () => void; onDismiss: () => void; error?: string; sending?: boolean;
}) {
  const project = projects.find(p => p.id === draft.projectId);
  const account = accounts.find(a => a.id === selection.accountId);
  return <section className="command-card" aria-label="Command review">
    <div className="command-card-head">
      <span className="command-card-dot" style={{ background: project?.color || '#888' }} aria-hidden />
      <span>{project ? formatProjectName(project.name, projectNameUppercase) : 'Unknown project'}</span>
      <button type="button" aria-label="Cancel command" title="Cancel" onClick={onDismiss}><X size={14} /></button>
    </div>
    <textarea aria-label="Instruction" value={draft.instruction} onChange={e => onChangeInstruction(e.target.value)} />
    <div className="command-card-selectors">
      <ComposerAgentPicker options={accounts.map(a => ({ id: a.id, label: agentDisplayName(a), account: a }))} agent={selection.accountId} onAgentChange={id => onChangeSelection({ accountId: id, model: 'freddai-level:normal', effort: 'default' })} account={account} native={native} modelConfiguration={modelConfiguration} value={selection} onChange={v => onChangeSelection({ ...selection, model: v.model, effort: v.effort, speed: v.speed })} disabled={sending}/>

    </div>
    {error && <p role="alert" className="command-card-error">{error}</p>}
    <div className="command-card-actions">
      <button type="button" disabled={sending || !draft.instruction.trim() || !account} onClick={onSend}>{sending ? 'Sending…' : 'Send'}</button>
      <p className="command-card-hint">Say "go" to send, "cancel" to dismiss</p>
    </div>
  </section>;
}
