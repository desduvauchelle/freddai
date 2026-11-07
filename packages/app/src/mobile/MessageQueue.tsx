import { MessageQueue as SharedMessageQueue } from '../desktop/MessageQueue';
import type { CompanionThread } from './companion';

type QueueAction = 'edit' | 'delete' | 'steer';
export function MessageQueue({ messages, paused, error, active = false, disabled, onAction }: {
  messages: NonNullable<CompanionThread['queue']>; paused?: boolean; error?: string | null;
  active?: boolean; disabled: boolean;
  onAction: (action: QueueAction, message?: string, prompt?: string) => Promise<unknown> | void;
}) {
  return <SharedMessageQueue queue={{ session: '', paused: !!paused, error: error ?? null,
    messages: messages.map(message => ({ id: message.id, prompt: message.prompt || 'Attachment', options: {} })) }}
    active={active} canSteer disabled={disabled}
    onAction={(action, message, prompt) => onAction(action as QueueAction, message, prompt)}/>;
}
