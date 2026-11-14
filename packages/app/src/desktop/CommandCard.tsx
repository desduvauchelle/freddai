import { CommandReview } from '../conversation/CommandReview';
import { formatProjectName } from "../projectName";
import { ComposerAgentPicker } from './ComposerAgentPicker';
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
  return <CommandReview title={project ? formatProjectName(project.name, projectNameUppercase) : 'Unknown project'} color={project?.color} instruction={draft.instruction} onChange={onChangeInstruction}
    onSend={onSend} onDismiss={onDismiss} sending={!!sending} ready={!!account} error={error}
    controls={<ComposerAgentPicker options={accounts.map(a => ({ id: a.id, label: agentDisplayName(a), account: a }))} agent={selection.accountId} onAgentChange={id => onChangeSelection({ accountId: id, model: 'freddai-level:normal', effort: 'default' })} account={account} native={native} modelConfiguration={modelConfiguration} value={selection} onChange={v => onChangeSelection({ ...selection, model: v.model, effort: v.effort, speed: v.speed })} disabled={sending}/>} />;
}
