#!/usr/bin/env python3
"""Opt-in local-model planning evaluation. No accounts, live threads, or remote calls.
Run with an already installed Ollama model. Results are observations, not mocked successes.
"""
import json, re, urllib.request, time, argparse
from pathlib import Path
parser=argparse.ArgumentParser(); parser.add_argument('--model',default='gemma4:e2b-it-q4_K_M'); args=parser.parse_args()
role=re.search(r'const ROLE: &str = r#"(.*?)"#;',Path('crates/core/src/commander.rs').read_text(),re.S)[1]
def tool(name, description, properties, required=()):
    return {'type':'function','function':{'name':name,'description':description,'parameters':{'type':'object','properties':properties,'required':list(required)}}}
s={'type':'string'}
tools=[tool('freddai_memory_search','Search durable memories',{'query':s},['query']),tool('freddai_list_projects','List actual projects and IDs',{}),tool('freddai_list_threads','List recent threads and status',{'project':s}),tool('freddai_read_thread','Read thread messages',{'thread':s},['thread']),tool('freddai_start_task','Start requested work; user_requested is true only for an explicit user request.',{'project':s,'prompt':s,'request_id':s,'user_requested':{'type':'boolean'}},['project','prompt','request_id']),tool('freddai_todo_add','Save a reminder or priority. ISO8601 timestamps.',{'title':s,'owner':s,'check_back_at':s,'due':s,'delay_minutes':{'type':'integer'}},['title']),tool('freddai_todo_list','Read priorities and to-dos',{}),tool('freddai_todo_update','Update a to-do',{'id':s,'status':s},['id'])]
context='\nCurrent local time: 2026-11-12T09:00:00-08:00. Projects: Freddai (id p_freddai), Research (id p_research). No other projects exist. Recent thread t_pricing in p_freddai: Pricing page [done]. Use the supplied tools. Do not claim an action succeeded until a tool returns success.'
cases=[('project_alias', 'Hey, on the project Freddie, can you add dark mode? Launch a thread to do it.', 'freddai_start_task'),('feature','On Freddai, add a keyboard shortcut to open search. Start a thread for it.', 'freddai_start_task'),('research','Start research in the Research project on offline speech recognition options.', 'freddai_start_task'),('reminder','Remind me in an hour to call Sam.', 'freddai_todo_add'),('priorities','My top priority is finishing the pricing page. Track it for me.', 'freddai_todo_add'),('next','What should I be working on now?', 'freddai_todo_list'),('recent','What have I launched recently?', 'freddai_list_threads'),('result','What did the pricing page thread accomplish?', 'freddai_read_thread')]
results=[]
for name,prompt,wanted in cases:
    started=time.monotonic(); messages=[{'role':'system','content':role+context},{'role':'user','content':prompt}]; calls=[]; reply=''
    for turn in range(6):
        body={'model':args.model,'stream':False,'think':False,'messages':messages,'tools':tools,'options':{'temperature':0,'num_predict':700}}
        request=urllib.request.Request('http://127.0.0.1:11434/api/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=120) as r: message=json.load(r)['message']
        messages.append(message); reply=message.get('content',''); tc=message.get('tool_calls',[])
        calls.extend(c['function'] for c in tc)
        if any(c['name']==wanted for c in calls) or not tc: break
        for c in tc:
            n=c['function']['name']; result={'projects':[{'id':'p_freddai','name':'Freddai'},{'id':'p_research','name':'Research'}]} if n=='freddai_list_projects' else {'threads':[{'id':'t_pricing','title':'Pricing page','project':'p_freddai','status':'done'}]} if n=='freddai_list_threads' else {'todos':[{'id':'todo_pricing','title':'Finish pricing page','owner':'me','status':'open'}]} if n=='freddai_todo_list' else {'error':'Read-only planning evaluation; no action executed'}
            messages.append({'role':'tool','tool_name':n,'content':json.dumps(result)})
    success=any(c['name']==wanted for c in calls)
    if wanted=='freddai_start_task': success=success and any(c['name']==wanted and c['arguments'].get('user_requested') is True and c['arguments'].get('project')==('p_freddai' if name in ('feature','project_alias') else 'p_research') for c in calls)
    if name=='reminder': success=success and any(c['name']==wanted and c['arguments'].get('delay_minutes')==60 for c in calls)
    if name=='priorities': success=success and any(c['name']==wanted and c['arguments'].get('owner')=='me' and not c['arguments'].get('due') and not c['arguments'].get('check_back_at') for c in calls)
    result={'case':name,'passed':success,'seconds':round(time.monotonic()-started,2),'calls':calls,'reply':reply};results.append(result);print(json.dumps(result),flush=True)
Path('/tmp/freddai-commander-local-eval.json').write_text(json.dumps({'model':args.model,'cases':results},indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
