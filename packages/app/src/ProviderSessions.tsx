import { useState, type CSSProperties } from 'react';
import { Button } from '@freddai/ui/components/button';
import { Input } from '@freddai/ui/components/input';
import { Badge } from '@freddai/ui/components/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@freddai/ui/components/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@freddai/ui/components/select';
import { Plus, Clock3, X, Asterisk, MessageCircle, Sparkles, Zap, Terminal } from 'lucide-react';

type Profile = { id: string; provider: string; label: string; used?: number; reset?: string; color: string };
const initial: Profile[] = [
  { id: 'claude-1', color: '#e7a17d', provider: 'Claude', label: 'Personal', used: 72, reset: 'In 1h 40m' },
  { id: 'chatgpt-1', color: '#7ccbb2', provider: 'ChatGPT', label: 'Account 1', used: 94, reset: 'In 25m' },
  { id: 'chatgpt-2', color: '#ac9aef', provider: 'ChatGPT', label: 'Account 2', used: 28, reset: 'In 3h 10m' },
];
const colors = ['#e7a17d', '#7ccbb2', '#ac9aef', '#7db9ef', '#ed91bd', '#d6c777'];
function AccountRing({ profile: p }: { profile: Profile }) {
  const Icon = p.provider === 'Claude' ? Asterisk : p.provider === 'ChatGPT' ? MessageCircle : p.provider === 'Antigravity' ? Sparkles : p.provider === 'Grok' ? Zap : Terminal;
  return <span className="account-ring" aria-hidden="true">
    <svg viewBox="0 0 36 36" className="account-ring-meter"><circle cx="18" cy="18" r="15" className="account-ring-track"/>{p.used !== undefined && <circle cx="18" cy="18" r="15" pathLength="100" strokeDasharray={`${100-p.used} 100`} className="account-ring-fill"/>}</svg>
    <Icon size={15}/>
  </span>;
}
export function ProviderSessions() {
  const [open,setOpen]=useState(false),[profiles,setProfiles]=useState(initial);
  const [provider,setProvider]=useState('Claude'),[label,setLabel]=useState('');
  const [message,setMessage]=useState('');
  function add(e: React.FormEvent) {e.preventDefault();if(!label.trim())return;setProfiles(ps=>[...ps,{id:crypto.randomUUID(),provider,label:label.trim(),color:colors.find(c=>!ps.some(p=>p.color===c))??colors[ps.length%colors.length]}]);setMessage(`${provider} profile added locally. Sign-in is not connected.`);setLabel('')}
  return <><div className="account-dock" aria-label="Account capacity">
    {profiles.map(p=><Button key={p.id} variant="ghost" className="account-chip" style={{'--account-color':p.color} as CSSProperties} onClick={()=>setOpen(true)} aria-label={`${p.provider} ${p.label}: ${p.used === undefined ? 'capacity unknown' : `${100-p.used}% remaining`}. ${p.reset ? `Resets ${p.reset.toLowerCase()}` : 'Reset unknown'}`}>
      <AccountRing profile={p}/><span className="account-chip-copy"><span className="account-chip-name">{p.provider} <span>{p.label}</span></span><span className={p.used!==undefined&&p.used>=90?'capacity-low':'capacity-label'}>{p.used===undefined?'Usage unknown':`${100-p.used}% left`}{p.used!==undefined&&p.used>=90?' · Low':''}<span className="account-chip-reset">{p.reset?` · Resets ${p.reset.toLowerCase()}`:''}</span></span></span>
    </Button>)}
    <Button variant="ghost" size="icon" className="account-manage" onClick={()=>setOpen(true)} aria-label="Manage accounts"><Plus size={15}/></Button>
  </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="dark capture-panel providers-panel"><DialogHeader><DialogTitle>Accounts & usage</DialogTitle><DialogDescription>Separate local sign-in profiles for your coding tools.</DialogDescription></DialogHeader>
      <div className="provider-demo-note"><Badge variant="outline">Sample usage</Badge><span>Full ring = full capacity available. Sample values only.</span></div>
      <div className="provider-list">{profiles.map(p=><section className="provider-profile" key={p.id} style={{'--account-color':p.color} as CSSProperties}><div className="provider-profile-title"><AccountRing profile={p}/><strong>{p.provider}</strong><span>{p.label}</span><Button variant="ghost" size="icon" aria-label={`Remove ${p.provider} ${p.label}`} onClick={()=>{setProfiles(ps=>ps.filter(x=>x.id!==p.id));setMessage(`${p.provider} ${p.label} removed from this demo.`)}}><X size={12}/></Button></div><div className="provider-usage"><span>{p.used===undefined?'Usage unavailable':'Available capacity'}</span><strong>{p.used===undefined?'—':`${100-p.used}% left`}</strong></div>{p.used!==undefined&&<div role="progressbar" aria-label={`${p.provider} ${p.label} sample remaining capacity`} aria-valuenow={100-p.used} aria-valuemin={0} aria-valuemax={100} className={`quota-track ${p.used>=90?'high':''}`}><i style={{width:`${100-p.used}%`}}/></div>}<div className="provider-reset"><Clock3 size={11}/>{p.reset?`Resets ${p.reset.toLowerCase()}`:'Reset time unavailable'}<span>{p.used===undefined?'Not connected':'Demo'}</span></div></section>)}</div>
      {!profiles.length&&<p className="capture-help">No profiles. Add one below to explore the layout.</p>}
      <form onSubmit={add} className="provider-add"><Select value={provider} onValueChange={setProvider}><SelectTrigger aria-label="Provider" className="h-8"><SelectValue/></SelectTrigger><SelectContent className="dark dev-popup">{['Claude','ChatGPT','Antigravity','Grok','Other'].map(p=><SelectItem value={p} key={p}>{p}</SelectItem>)}</SelectContent></Select><Input aria-label="Account label" placeholder="Account label" value={label} onChange={e=>setLabel(e.target.value)}/><Button size="sm" disabled={!label.trim()}><Plus size={13}/>Add profile</Button></form>
      <p className="provider-footnote">Multiple profiles per provider. Adding one does not sign in or switch a running terminal session.</p><p role="status" className="capture-help">{message}</p>
    </DialogContent></Dialog></>;
}
