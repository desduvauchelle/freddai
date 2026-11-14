import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Square } from "lucide-react";
import { MessageInput } from "@freddai/app/conversation/MessageComposer";
import { MicButton } from "@freddai/shared/voice/VoiceControls";
import { focusEnd, joinDictation } from "@freddai/shared/voice/voice";
import "./chat.css";

export type ScoutComposerProps = {
  placeholder: string;
  disabled?: boolean;
  /** Return false when the message was not accepted: the draft is restored. */
  onSend: (text: string) => boolean | void | Promise<boolean | void>;
  busy?: boolean;
  onStop?: () => void;
  /** Replaces the draft whenever `nonce` changes (e.g. "Edit" on a draft card). */
  seed?: { text: string; nonce: number };
};

/** Pill composer from the Figma bottom bar: attach (later), text, dictation, send / stop. */
export function ScoutComposer({ placeholder, disabled = false, onSend, busy = false, onStop, seed }: ScoutComposerProps) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!seed) return;
    setDraft(seed.text);
    setTimeout(() => focusEnd(box.current), 0);
  }, [seed?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    const ok = await onSend(text);
    if (ok === false) setDraft(previous => (previous ? previous : text));
  }

  return <form className="sc-composer" data-disabled={disabled || undefined} onSubmit={e => { e.preventDefault(); void send(); }}>
    <button type="button" className="sc-composer__icon" aria-label="Attach files" title="Attachments coming later" disabled>
      <Plus size={18} />
    </button>
    <MessageInput
      className="sc-composer__input"
      aria-label="Message"
      rows={1}
      placeholder={placeholder}
      value={draft}
      disabled={disabled}
      inputRef={box}
      onValueChange={setDraft}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onSend={() => void send()}
    />
    {busy && onStop && <button type="button" className="sc-composer__icon" aria-label="Stop the agent" title="Stop" onClick={onStop}>
      <Square size={14} fill="currentColor" />
    </button>}
    {draft.trim()
      ? <button type="submit" className="sc-composer__send" aria-label="Send" title="Send (Enter)" disabled={disabled}><ArrowUp size={18} /></button>
      : <MicButton target={focused} disabled={disabled} className="sc-composer__mic" onText={(text, button) => {
          setDraft(previous => joinDictation(previous, text));
          const area = button.closest("form")?.querySelector("textarea");
          setTimeout(() => focusEnd(area), 0);
        }} />}
  </form>;
}
