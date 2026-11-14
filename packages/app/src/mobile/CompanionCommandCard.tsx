import { CommandReview } from '../conversation/CommandReview';
import { formatProjectName } from "../projectName";
import { ComposerAgentPicker } from '../desktop/ComposerAgentPicker';
import { useCallback } from 'react';
import type { AgentSelection } from '../desktop/agent-selection';
import type { CommandReviewProps } from '../desktop/DashboardCall';
import type { CompanionProject, CompanionClient } from './companion';
import { assistantLabel } from './native-home';
import '../desktop/CommandCard.css';

/** Uses only assistants actually advertised by the paired Mac. */
export function CompanionCommandCard({ draft, projects, assistant, onAssistant, onChangeInstruction, onSend, onDismiss, error, sending, client, selection, onSelection, modelConfiguration, projectNameUppercase }: CommandReviewProps & {
  projectNameUppercase?: boolean;
  modelConfiguration?: import("../desktop/model-levels").ModelConfiguration;
  client: CompanionClient; selection: AgentSelection; onSelection: (selection: AgentSelection) => void; projects: CompanionProject[]; assistant: string; onAssistant: (id: string) => void;
}) {
  const project = projects.find(p => p.id === draft.projectId);
  const provider = project?.assistants?.find(a => a.id === assistant)?.provider || project?.provider;
  const loadModels = useCallback(() => client.models!({ project: draft.projectId, assistant: assistant || undefined }), [client, draft.projectId, assistant]);
  const ready = !!project?.canStart && (!project.assistants || project.assistants.some(a => a.id === assistant));
  return <CommandReview title={formatProjectName(project?.name, projectNameUppercase)} color={project?.color} instruction={draft.instruction} onChange={onChangeInstruction}
    onSend={onSend} onDismiss={onDismiss} sending={!!sending} ready={ready} error={error}
    notice={!ready && <p role="status">Choose a project agent that is ready on your Mac.</p>}
    controls={<ComposerAgentPicker options={(project?.assistants || []).map(a => ({ id: a.id, label: assistantLabel(a), provider: a.provider, color: a.color }))} agent={assistant} onAgentChange={onAssistant} provider={provider} modelConfiguration={modelConfiguration} native={!!client.models} loadModels={client.models ? loadModels : undefined} value={selection} onChange={onSelection} disabled={sending}/>} />;
}
