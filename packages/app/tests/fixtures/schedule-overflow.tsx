import { createRoot } from "react-dom/client";
import "@freddai/ui/styles.css";
import "../../src/workspace.css";
import "../../src/desktop/desktop.css";
import { ScheduleManager } from "../../src/desktop/ScheduleManager";
import { ResizablePanel, ResizablePanelGroup } from "@freddai/ui/components/resizable";
const schedule = {id:"long",name:"Long offline task",project:"p",account:"",routing:"fixed" as const,cron:"0 9 * * 1",timezone:"UTC",prompt:"Review the entire long task and preserve its instructions. ".repeat(1000),enabled:false,options:{},next_due:0,runs:[]};
createRoot(document.getElementById("root")!).render(<div className="dev-app native-workspace"><header className="app-titlebar">Header</header><div className="app-body"><main className="workbench"><div className="workbench-panes has-detail"><ResizablePanelGroup orientation="horizontal"><ResizablePanel><ScheduleManager db={{projects:[{id:"p",name:"Offline"}],accounts:[],schedules:[schedule]}} native={false} scheduleId="long" onRefresh={async()=>{}} onSelect={()=>{}} conversation={()=> <section className="thread-detail"><div className="pane-title">Conversation navigation</div><div className="chat-surface">No runs</div></section>}/></ResizablePanel></ResizablePanelGroup></div></main></div><footer className="statusbar">Footer</footer></div>);
