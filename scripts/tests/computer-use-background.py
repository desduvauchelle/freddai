"""Two native fixtures must be running: target and --witness (foreground).
Verifies actual target state plus unchanged foreground app and mouse location.
"""
import json, subprocess, sys, time, base64
p = subprocess.Popen([sys.argv[1]],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
seq=0
def call(name, **args):
 global seq
 seq+=1
 p.stdin.write(json.dumps(dict(jsonrpc='2.0',id=seq,method='tools/call',params=dict(name=name,arguments=args)))+'\n');p.stdin.flush()
 return json.loads(p.stdout.readline())['result']
def data(r):
 assert not r.get('isError'),r
 return json.loads(r['content'][0]['text'])
def desktop():
 return json.loads(subprocess.check_output(['/tmp/freddai-focus-state'],text=True))
try:
 before=desktop()
 w=next(w for w in data(call('computer_windows')) if w['title']=='Freddai Computer Test Fixture')
 assert before['pid']!=w['pid'], 'Target must be in background'
 o=data(call('computer_observe',window_id=w['window_id']))
 old=int(next(e['value'].split(': ')[1] for e in o['elements'] if e.get('value','').startswith('Count: ')))
 button=next(e for e in o['elements'] if e.get('AXTitle')=='Increment')
 b=button['bounds'];x=round(b['x']+b['width']/2);y=round(b['y']+b['height']/2)
 r=call('computer_action',observation=o['observation'],action='click',x=x,y=y);o=data(r)
 assert any(e.get('value')==f'Count: {old+1}' for e in o['elements']),o
 after=desktop();assert after['pid']==before['pid'],(before,after)
 print('Background coordinate click changed counter without changing foreground app.')
 field=next(e for e in o['elements'] if e.get('AXRole')=='AXTextField')
 o=data(call('computer_action',observation=o['observation'],action='set_value',element=field['id'],text='Background edit ✓'))
 assert any(e.get('value')=='Background edit ✓' for e in o['elements']),o
 after=desktop();assert after['pid']==before['pid'],(before,after)
 if '--allow-human-motion' in sys.argv and after['mouse']!=before['mouse']:
  print('Background field editing verified; foreground app unchanged. Pointer assertion skipped during human movement.')
 else:
  assert after['mouse']==before['mouse'], 'Mouse changed during test (human movement also triggers this check)'
  print('Background field editing verified; foreground app and real pointer remained unchanged.')
 r=call('computer_action',observation=o['observation'],action='key',key='return')
 assert r.get('isError') and 'unavailable in background' in r['content'][0]['text'],r
 print('Unsupported background key refused without falling back.')
 o=data(call('computer_observe',window_id=w['window_id']))
 r=call('computer_action',observation=o['observation'],action='hover',x=x,y=y);data(r)
 overlays=desktop()['overlays']; assert overlays, 'Agent cursor window is not visible'
 subprocess.run(['/usr/sbin/screencapture','-x','-l',str(overlays[0]),'/tmp/freddai-background-cursor.png'],check=True)
 assert desktop()['pid']==before['pid']
 print('Captured visible cursor; hover did not activate target.')
finally:
 p.stdin.close();p.wait(timeout=5)
