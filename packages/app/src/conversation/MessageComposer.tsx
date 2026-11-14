import type { ComponentProps, KeyboardEvent, ReactNode, Ref } from 'react';
import { Textarea } from '@freddai/ui/components/textarea';
import { SuggestTextarea, type SuggestContext, type SuggestLoader } from '../desktop/ComposerSuggest';

export type MessageInputProps = Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange' | 'ref'> & {
  value: string;
  onValueChange: (value: string) => void;
  inputRef?: Ref<HTMLTextAreaElement>;
  threadId?: string;
  suggestions?: { context: SuggestContext; loader?: SuggestLoader };
  onSend?: (steer: boolean) => void;
  keyboard?: 'desktop' | 'adaptive' | 'modifier';
};

/** One message input: suggestions consume keys first; IME and soft Return never send accidentally. */
export function MessageInput({ value, onValueChange, inputRef, threadId, suggestions, onSend, keyboard = 'desktop', onKeyDown, ...props }: MessageInputProps) {
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(e);
    if (e.defaultPrevented || !onSend || e.key !== 'Enter' || e.shiftKey || e.altKey || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    const modifier = e.metaKey || e.ctrlKey;
    const softReturn = keyboard === 'adaptive' && window.matchMedia?.('(pointer: coarse)').matches;
    if (!modifier && (keyboard === 'modifier' || softReturn)) return;
    e.preventDefault();
    onSend(modifier);
  }
  return suggestions
    ? <SuggestTextarea {...props} data-thread-id={threadId} value={value} onValueChange={onValueChange} composerRef={inputRef} context={suggestions.context} loader={suggestions.loader} onKeyDown={keyDown} />
    : <Textarea {...props} data-thread-id={threadId} ref={inputRef} value={value} onChange={e => onValueChange(e.target.value)} onKeyDown={keyDown} />;
}

export type MessageComposerProps = {
  input: MessageInputProps;
  onSend: (steer: boolean) => void;
  beforeInput?: ReactNode;
  afterInput?: ReactNode;
  tools: ReactNode;
  afterTools?: ReactNode;
  className?: string;
  toolsClassName?: string;
};

/** Existing composer layout shared by new threads, replies and companion web views.
 * Owners retain draft/attachment state and platform actions; this owns input and submit behavior. */
export function MessageComposer({ input, onSend, beforeInput, afterInput, tools, afterTools, className = 'chat-composer', toolsClassName = 'chat-composer-tools' }: MessageComposerProps) {
  return <form className={className} onSubmit={e => { e.preventDefault(); onSend(false); }}>
    {beforeInput}
    <MessageInput {...input} onSend={onSend} />
    {afterInput}
    <div className={toolsClassName}>{tools}</div>
    {afterTools}
  </form>;
}
