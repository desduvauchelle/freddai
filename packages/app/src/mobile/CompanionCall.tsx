import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Phone } from 'lucide-react';
import { Button } from '@freddai/ui/components/button';
import { VoiceCallController, loadCallPrefs, type CallThread } from '../desktop/voiceCall';
import { VoiceCallBar } from '../desktop/VoiceCallBar';
import type { CompanionClient, CompanionThread } from './companion';
import { companionCallIo } from './companion-call';
import { useNativeShell } from './native-shell';

export function CompanionCall({ client, thread, ready, connected, sendText, onActive }: {
  client: CompanionClient; thread?: CompanionThread; ready?: boolean; connected: boolean;
  sendText: (text: string) => Promise<void>; onActive: (active: boolean) => void;
}) {
  const nativeShell = useNativeShell();
  const busy = ['starting', 'running', 'waiting'].includes(thread?.status || "");
  const latest = useRef<CallThread>(null!);
  latest.current = {
    isBusy: () => busy,
    stopTurn: async () => {
      if (!client.action || !thread) throw new Error('Stopping the agent is unavailable.');
      await client.action({ thread: thread.id, action: 'stop' });
    },
    sendText,
  };
  const controller = useMemo(() => new VoiceCallController(companionCallIo(client), () => latest.current, loadCallPrefs()), [client, nativeShell]);
  const previousThread = useRef(thread?.id);
  useEffect(() => {
    if (previousThread.current && previousThread.current !== thread?.id) void controller.end();
    previousThread.current = thread?.id;
  }, [controller, thread?.id]);
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());
  useEffect(() => {
    setSnapshot(controller.getSnapshot());
    const off = controller.subscribe(() => setSnapshot(controller.getSnapshot()));
    return () => { off(); void controller.end(); onActive(false); };
  }, [controller, onActive]);
  useEffect(() => { onActive(snapshot.active); }, [snapshot.active, onActive]);
  useEffect(() => { if (!connected) void controller.end(); }, [connected, controller]);
  useEffect(() => { controller.observeThread({ busy, messages: thread?.messages || [] }); }, [controller, busy, thread?.messages]);
  const canStart = connected && (thread ? thread.canReply && thread.messagesLoaded !== false : !!ready) && !!(client.transcribe || client.transcribeAudio);
  useEffect(() => {
    const start = () => { if (canStart && !controller.getSnapshot().active) void controller.begin(); };
    window.addEventListener('freddai:start-call', start);
    return () => window.removeEventListener('freddai:start-call', start);
  }, [controller, canStart]);
  if (snapshot.active) return <div className="companion-call"><VoiceCallBar call={controller} snapshot={snapshot} agentBusy={busy} onEnd={() => void controller.end()} /></div>;
  const target = document.getElementById('companion-call-action');
  return target ? createPortal(<Button type="button" variant="ghost" size="icon" aria-label="Start call" title="Start call" disabled={!canStart} onClick={() => void controller.begin()}><Phone size={18} /></Button>, target) : null;
}
