import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@freddai/ui/components/button";
import { Field, FieldContent, FieldLabel, FieldDescription } from "@freddai/ui/components/field";
import { Switch } from "@freddai/ui/components/switch";
import { AwakeSettings } from "./AwakeSettings";
export function BackgroundSettings({native}:{native:boolean}) {
  const [enabled,setEnabled]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{if(native)void invoke<boolean>("startup_status").then(setEnabled).catch(e=>setError(String(e)));},[native]);
  return <section><h3>Background work</h3><p className="capture-help">Closing Freddai keeps agents and schedules running. After a host crash, unfinished turns are marked interrupted. Resume explicitly from their conversation.</p>
    <Field orientation="horizontal">
      <FieldContent><FieldLabel htmlFor="start-background-host">Start background host when I log in</FieldLabel><FieldDescription>Schedules run while this computer is awake and logged in. Missed runs are recorded, never automatically replayed.</FieldDescription></FieldContent>
      <Switch id="start-background-host" checked={enabled} disabled={!native||busy} onCheckedChange={async next=>{setBusy(true);try{await invoke("set_start_at_login",{enabled:next});setEnabled(next);setError("");}catch(e){setError(String(e));}finally{setBusy(false);}}}/>
    </Field>
    <Button variant="outline" disabled={!native||busy} onClick={async()=>{setBusy(true);try{await invoke("stop_all");}catch(e){setError(String(e));}finally{setBusy(false);}}}>Stop all active agents</Button>
    {error&&<p role="alert">{error}</p>}
    {(!native || /Mac/.test(navigator.platform)) && <AwakeSettings native={native}/>}
  </section>;
}
