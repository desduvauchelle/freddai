import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { RecordingFeedback } from '../../src/RecordingFeedback';
import '@freddai/ui/styles.css';
function Fixture() {
  const [corner, setCorner] = useState('top-left');
  return <><select aria-label="Corner" value={corner} onChange={e => setCorner(e.target.value)} style={{position:'fixed', left:'40%', top:'45%'}}>{['top-left','top-right','bottom-left','bottom-right'].map(c => <option key={c}>{c}</option>)}</select><div key={corner} style={{ position:'fixed', [corner.startsWith('top') ? 'top' : 'bottom']:8, [corner.endsWith('left') ? 'left' : 'right']:8, width:32, height:32, overflow:'hidden' }}><button>Mic</button><RecordingFeedback elapsed={3} levels={Array(16).fill(.15)} send={0} cancel={0} finger={null} onCancel={() => {}} onSend={() => {}} /></div></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
