export const stages = ['Backlog', 'Next', 'In progress', 'Needs you', 'Review', 'Done'] as const;
export type Stage = typeof stages[number];
export type Thread = { id: string; title: string; project: string; status: Stage; agent: string; updatedAt: number; cli: string; summary: string; question?: string; schedule?: string; files?: string[]; notes?: string[]; messages?: {text:string;files:string[]}[] };
export const projects = ['Freddai', 'Orbit API', 'Fieldnotes'];
export const initialProjectColors: Record<string,string> = {Freddai:'#b59ae9','Orbit API':'#77b9df',Fieldnotes:'#8ec6a2'};
const sampleTime = Date.now();
export const initialThreads: Thread[] = [
  { id: 'F-12', title: 'Make room for a quieter workspace', project: 'Freddai', status: 'In progress', agent: 'Milo', updatedAt: sampleTime - 30000, cli: 'Codex', summary: 'Exploring a compact navigation layout. Keeping capture within reach on every screen.' },
  { id: 'O-08', title: 'Fix the recurring timeout', project: 'Orbit API', status: 'Needs you', agent: 'Ada', updatedAt: sampleTime - 120000, cli: 'Claude Code', summary: 'The example logs point to the retry limit. Two approaches are ready to compare.', question: 'Should retries stop after 30 seconds, or keep trying in the background?' },
  { id: 'F-09', title: 'Review the new task composer', project: 'Freddai', status: 'Review', agent: 'Kit', updatedAt: sampleTime - 600000, cli: 'Codex', summary: 'The proposed composer keeps project selection optional until you are ready. Ready for your feedback.' },
  { id: 'N-04', title: 'Clean up the mobile navigation', project: 'Fieldnotes', status: 'Next', agent: 'June', updatedAt: sampleTime - 3600000, cli: 'Claude Code', summary: 'Try a bottom navigation with three destinations and a persistent capture button.' },
  { id: 'O-11', title: 'Morning error-log check', project: 'Orbit API', status: 'Backlog', agent: 'Pip', updatedAt: sampleTime - 7200000, cli: 'Codex', summary: 'A recurring check for new errors. Findings should become reviewable tasks before any fix starts.', schedule: 'Tomorrow · 09:00' },
  { id: 'N-02', title: 'Collect ideas for offline mode', project: 'Fieldnotes', status: 'Backlog', agent: 'June', updatedAt: sampleTime - 3600000, cli: 'Claude Code', summary: 'Capture rough ideas before choosing an implementation.' },
  { id: 'F-03', title: 'Set up the shared app shell', project: 'Freddai', status: 'Done', agent: 'Kit', updatedAt: sampleTime - 600000, cli: 'Codex', summary: 'Example completed thread. Shared layout and UI foundations are ready for a walkthrough.' },
  ...[
    ['F-02','Add keyboard shortcuts', 24],
    ['F-01','Define the project structure', 48],
    ['F-00','Explore agent permissions', 72],
    ['F-05','Sketch the first conversation view', 96],
  ].map(([id,title,hours])=>({id:String(id),title:String(title),project:'Freddai',status:'Done' as const,agent:'Kit',updatedAt:sampleTime-Number(hours)*3600000,cli:'Codex',summary:'Earlier demo conversation. The proposed changes are ready to revisit.'})),

];
export function moveThread(threads: Thread[], id: string, status: Stage, now = Date.now()): Thread[] { return threads.map(t => t.id === id ? { ...t, status, updatedAt: now } : t); }
export function inferProject(text: string): string | undefined { return projects.find(p => text.toLowerCase().includes(p.toLowerCase())); }

export function recentThreads(threads: Thread[]): Thread[] { return [...threads].sort((a,b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)); }
