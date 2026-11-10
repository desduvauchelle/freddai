import { createRoot } from 'react-dom/client';
import { Dormouse } from '../../src/desktop/Dormouse';
import '@freddai/ui/styles.css';
import '../../src/desktop/desktop.css';
import '../../src/mobile/mobile.css';
createRoot(document.getElementById('root')!).render(<>{[false, true].map(phone => <section key={String(phone)} className={phone ? 'companion' : 'native-workspace'}>{[undefined, 28, 44, 68, 96].map(size => <div key={String(size)} style={{ position: 'relative', height: 150, margin: 24 }}><Dormouse mood={6} label="Completed" size={size} /><span style={{ marginLeft: 120 }}>Completed</span></div>)}</section>)}</>);
