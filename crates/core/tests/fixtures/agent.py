import sys,json,time
provider=sys.argv[1]
scenario=sys.argv[2] if len(sys.argv)>2 else ''
model_selected=False
def out(v): print(json.dumps(v),flush=True)
for line in sys.stdin:
 v=json.loads(line)
 if provider=='codex':
  if v.get('method')=='initialize':out({'id':1,'result':{}})
  elif v.get('method') in ['thread/start','thread/resume']:
   assert v['method']=='thread/resume'
   assert v['params']['threadId']=='provider-session'
   assert v['params']['model']=='fixture-model'
   assert v['params']['approvalPolicy']=='on-request'
   out({'id':2,'result':{'thread':{'id':'provider-session'}}})
  elif v.get('method')=='turn/start':
   assert 'ATTACHMENT_FIXTURE_CONTENT' in json.dumps(v['params']['input'])
   assert v['params']['threadId']=='provider-session'
   assert v['params']['effort']=='xhigh'
   out({'id':3,'result':{'turn':{'id':'turn'}}})
   out({'method':'thread/name/updated','params':{'threadId':'wrong-thread','threadName':'Wrong title'}})
   out({'method':'thread/name/updated','params':{'threadId':'provider-session','threadName':'Generated title'}})
   out({'method':'item/agentMessage/delta','params':{'itemId':'message','delta':'Hello '}})
   out({'id':91,'method':'item/commandExecution/requestApproval','params':{'command':'echo test'}})
  elif v.get('method')=='turn/steer':
   assert v['params']['expectedTurnId']=='turn'
   assert v['params']['threadId']=='provider-session'
   if 'REJECT_STEERING' in json.dumps(v['params']['input']):
    out({'id':v['id'],'error':{'code':-32600,'message':'Synthetic steering rejection'}})
   else:
    assert 'Revised direction' in json.dumps(v['params']['input'])
    assert 'ATTACHMENT_FIXTURE_CONTENT' in json.dumps(v['params']['input'])
    out({'id':v['id'],'result':{'turnId':'turn'}})
  elif v.get('id')==91:
   assert v['result']['decision']=='accept'
   out({'method':'item/agentMessage/delta','params':{'itemId':'message','delta':'world'}})
   out({'method':'item/completed','params':{'item':{'id':'message','type':'agentMessage','text':'Hello world'}}})
   out({'method':'thread/tokenUsage/updated','params':{'threadId':'provider-session','turnId':'turn','tokenUsage':{'last':{'totalTokens':400,'inputTokens':350,'cachedInputTokens':300},'total':{'totalTokens':999999},'modelContextWindow':1000}}})
   out({'method':'turn/completed','params':{'turn':{'status':'completed'}}})
 elif provider=='claude':
  if v.get('type')=='control_request':
   if v['request']['subtype']=='generate_session_title':
    assert v['request']['persist']==False
    out({'type':'control_response','response':{'request_id':'freddai-title','subtype':'success','response':{'title':'Generated title'}}})
   else:out({'type':'control_response','response':{'request_id':'init','subtype':'success'}})
  elif v.get('type')=='user' and scenario.startswith('bg-'):
   out({'type':'system','subtype':'init','session_id':'provider-session'})
   for n,block in enumerate([{'type':'thinking','thinking':''},{'type':'text','text':'Started the agent.'},{'type':'tool_use','id':'toolu_bg','name':'Bash','input':{'command':'sleep 30','description':'Fixture command','run_in_background':True}} if 'bash' in scenario else {'type':'tool_use','id':'toolu_bg','name':'Agent','input':{'description':'Fixture agent','subagent_type':'general-purpose','run_in_background':True}}]):
    if block['type']=='text':
     out({'type':'stream_event','event':{'type':'message_start','message':{'id':'m1'}}})
     out({'type':'stream_event','event':{'type':'content_block_start','index':n,'content_block':{'type':'text','text':''}}})
     out({'type':'stream_event','event':{'type':'content_block_delta','index':n,'delta':{'type':'text_delta','text':block['text']}}})
    out({'type':'assistant','message':{'id':'m1','content':[block]}})
   if 'bash' in scenario:
    out({'type':'system','subtype':'task_started','task_id':'fixture-bash','tool_use_id':'toolu_bg','task_type':'local_bash','description':'Fixture command'})
    out({'type':'user','message':{'role':'user','content':[{'type':'tool_result','tool_use_id':'toolu_bg','content':'Command running in background with ID: fixture-bash. Output is being written to: /tmp/fixture-bash.output.'}]}})
   else:
    out({'type':'user','message':{'role':'user','content':[{'type':'tool_result','tool_use_id':'toolu_bg','content':[{'type':'text','text':'Async agent launched successfully.\nagentId: fixture-agent (internal)'}]}]}})
   out({'type':'result','is_error':False})
   if scenario=='bg-bash-hang':
    time.sleep(30)
    sys.exit(0)
   time.sleep(1)
   if scenario=='bg-exit': sys.exit(0)
   out({'type':'system','subtype':'task_notification','task_id':'fixture-bash' if 'bash' in scenario else 'fixture-agent','status':'completed','summary':'ok'})
   out({'type':'assistant','message':{'id':'m2','content':[{'type':'text','text':'The agent finished.'}]}})
   out({'type':'result','is_error':False})
  elif v.get('type')=='user':
   assert 'ATTACHMENT_FIXTURE_CONTENT' in json.dumps(v['message']['content'])
   out({'type':'system','subtype':'init','session_id':'provider-session'})
   out({'type':'stream_event','event':{'type':'message_start','message':{'id':'message'}}})
   out({'type':'stream_event','event':{'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}}})
   out({'type':'stream_event','event':{'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':'Hello '}}})
   out({'type':'control_request','request_id':'permission','request':{'subtype':'can_use_tool','tool_name':'Bash','input':{'command':'echo test'}}})
  elif v.get('type')=='control_response':
   assert v['response']['response']['behavior']=='allow'
   out({'type':'stream_event','event':{'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':'world'}}})
   out({'type':'stream_event','event':{'type':'message_stop'}})
   out({'type':'assistant','message':{'id':'message','usage':{'input_tokens':20,'cache_read_input_tokens':80,'cache_creation_input_tokens':10,'output_tokens':5},'content':[{'type':'text','text':'Hello world'}]}})
   out({'type':'result','is_error':False})

 elif provider in ['gemini','antigravity','grok','opencode','cursor','copilot']:
  method=v.get('method')
  if method=='initialize':
   assert v['params']['clientCapabilities']=={}
   out({'jsonrpc':'2.0','id':101,'result':{'protocolVersion':1,'agentCapabilities':{'loadSession':True,'promptCapabilities':{'image':True}},'authMethods':[{'id':'oauth-personal' if provider=='gemini' else 'cached_token'}]}})
  elif method=='authenticate':
   assert provider not in ['antigravity','opencode','cursor','copilot'], 'cached Antigravity sign-in must never open an OAuth flow'
   out({'jsonrpc':'2.0','id':102,'result':{}})
  elif method in ['session/new','session/load']:
   if provider in ['antigravity','opencode','cursor','copilot']:
    assert method=='session/load'
    assert v['params']['sessionId']=='provider-session'
   else: assert method=='session/new'
   out({'jsonrpc':'2.0','id':103,'result':{'sessionId':'provider-session','configOptions':[{'id':'account-model','category':'model','type':'select','options':[{'value':'fixture-model','name':'Fixture'}]}]}})
  elif method=='session/set_config_option':
   assert provider in ['antigravity','opencode','cursor','copilot']
   assert v['params']=={'sessionId':'provider-session','configId':'account-model','value':'fixture-model'}
   model_selected=True
   out({'id':105,'result':{}})
  elif method=='session/prompt':
   if provider in ['antigravity','opencode','cursor','copilot']: assert model_selected
   assert 'ATTACHMENT_FIXTURE_CONTENT' in json.dumps(v['params']['prompt'])
   assert v['params']['sessionId']=='provider-session'
   out({'method':'session/update','params':{'sessionId':'wrong-thread','update':{'sessionUpdate':'session_info_update','title':'Wrong title'}}})
   out({'method':'session/update','params':{'sessionId':'provider-session','update':{'sessionUpdate':'session_info_update','title':'Generated title'}}})
   out({'method':'session/update','params':{'sessionId':'provider-session','update':{'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':'Hello '}}}})
   out({'id':91,'method':'session/request_permission','params':{'sessionId':'provider-session','toolCall':{'title':'echo test'},'options':[{'kind':'allow_once','optionId':'allow'},{'kind':'reject_once','optionId':'deny'}]}})
  elif v.get('method')=='turn/steer':
   assert v['params']['expectedTurnId']=='turn'
   assert v['params']['threadId']=='provider-session'
   if 'REJECT_STEERING' in json.dumps(v['params']['input']):
    out({'id':v['id'],'error':{'code':-32600,'message':'Synthetic steering rejection'}})
   else:
    assert 'Revised direction' in json.dumps(v['params']['input'])
    assert 'ATTACHMENT_FIXTURE_CONTENT' in json.dumps(v['params']['input'])
    out({'id':v['id'],'result':{'turnId':'turn'}})
  elif v.get('id')==91:
   assert v['result']['outcome']=={'outcome':'selected','optionId':'allow'}
   out({'method':'session/update','params':{'sessionId':'provider-session','update':{'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':'world'}}}})
   out({'id':104,'result':{'stopReason':'end_turn'}})
