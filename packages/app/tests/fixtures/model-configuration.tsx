import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ModelConfigurationSettings } from '../../src/desktop/ModelConfigurationSettings';
import { AgentControls, defaultSelection, type AgentSelection } from '../../src/desktop/AgentControls';
import type { ModelConfiguration } from '../../src/desktop/model-levels';
import '@freddai/ui/styles.css';
function Fixture() {
  const [configuration,setConfiguration]=useState<ModelConfiguration>({}), [selection,setSelection]=useState<AgentSelection>(defaultSelection);
  return <main style={{padding:16,maxWidth:1000,margin:'auto'}}><h1>Model configuration</h1><ModelConfigurationSettings configuration={configuration} onSave={async next=>setConfiguration(next)}/><section aria-label="Session controls" style={{marginTop:24}}><AgentControls inline native={false} provider="codex" value={selection} onChange={setSelection}/></section><output aria-label="Session selection">{JSON.stringify(selection)}</output><output aria-label="Shared mapping">{JSON.stringify(configuration)}</output></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
