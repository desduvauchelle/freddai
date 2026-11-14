import { useRef, useState } from 'react';
import { Button } from '@freddai/ui/components/button';
import { ComposerAgentPicker, type AssistantOption } from '../desktop/ComposerAgentPicker';
import type { AgentSelection, Model } from '../desktop/agent-selection';
import type { Message } from '../desktop/types';
import type { ModelConfiguration } from '../desktop/model-levels';

export function failedTurnMessage(messages: Message[]) {
  return [...messages].reverse().find(message => message.role === 'user' && (message.text.trim() || message.attachments?.length));
}

/** Recovery is explicit: keep the failed conversation and drafts, and start a fresh attempt. */
export function FailedTurnRecovery({ messages, options, initialAgent, initialSelection, native, disabled, modelConfiguration, loadModels, onResend }: {
  messages: Message[]; options: AssistantOption[]; initialAgent: string; initialSelection: AgentSelection;
  native: boolean; disabled?: boolean; modelConfiguration?: ModelConfiguration;
  loadModels?: (agent: string) => Promise<Model[]>;
  onResend: (message: Message, selection: AgentSelection, requestId: string) => Promise<void>;
}) {
  const [selection, setSelection] = useState<AgentSelection>({ ...initialSelection, agent: initialAgent });
  const [sending, setSending] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false), request = useRef({ signature: '', id: '' });
  const message = failedTurnMessage(messages);
  const agent = options.find(option => option.id === selection.agent);
  if (!message) return null;
  return <section aria-label="Failed message recovery" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBlock: 16 }}>
    <p style={{ flexBasis: '100%', margin: 0 }}>Change model and resend the last message in a new thread. Attachments are included.</p>
    <ComposerAgentPicker options={options} agent={selection.agent || ''} account={agent?.account} provider={agent?.provider || agent?.account?.provider}
      onAgentChange={agent => setSelection({ agent, model: 'freddai-level:normal', effort: 'default' })}
      native={native} modelConfiguration={modelConfiguration} value={selection} onChange={value => setSelection({ ...value, agent: selection.agent })}
      loadModels={loadModels ? () => loadModels(selection.agent || '') : undefined} disabled={disabled || sending}/>
    <Button disabled={disabled || sending || !agent} onClick={async () => {
      if (inFlight.current) return;
      inFlight.current = true; setSending(true); setError('');
      const signature = JSON.stringify([message, selection]);
      if (request.current.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
      try { await onResend(message, selection, request.current.id); }
      catch (error) { setError(error instanceof Error ? error.message : String(error)); }
      finally { inFlight.current = false; setSending(false); }
    }}>{sending ? 'Resending…' : 'Resend in new thread'}</Button>
    {error && <p role="alert" style={{ flexBasis: '100%' }}>{error}</p>}
  </section>;
}
