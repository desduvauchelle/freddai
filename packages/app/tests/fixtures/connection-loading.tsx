import { createRoot } from 'react-dom/client';
import { ConnectionLoading } from '../../src/mobile/ConnectionLoading';
import '../../src/mobile/mobile.css';
import '@freddai/ui/styles.css';
createRoot(document.getElementById('root')!).render(<main className="companion" style={{ height: '100dvh' }}><div className="companion-home"><ConnectionLoading /></div></main>);
