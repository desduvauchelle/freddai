"""Isolated fixture regression: foreground actions must return keyboard focus.
Starts no accounts or provider turns. Run with signed helper and fixture binary.
"""
import json, subprocess, sys, time
fixtures=[]
p=None
try:
 for args in [[], ['--witness'] + (['--editing'] if '--editing' in sys.argv else [])]:
  fixtures.append(subprocess.Popen([sys.argv[2], *args]))
  time.sleep(0.6)
 p=subprocess.Popen([sys.argv[1]],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
 seq=0
 def call(name,**args):
  global seq
  seq+=1
  p.stdin.write(json.dumps(dict(jsonrpc='2.0',id=seq,method='tools/call',params=dict(name=name,arguments=args)))+'\n');p.stdin.flush()
  r=json.loads(p.stdout.readline())['result']
  assert not r.get('isError'),r
  return json.loads(r['content'][0]['text'])
 def state(): return json.loads(subprocess.check_output(['/tmp/freddai-focus-state'],text=True))
 time.sleep(2.1)
 before=state()
 w=next(w for w in call('computer_windows') if w['pid']==fixtures[0].pid)
 o=call('computer_observe',window_id=w['window_id'])
 button=next(e for e in o['elements'] if e.get('AXTitle')=='Increment')
 o=call('computer_action',observation=o['observation'],action='press',element=button['id'],mode='foreground')
 assert any(e.get('value')=='Count: 1' for e in o['elements']),o
 after=state()
 assert after['pid']==before['pid'],f'Focus stolen: {before} -> {after}'
 if '--allow-human-motion' not in sys.argv: assert after['mouse']==before['mouse'],f'Pointer moved: {before} -> {after}'
 print('PASS: foreground accessible action changed target, preserved foreground app')
 o=call('computer_observe',window_id=w['window_id'])
 if '--editing' in sys.argv:
  seq+=1
  p.stdin.write(json.dumps(dict(jsonrpc='2.0',id=seq,method='tools/call',params=dict(name='computer_action',arguments=dict(observation=o['observation'],action='key',key='tab',mode='foreground'))))+'\n');p.stdin.flush()
  r=json.loads(p.stdout.readline())['result']
  assert r.get('isError') and 'user is editing text' in r['content'][0]['text'],r
  print('PASS: foreground keyboard takeover refused while witness text field focused')
 else:
  call('computer_action',observation=o['observation'],action='key',key='tab',mode='foreground')
  print('PASS: foreground keyboard action dispatched and original focus restored')
 after=state()
 assert after['pid']==before['pid'],(before,after)
 if '--allow-human-motion' not in sys.argv: assert after['mouse']==before['mouse'],(before,after)
 else: print('Pointer preservation assertion skipped: concurrent human movement permitted')
finally:
 if p:
  p.stdin.close();p.wait(timeout=5)
 for fixture in fixtures: fixture.terminate();fixture.wait(timeout=5)
