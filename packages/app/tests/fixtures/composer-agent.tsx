import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ComposerAgentPicker } from '../../src/desktop/ComposerAgentPicker';
import '@freddai/ui/styles.css';
import '../../src/desktop/desktop.css';
import { setAccountUsage } from '../../src/desktop/useAccountUsage';
import type { Account } from '../../src/desktop/types';
const claude: Account = {id:'preview-claude', name:'Preview connection', provider:'claude', color:'#d99573'};
const codex: Account = {id:'preview-codex', name:'Preview connection', provider:'codex', color:'#59b99a'};
const reset = Date.now()/1000 + 18*3600;
setAccountUsage(claude.id, () => ({usage:{checked_at:Date.now(), windows:[{label:'Weekly', window:'weekly', used_percent:25, resets_at:reset}]}}));
setAccountUsage(codex.id, () => ({usage:{checked_at:Date.now(), windows:[{label:'Weekly', window:'weekly', used_percent:60, resets_at:reset}]}}));
function Fixture() {
  const [selection, setSelection] = useState({model:'freddai-level:smart', effort:'default'});
  const [agent, setAgent] = useState('preview-claude');
  return <main style={{padding:16, minHeight:'100dvh', display:'flex', alignItems:'end', justifyContent:'end', background:'#272132', color:'white'}}><div className="native-workspace"><div className="chat-composer" style={{width:260, minWidth:0}}><textarea aria-label="Draft" defaultValue="Keep this draft"/><div className="chat-composer-tools" style={{width:'100%', minWidth:0, overflow:'hidden'}}><ComposerAgentPicker options={[{id:'preview-claude',label:'Claude · Preview connection',provider:'claude',color:'#d99573',account:claude},{id:'preview-codex',label:'Codex · Preview connection',provider:'codex',color:'#59b99a',account:codex}]} agent={agent} onAgentChange={setAgent} native={false} provider={agent === 'preview-claude' ? 'claude' : 'codex'} value={selection} onChange={setSelection}/></div></div></div></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
