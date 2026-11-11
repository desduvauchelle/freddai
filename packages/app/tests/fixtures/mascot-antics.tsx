import { createRoot } from 'react-dom/client';
import { Dormouse } from '../../src/desktop/Dormouse';
import { ANTICS, playAntic } from '../../src/desktop/mascot-antics';
import '@freddai/ui/styles.css';
import '../../src/desktop/desktop.css';
Object.assign(window, { playAntic, ANTICS });
createRoot(document.getElementById('root')!).render(<Dormouse size={148} priority={3} mood={0} label="Ready" antics />);
