import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Button } from '@freddai/ui/components/button';
import { MessageComposer } from './conversation/MessageComposer';
import { ThreadTranscript } from './conversation/ThreadTranscript';
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
   <ThreadTranscript messages={[
    { id: 'summary', role: 'assistant', text: task.summary },
    ...(task.notes || []).map((text, i) => ({ id: `note-${i}`, role: 'user', text })),
   ]} pending={(task.messages || []).map((message, i) => ({ id: `message-${i}`, text: message.text, status: 'Queued', sending: false,
    attachments: message.files.map((name, j) => ({ id: `preview-${i}-${j}`, name, bytes: 0, mime: '', sha256: '' })) }))}>
    {task.question && <div className="chat-question"><CircleDot size={14}/>{task.question}</div>}
    {task.schedule && <div className="chat-schedule"><Clock3 size={13}/>{task.schedule}</div>}
    {task.status === 'Review' && <div className="review-controls"><Button size="sm" onClick={()=>onStage('Done')}>Accept & mark done</Button><Button size="sm" variant="outline" onClick={()=>onStage('Next')}>Request changes</Button></div>}
    {!!task.files?.length && <div className="chat-attachments">{task.files.map((file,i)=><span key={i}><FileText size={14}/>{file}</span>)}</div>}
   </ThreadTranscript>
  </div>
  <MessageComposer onSend={send} beforeInput={<>
   {!!files.length&&<div className="chat-attachments draft-attachments">{files.map((file,i)=><span key={i}><FileText size={14}/><span>{file}</span><Button type="button" variant="ghost" size="icon" aria-label={`Remove attachment ${file}`} onClick={()=>setFiles(fs=>fs.filter((_,j)=>j!==i))}><X size={12}/></Button></span>)}</div>}
</>}
   input={{ 'aria-label': 'Reply to thread', placeholder: 'Message your agent…', value: text, onValueChange: setText, keyboard: 'modifier' }}
   tools={<><input ref={input} className="sr-only" type="file" multiple aria-label="Attach files to message" onChange={e=>{attach(e.target.files);e.target.value=''}}/><Button type="button" variant="ghost" size="sm" onClick={()=>input.current?.click()}><Paperclip size={15}/>Attach</Button><span>or drop files here</span><Button className="chat-send" size="icon" aria-label="Send message" disabled={!text.trim()&&!files.length}><ArrowUp size={17}/></Button></>} /><p className="chat-composer-hint">Preview only · attachments stay local · ⌘ / Ctrl + Enter to send</p>
 </div>
}
