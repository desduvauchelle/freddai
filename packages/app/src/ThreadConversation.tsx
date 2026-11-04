import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Button } from '@freddai/ui/components/button';
import { Textarea } from '@freddai/ui/components/textarea';
import { Paperclip, ArrowUp, X, FileText, Sparkles, CircleDot, Clock3 } from 'lucide-react';
import type { Thread, Stage } from './model';

export function ThreadConversation({task,onSend,onStage}:{task:Thread;onSend:(text:string,files:string[])=>void;onStage:(status:Stage)=>void}) {
 const [text,setText]=useState(''),[files,setFiles]=useState<string[]>([]),[dragging,setDragging]=useState(false);
 const input=useRef<HTMLInputElement>(null),transcript=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight},[task.messages?.length]);
 function attach(list:FileList|null){if(list)setFiles(previous=>[...previous,...Array.from(list).map(f=>f.name)])}
 function drop(e:DragEvent){e.preventDefault();setDragging(false);attach(e.dataTransfer.files)}
 function send(){if(!text.trim()&&!files.length)return;onSend(text.trim(),files);setText('');setFiles([])}
 return <div className={`chat-surface ${dragging?'chat-dragging':''}`} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();setDragging(true)}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false)}} onDrop={drop}>
  {dragging&&<div className="chat-drop-overlay"><Paperclip size={24}/><strong>Add files to your message</strong><span>Drop anywhere in this conversation</span></div>}
  <div ref={transcript} className="chat-transcript" aria-label="Conversation messages">
   <div className="chat-context"><span>{task.project}</span><span>•</span><span>{task.cli}</span></div>
   <article className="chat-assistant"><div className="chat-speaker"><span className="chat-avatar"><Sparkles size={15}/></span><strong>{task.agent==='Unassigned'?'Agent':task.agent}</strong><span>{task.cli}</span></div><div className="chat-message-body"><p>{task.summary}</p>
    {task.question&&<div className="chat-question"><div><CircleDot size={14}/>Your input is needed</div><p>{task.question}</p></div>}
    {task.schedule&&<div className="chat-schedule"><Clock3 size={13}/>{task.schedule}</div>}
    {task.status==='Review'&&<div className="review-controls"><Button size="sm" onClick={()=>onStage('Done')}>Accept & mark done</Button><Button size="sm" variant="outline" onClick={()=>onStage('Next')}>Request changes</Button></div>}
    {!!task.files?.length&&<div className="chat-attachments">{task.files.map((file,i)=><span key={i}><FileText size={14}/>{file}</span>)}</div>}
   </div></article>
   {task.notes?.map((note,i)=><article className="chat-user" key={`note-${i}`}><span>You</span><p>{note}</p></article>)}
   {task.messages?.map((message,i)=><article className="chat-user" key={i}><span>You</span>{message.text&&<p>{message.text}</p>}{!!message.files.length&&<div className="chat-attachments">{message.files.map((file,j)=><span key={j}><FileText size={14}/>{file}</span>)}</div>}<small>Queued</small></article>)}
  </div>
  <form className="chat-composer" onSubmit={e=>{e.preventDefault();send()}}>
   {!!files.length&&<div className="chat-attachments draft-attachments">{files.map((file,i)=><span key={i}><FileText size={14}/><span>{file}</span><Button type="button" variant="ghost" size="icon" aria-label={`Remove attachment ${file}`} onClick={()=>setFiles(fs=>fs.filter((_,j)=>j!==i))}><X size={12}/></Button></span>)}</div>}
   <Textarea aria-label="Reply to thread" placeholder="Message your agent…" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();send()}}}/>
   <div className="chat-composer-tools"><input ref={input} className="sr-only" type="file" multiple aria-label="Attach files to message" onChange={e=>{attach(e.target.files);e.target.value=''}}/><Button type="button" variant="ghost" size="sm" onClick={()=>input.current?.click()}><Paperclip size={15}/>Attach</Button><span>or drop files here</span><Button className="chat-send" size="icon" aria-label="Send message" disabled={!text.trim()&&!files.length}><ArrowUp size={17}/></Button></div>
  </form><p className="chat-composer-hint">Preview only · attachments stay local · ⌘ / Ctrl + Enter to send</p>
 </div>
}
