import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RecordingFeedback } from '../../src/RecordingFeedback';
import { recordingGesture } from '../../src/recording-gesture';
function Fixture() {
  const [point, setPoint] = useState({ x: 200, y: 400 });
  return <div style={{ position: 'absolute', left: 12, top: 350, width: 44, height: 44 }}
    onPointerMove={event => setPoint({ x: event.clientX, y: event.clientY })}>
    <RecordingFeedback elapsed={12} {...recordingGesture({ x: 200, y: 400 }, point)} finger={point} onCancel={() => {}} onSend={() => {}} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
