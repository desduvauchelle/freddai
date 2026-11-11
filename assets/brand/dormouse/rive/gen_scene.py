"""Import approved v3 geometry and author a local Rive state machine.
Run python3 gen_scene.py, then ~/.rive/bin/rive . --verify.
No scripts, network, provider sessions, or application integration.
"""
from pathlib import Path
import math
import re
import xml.etree.ElementTree as ET
import vector_tools as v

HERE = Path(__file__).resolve().parent
svg = ET.parse(HERE.parent / 'dormouse-v3.svg').getroot()
TAG = '{http://www.w3.org/2000/svg}'
uid = 0

def unique(prefix):
    global uid
    uid += 1
    return f'{prefix}_{uid}'

def transform(parent, text):
    sx, sy, tx, ty = parent
    for name, arg in re.findall(r'(translate|scale)\(([^)]+)\)', text):
        nums = [float(n) for n in re.split(r'[ ,]+', arg.strip())]
        if name == 'translate':
            tx += sx * nums[0]
            ty += sy * (nums[1] if len(nums) > 1 else 0)
        else:
            sx *= nums[0]
            sy *= nums[1] if len(nums) > 1 else nums[0]
    return sx, sy, tx, ty

def point(x, y, m):
    return (x*m[0]+m[2], y*m[1]+m[3])

def color(c):
    c = {'white':'#FFFFFF', 'black':'#000000'}.get(c,c)
    if c in (None, 'none'):
        return None
    if c.startswith('url(#'):
        return c[5:-1]
    assert re.fullmatch(r'#[0-9a-fA-F]{6}', c), c
    return 'FF'+c[1:].upper()

# Preserve SVG's supported radial gradients, including non-square bounding boxes.
grads = {e.get('id'): e for e in svg.iter() if e.tag == TAG+'radialGradient'}
def paint(c, bbox, ind):
    if c not in grads:
        return f'{ind}<SolidColor colorValue="{c}" name="Color"/>\n'
    el = grads[c]
    x0,y0,x1,y1 = bbox
    w,h = x1-x0,y1-y0
    frac = lambda name, default: float(el.get(name, default).rstrip('%'))/100
    sx,sy = x0+frac('cx','50%')*w,y0+frac('cy','50%')*h
    radius = frac('r','50%')*w
    result = f'{ind}<RadialGradient startX="{sx}" startY="{sy}" endX="{sx+radius}" endY="{sy}" transformScaleY="{h/w if w else 1}" name="Gradient">\n'
    for stop in el:
        result += f'{ind}  <GradientStop colorValue="{color(stop.get("stop-color"))}" position="{float(stop.get("offset","0"))}"/>\n'
    return result+f'{ind}</RadialGradient>\n'
v.color_xml = paint

pivots = {'head':(627,735),'body':(627,1050),'ear-left':(410,310),
          'ear-right':(844,310),'paw-left':(405,790),'paw-right':(849,790),
          'tail':(400,1030),'nose':(626,600),'brows':(627,360),
          'mouth':(627,665),'eye-left':(470,509),'eye-right':(788,509),
          'pupil-left':(470,509),'pupil-right':(788,509)}
clips = {e.get('id'):e[0] for e in svg.iter() if e.tag==TAG+'clipPath'}

def geometry(el, style, m, name):
    fill,stroke = color(style.get('fill','#000000')),color(style.get('stroke'))
    sw = float(style.get('stroke-width','1'))*math.sqrt(abs(m[0]*m[1]))
    tag=el.tag.removeprefix(TAG)
    if tag in ('circle','ellipse'):
        x,y=point(float(el.get('cx','0')),float(el.get('cy','0')),m)
        rx=float(el.get('r',el.get('rx','0')))*m[0]
        ry=float(el.get('r',el.get('ry','0')))*m[1]
        return v.S(name,fill=fill,stroke=stroke,sw=sw,ell=(x,y,rx,ry))
    assert tag=='path', tag
    # Bake static SVG transforms into geometry, leaving named animation pivots free.
    paths=[]
    for sub in v.parse_path(el.get('d')):
        pts=sub['pts']
        x,y=point(*pts[0]['p'],m)
        d=f'M{x} {y}'
        pairs=list(zip(pts,pts[1:]))
        if sub['closed']:
            pairs.append((pts[-1],pts[0]))
        for a,b in pairs:
            c1=point(a['p'][0]+a['out'][0],a['p'][1]+a['out'][1],m)
            c2=point(b['p'][0]+b['in'][0],b['p'][1]+b['in'][1],m)
            end=point(*b['p'],m)
            d+=f'C{c1[0]} {c1[1]} {c2[0]} {c2[1]} {end[0]} {end[1]}'
        paths.append(d+('Z' if sub['closed'] else ''))
    return v.S(name,paths,fill,stroke,sw=sw)

def parse(el, inherited=None, matrix=(1,1,0,0)):
    tag=el.tag.removeprefix(TAG)
    if tag in ('defs','title','desc'):
        return None
    style=dict(inherited or {})
    for key in ('fill','stroke','stroke-width'):
        if key in el.attrib:
            style[key]=el.get(key)
    m=transform(matrix,el.get('transform',''))
    name=el.get('id') or unique(tag)
    if tag in ('svg','g'):
        kids=[n for c in el if (n:=parse(c,style,m)) is not None]
        node=v.N(name,pivots.get(name,(0,0)),kids)
        if el.get('clip-path'):
            key=el.get('clip-path')[5:-1]
            mask=geometry(clips[key],{'fill':'none','stroke':'none'},m,unique('clip'))
            node.kids.insert(0,mask)
            node.clip=mask.name
        return node
    return geometry(el,style,m,name)

art=parse(svg)
INK='FF382610'
# Keep the chosen SVG unchanged: all additions live only in the Rive rig.
head=v.BY_NAME['head']
head.kids += [
    v.N('ClosedWrap',(627,509),[v.N('ClosedEyes',(627,509),[v.S('ClosedLashLeft',['M430 509Q470 521 510 509'],None,INK,sw=10),v.S('ClosedLashRight',['M748 509Q788 521 828 509'],None,INK,sw=10)],opacity=0)]),
    # Happy ^ ^ eyes for Done: thicker than the closed-lash blink so they read at 38 px.
    v.N('HappyEyes',(627,509),[v.S('HappyLeft',['M418 538Q470 462 522 538'],None,INK,sw=24),v.S('HappyRight',['M736 538Q788 462 840 538'],None,INK,sw=24)],opacity=0),
    v.N('Smile',(627,665),[v.S('SmilePath',['M572 655Q627 735 682 655Z'],'FF6B3D27',INK,sw=8)],opacity=0),
    v.N('Concern',(627,665),[v.S('ConcernPath',['M590 686Q627 651 664 686'],None,INK,sw=10)],opacity=0),
    v.N('Thought',(627,665),[v.S('ThoughtPath',['M608 675Q628 681 648 672'],None,INK,sw=10)],opacity=0),
]
# Ear pose wrappers let moods perk or droop ears without fighting the idle ear flick.
for side in ('left','right'):
    ear=v.BY_NAME['ear-'+side]
    wrap=v.N('EarPose'+side[0].upper(),pivots['ear-'+side],[ear])
    head.kids[head.kids.index(ear)]=wrap
# Blink and gaze are independent of the persistent expression state.
for side in ('left','right'):
    eye=v.BY_NAME['eye-'+side]
    blink=v.N('Blink-'+side,eye.pivot,list(eye.kids))
    eye.kids=[blink]
    pupil=v.BY_NAME['pupil-'+side]
    gaze=v.N('Gaze-'+side,pupil.pivot,list(pupil.kids))
    pupil.kids=[gaze]
headpose=v.N('HeadPose',(627,735),[head])
def replace_child(node,old,new):
    if isinstance(node,v.S):
        return False
    for i,child in enumerate(node.kids):
        if child is old:
            node.kids[i]=new
            return True
        if replace_child(child,old,new):
            return True
    return False
replace_child(art,head,headpose)

# Arms: the existing paws ride inside shoulder-pivoted wrappers. A hidden capsule
# (same fur and outline) grows from the shoulder when a paw is raised.
ARM_DY=250
ARM_L=ARM_DY+40
SHOULDER={'L':(420,800),'R':(834,800)}
for side,key in (('L','left'),('R','right')):
    paw=v.BY_NAME['paw-'+key]
    sx,sy=SHOULDER[side]
    shape=v.N('ArmShape'+side,(sx,sy),[v.S('ArmCapsule'+side,fill='FFC08B57',stroke=INK,sw=17,rect=(sx,sy+ARM_L/2,98,ARM_L,49))])
    arm=v.N('Arm'+side,(sx,sy),[shape,paw])
    replace_child(art,paw,arm)

# Overlay props in the same palette and line weight. They sit above the character.
GOLD='FFFFD76E'
WATER='FFBFE4F2'
def star(name,cx,cy,R):
    c=.16*R
    d=f'M{cx} {cy-R}Q{cx+c} {cy-c} {cx+R} {cy}Q{cx+c} {cy+c} {cx} {cy+R}Q{cx-c} {cy+c} {cx-R} {cy}Q{cx-c} {cy-c} {cx} {cy-R}Z'
    return v.N(name,(cx,cy),[v.S(name+'Shape',[d],GOLD,INK,sw=10)])
def dot(name,cx,cy,r):
    return v.N(name,(cx,cy),[v.S(name+'Shape',fill=INK,ell=(cx,cy,r,r))])
think=v.N('ThinkBubble',(1060,150),[
    v.S('ThinkTail1',fill='cream',stroke=INK,sw=10,ell=(950,240,16,16)),
    v.S('ThinkTail2',fill='cream',stroke=INK,sw=10,ell=(932,268,10,10)),
    v.S('ThinkCloud',fill='cream',stroke=INK,sw=12,ell=(1060,150,130,86)),
    dot('Dot1',1005,150,26),dot('Dot2',1060,150,26),dot('Dot3',1115,150,26)],opacity=0)
qb=v.N('QBubble',(1075,180),[
    v.S('QTail1',fill='cream',stroke=INK,sw=10,ell=(962,292,16,16)),
    v.S('QTail2',fill='cream',stroke=INK,sw=10,ell=(942,322,10,10)),
    v.S('QCloud',fill='cream',stroke=INK,sw=12,ell=(1075,180,105,98)),
    v.S('QMark',['M1030 138Q1030 100 1075 100Q1120 100 1120 138Q1120 168 1090 182Q1075 190 1075 214'],None,INK,sw=22),
    v.S('QDot',fill=INK,ell=(1075,247,14,14))],opacity=0)
pause=v.N('PauseIcon',(1100,170),[
    v.S('PauseBarL',fill='cream',stroke=INK,sw=11,rect=(1045,170,74,190,26)),
    v.S('PauseBarR',fill='cream',stroke=INK,sw=11,rect=(1150,170,74,190,26))],opacity=0)
sweat=v.N('SweatDrop',(985,395),[v.S('SweatShape',['M985 335Q940 395 940 420Q940 460 985 460Q1030 460 1030 420Q1030 395 985 335Z'],WATER,INK,sw=10),
    v.S('SweatShine',['M963 420Q963 438 975 444'],None,'FFFFFFFF',sw=7)],opacity=0)
STARS={'StarA':(170,120,80),'StarB':(1070,95,100),'StarC':(1135,370,62),'StarD':(100,345,55)}
star_nodes=[star(n,*a) for n,a in STARS.items()]
for s_ in star_nodes:
    s_.props['opacity']=0

# ---- Antic props (moods 9-14). Everything defaults to opacity 0 and is reset by `base`.
CORAL='FFE98A7A'
GREEN='FF7DBF6B'
GREEN2='FFB4D96A'
def smp(total,step,fn):
    """Linear-sampled keys for smooth periodic motion."""
    return [v.kf(fr,fn(fr),'linear') for fr in range(0,total+1,step)]
def parent_of(node,target=None):
    target=target or node
    stack=[art]
    while stack:
        n=stack.pop()
        if isinstance(n,v.S): continue
        if target in n.kids: return n
        stack+=n.kids
# Hula: grass skirt + flower lei (ride with the body, inside Groove)
SKIRT_N=10
strand_nodes=[]
for i in range(SKIRT_N):
    x=418+i*(418/(SKIRT_N-1))
    col=GREEN if i%2==0 else GREEN2
    d=f'M{x-12:.1f} 960L{x+12:.1f} 960Q{x+10:.1f} 1060 {x+2:.1f} 1165Q{x:.1f} 1175 {x-2:.1f} 1165Q{x-10:.1f} 1060 {x-12:.1f} 960Z'
    strand_nodes.append(v.N(f'Strand{i}',(x,960),[v.S(f'StrandShape{i}',[d],col,INK,sw=5)]))
skirt=v.N('Skirt',(627,960),strand_nodes+[v.S('SkirtBand',fill=CORAL,stroke=INK,sw=9,rect=(627,958,470,42,21))])
LEI_COLS=[CORAL,GOLD,'FFFFFFFF',WATER,CORAL,GOLD,'FFFFFFFF',WATER]
lei_kids=[]
for i in range(8):
    a=math.radians(20+i*(140/7))
    cx,cy=627+140*math.cos(a),815+64*math.sin(a)
    lei_kids.append(v.S(f'LeiFlower{i}',fill=LEI_COLS[i],stroke=INK,sw=7,ell=(cx,cy,22,22)))
lei=v.N('Lei',(627,815),lei_kids)
# Skate: board under the feet, plus speed lines
deck_d='M452 1078Q468 1098 498 1098L756 1098Q786 1098 802 1078Q812 1104 782 1128L472 1128Q442 1104 452 1078Z'
board=v.N('Board',(627,1112),[
    v.N('WheelB',(520,1152),[v.S('WheelBShape',fill='cream',stroke=INK,sw=10,ell=(520,1152,26,26)),v.S('WheelBHub',fill=INK,ell=(532,1152,6,6))]),
    v.N('WheelF',(734,1152),[v.S('WheelFShape',fill='cream',stroke=INK,sw=10,ell=(734,1152,26,26)),v.S('WheelFHub',fill=INK,ell=(746,1152,6,6))]),
    v.S('BoardDeck',[deck_d],CORAL,INK,sw=11)])
speed_nodes=[v.N('Speed'+n,(x0,y0),[v.S('SpeedLine'+n,[f'M{x0} {y0}L{x0+L} {y0}'],None,INK,sw=9)]) for n,x0,y0,L in (('A',110,800,200),('B',60,885,240),('C',150,970,170))]
# Gaming: controller sits in the character tree just under the arms so the paws draw on top of it
CTRL=(627,915)
controller=v.N('Controller',CTRL,[
    v.S('CtrlGripL',fill='cream',stroke=INK,sw=14,ell=(505,1000,60,76)),
    v.S('CtrlGripR',fill='cream',stroke=INK,sw=14,ell=(749,1000,60,76)),
    v.S('CtrlBody',fill='cream',stroke=INK,sw=14,rect=(627,915,370,180,64)),
    v.S('DpadH',fill=INK,rect=(525,930,72,24,8)),v.S('DpadV',fill=INK,rect=(525,930,24,72,8)),
    v.S('BtnA',fill=CORAL,stroke=INK,sw=6,ell=(735,895,16,16)),v.S('BtnB',fill=GOLD,stroke=INK,sw=6,ell=(735,963,16,16)),
    v.S('BtnC',fill=WATER,stroke=INK,sw=6,ell=(701,929,16,16)),v.S('BtnD',fill=GREEN,stroke=INK,sw=6,ell=(769,929,16,16))],opacity=0)
_arm=v.BY_NAME['ArmL']; _par=parent_of(_arm)
_par.kids.insert(_par.kids.index(_arm),controller)
# Snooze: held closed lashes (separate from the idle blink) and floating Zs
head.kids.append(v.N('SleepEyes',(627,509),[v.S('SleepLeft',['M424 516Q470 550 516 516'],None,INK,sw=13),v.S('SleepRight',['M742 516Q788 550 834 516'],None,INK,sw=13)],opacity=0))
def zglyph(name,cx,cy,s):
    return v.N(name,(cx,cy),[v.S(name+'Shape',[f'M{cx-s} {cy-s}L{cx+s} {cy-s}L{cx-s} {cy+s}L{cx+s} {cy+s}'],None,INK,sw=16)],opacity=0)
zs=[zglyph('ZA',1010,215,24),zglyph('ZB',1070,140,34),zglyph('ZC',1125,60,46)]
# Juggle
BALLS=[('Ball1',GOLD),('Ball2',WATER),('Ball3',CORAL)]
ball_nodes=[v.N(n,(320,880),[v.S(n+'Shape',fill=c,stroke=INK,sw=10,ell=(320,880,60,60)),v.S(n+'Glint',fill='FFFFFFFF',ell=(298,858,15,15))]) for n,c in BALLS]
# Jam: headphones on the head, floating notes
head.kids.append(v.N('Headphones',(627,360),[
    v.S('PhoneBand',['M404 330C390 50 864 50 850 330'],None,INK,sw=22),
    v.S('PhoneCupL',fill=CORAL,stroke=INK,sw=12,rect=(404,360,92,112,34)),
    v.S('PhoneCupR',fill=CORAL,stroke=INK,sw=12,rect=(850,360,92,112,34))],opacity=0))
def note(name,cx,cy):
    return v.N(name,(cx,cy),[v.S(name+'Head',fill=INK,ell=(cx,cy,24,18)),
        v.S(name+'Stem',[f'M{cx+20} {cy}L{cx+20} {cy-95}'],None,INK,sw=10),
        v.S(name+'Flag',[f'M{cx+20} {cy-95}Q{cx+66} {cy-80} {cx+52} {cy-42}'],None,INK,sw=10)])
notes=[note('NoteA',150,420),note('NoteB',1040,380),note('NoteC',215,230)]

groove=v.N('Groove',(627,1080),[board,art,skirt,lei])
breath=v.N('Breath',(627,1080),[groove])
hop=v.N('Hop',(627,1080),[breath])
sway=v.N('Sway',(627,1080),[hop])
poke=v.N('Poke',(627,1080),[sway])
world=v.N('World',(0,0),[poke,think,qb,pause,sweat]+star_nodes+speed_nodes+zs+ball_nodes+notes)

def locals_(node, parent=(0,0)):
    if isinstance(node,v.S):
        return
    node.local=(node.pivot[0]-parent[0],node.pivot[1]-parent[1])
    for child in node.kids:
        locals_(child,node.pivot)
locals_(world)

S0=40/ARM_L
# Each mood layer state owns this set of properties; every mood resets all of them.
base={'HeadPose':{'rotation':0,'y':0},'Hop':{'y':0},
      'brows':{'y':0,'rotation':0},
      'paw-left':{'rotation':0,'x':0,'y':0,'scaleX':1,'scaleY':1},'paw-right':{'rotation':0,'x':0,'y':0,'scaleX':1,'scaleY':1},
      'ArmL':{'rotation':0},'ArmR':{'rotation':0},
      'ArmShapeL':{'opacity':0,'scaleY':S0},'ArmShapeR':{'opacity':0,'scaleY':S0},
      'mouth':{'opacity':1},'Smile':{'opacity':0},'Concern':{'opacity':0},'Thought':{'opacity':0},
      'eye-left':{'scaleY':1,'opacity':1},'eye-right':{'scaleY':1,'opacity':1},
      'HappyEyes':{'opacity':0},'ClosedWrap':{'opacity':1},
      'pupil-left':{'x':0,'y':0},'pupil-right':{'x':0,'y':0},
      'EarPoseL':{'rotation':0,'x':0,'y':0,'scaleY':1},'EarPoseR':{'rotation':0,'x':0,'y':0,'scaleY':1},
      'tail':{'rotation':0},
      'ThinkBubble':{'opacity':0,'y':0},'QBubble':{'opacity':0,'y':0,'scaleX':1,'scaleY':1},
      'PauseIcon':{'opacity':0,'scaleX':1,'scaleY':1},'SweatDrop':{'opacity':0,'y':0,'scaleX':1,'scaleY':1},
      'Dot1':{'scaleX':1,'scaleY':1},'Dot2':{'scaleX':1,'scaleY':1},'Dot3':{'scaleX':1,'scaleY':1}}
base.update({'Groove':{'x':0,'y':0,'rotation':0,'scaleX':1,'scaleY':1},
  'Smile':{'opacity':0,'scaleX':1,'scaleY':1},
  'Skirt':{'opacity':0},'Lei':{'opacity':0},
  'Board':{'opacity':0,'rotation':0},'WheelB':{'rotation':0},'WheelF':{'rotation':0},
  'Controller':{'opacity':0,'rotation':0},'SleepEyes':{'opacity':0},'Headphones':{'opacity':0}})
for _i in range(SKIRT_N): base[f'Strand{_i}']={'rotation':0}
for _n in 'ABC': base['Speed'+_n]={'opacity':0,'x':0}
for _n in zs: base[_n.name]={'opacity':0,'x':0,'y':0,'scaleX':1,'scaleY':1}
for _n in ball_nodes: base[_n.name]={'opacity':0,'x':0,'y':0}
for _n in notes: base[_n.name]={'opacity':0,'x':0,'y':0}
v.MOOD_PROPS={(o,p):val for o,ps in base.items() for p,val in ps.items()}
for (o,p),val in v.MOOD_PROPS.items():
    if p not in ('y',):
        v.DEFAULTS[o,p]=val
# Celebration layer objects (sway, stars) are reset by their own layer, not by moods.
for name in STARS:
    v.DEFAULTS[name,'opacity']=0
k=v.kf

def track(values,ease='io'):
    return [k(frame,value,ease) for frame,value in values]
def hold(values):
    return [k(frame,value,'hold') for frame,value in values]
def make(name,frames,loop,tracks,defaults=False):
    return v.anim(name,frames,'loop' if loop else 'oneShot',tracks,fill_defaults=defaults)

def arms(sides,keys,paw_flap=None):
    """keys: (frame, raise_angle, extension 0..1[, ease]); angle in radians for the left arm, mirrored for the right.
    The paw slides out along the arm while the arm capsule grows to meet it."""
    out={}
    for side,key,sign,dx in (('L','left',1,15),('R','right',-1,-15)):
        if side not in sides:
            continue
        rot,ext,shape,opac,px_,flap,pawsc=[],[],[],[],[],[],[]
        prev_ext=0
        for i,item in enumerate(keys):
            fr,ang,e=item[:3]
            ease=item[3] if len(item)>3 else 'io'
            rot.append(k(fr,sign*ang,ease)); pawsc.append((fr,e,ease))
            ext.append(k(fr,e*ARM_DY,ease))
            px_.append(k(fr,e*dx,ease))
            shape.append(k(fr,(e*ARM_DY+40)/ARM_L,ease))
            if e>0.001 and (i==0 or prev_ext<=0.001):
                opac.append(k(0 if i==0 else prev_fr+1,1,'hold'))
            elif e<=0.001:
                opac.append(k(fr,0,'hold'))
            prev_ext=e; prev_fr=fr
        out['Arm'+side]={'rotation':rot}
        out['ArmShape'+side]={'scaleY':shape,'opacity':opac}
        out['paw-'+key]={'y':ext,'x':px_,'scaleX':[k(fr_,1+.3*e_,ea_) for fr_,e_,ea_ in pawsc],'scaleY':[k(fr_,1+.3*e_,ea_) for fr_,e_,ea_ in pawsc]}
        if paw_flap:
            out['paw-'+key]['rotation']=[k(fr,sign*val) for fr,val in paw_flap]
    return out
def merge(*parts):
    out={}
    for part in parts:
        for obj,props in part.items():
            out.setdefault(obj,{}).update(props)
    return out
def cycle(frame_vals,period,total,amp_a,amp_b):
    """Alternating a/b keys every `period` frames until `total`."""
    return track([(i*period,amp_a if i%2==0 else amp_b) for i in range(total//period+1)])

idle={
 'Breath':{'scaleY':track([(0,1),(90,1.012),(180,1),(270,1.012),(360,1),(450,1.012),(540,1),(600,1)]),
           'scaleX':track([(0,1),(90,.995),(180,1),(270,.995),(360,1),(450,.995),(540,1),(600,1)])},
 'nose':{'y':track([(0,0),(294,0),(300,-4),(306,1),(312,-3),(320,0),(600,0)])},
 'ear-left':{'rotation':track([(0,0),(120,0),(128,-.13),(142,.04),(155,0),(600,0)])},
 'ear-right':{'rotation':track([(0,0),(480,0),(488,.13),(502,-.04),(515,0),(600,0)])},
}
for side in ('left','right'):
    idle['Blink-'+side]={'scaleY':track([(0,1),(182,1),(188,.045),(192,.045),(200,1),(408,1),(414,.045),(420,1),(432,.045),(440,1),(600,1)])}
idle['ClosedEyes']={'opacity':[k(fr,val,'hold') for fr,val in [(0,0),(188,1),(193,0),(414,1),(417,0),(432,1),(436,0),(600,0)]]}
a_idle=make('IdleLife',600,True,idle)

# ---- Mood 2: Working (loop, 72 frames = two head bobs, paws alternating, tail wagging, dots bubble)
WORK=72
def dot_pulse(t0):
    out=[]
    for off in (0,36):
        a=t0+off
        out+=[(a,1),(a+8,1.7),(a+18,1)]
    return sorted(set(out))
def dot_keys(t0):
    pts=[(0,1)]+[p for p in dot_pulse(t0) if p[0]>0]+[(WORK,1)]
    seen={};
    for fr,val in pts:
        seen[fr]=val
    return track(sorted(seen.items()))
working=merge({
 'HeadPose':{'y':track([(0,10),(18,118),(36,10),(54,118),(72,10)]),
             'rotation':track([(0,-.05),(36,.05),(72,-.05)])},
 'brows':{'y':[k(0,16)]},
 'eye-left':{'scaleY':[k(0,.78)]},'eye-right':{'scaleY':[k(0,.78)]},
 'pupil-left':{'y':[k(0,26)]},'pupil-right':{'y':[k(0,26)]},
 'mouth':{'opacity':[k(0,0)]},'Thought':{'opacity':[k(0,1)]},
 'paw-left':{'x':[k(0,70)],'y':track([(0,110),(18,35),(36,110),(54,35),(72,110)]),
             'rotation':track([(0,-.4),(18,.15),(36,-.4),(54,.15),(72,-.4)])},
 'paw-right':{'x':[k(0,-70)],'y':track([(0,35),(18,110),(36,35),(54,110),(72,35)]),
              'rotation':track([(0,-.15),(18,.4),(36,-.15),(54,.4),(72,-.15)])},
 'tail':{'rotation':track([(i*9,.14 if i%2==0 else -.14) for i in range(9)])},
 'ThinkBubble':{'opacity':[k(0,1)],'y':track([(0,0),(36,-8),(72,0)])},
 'Dot1':{'scaleX':dot_keys(0),'scaleY':dot_keys(0)},
 'Dot2':{'scaleX':dot_keys(12),'scaleY':dot_keys(12)},
 'Dot3':{'scaleX':dot_keys(24),'scaleY':dot_keys(24)},
})

# ---- Mood 4: Waiting for you (loop, 120 frames): paw raised and waving, "?" bubble, ears perked
UP=2.5
WAIT=120
wave=[(0,UP-.2,1),(30,UP+.2,1),(60,UP-.2,1),(90,UP+.2,1),(120,UP-.2,1)]
waiting=merge(arms('L',wave,paw_flap=[(0,.2),(30,-.2),(60,.2),(90,-.2),(120,.2)]),{
 'HeadPose':{'rotation':track([(0,.07),(60,.1),(120,.07)]),'y':track([(0,-6),(60,0),(120,-6)])},
 'brows':{'y':[k(0,-26)]},
 'eye-left':{'scaleY':[k(0,1.06)]},'eye-right':{'scaleY':[k(0,1.06)]},
 'EarPoseL':{'rotation':track([(0,.12),(60,.3),(120,.12)]),'y':[k(0,-22)]},
 'EarPoseR':{'rotation':track([(0,-.12),(60,-.3),(120,-.12)]),'y':[k(0,-22)]},
 'QBubble':{'opacity':[k(0,1)],'y':track([(0,0),(60,-16),(120,0)]),
            'scaleX':track([(0,1),(60,1.06),(120,1)]),'scaleY':track([(0,1),(60,1.06),(120,1)])},
 'tail':{'rotation':track([(0,0),(30,.08),(60,0),(90,.08),(120,0)])},
})

# ---- Mood 6: Done (one-shot, ends in a held content pose; sparkles/sway continue on the Celebrate layer)
done_arm=[(0,0,0),(14,2.6,1,'back'),(40,2.35,1),(56,2.6,1),(84,2.45,1),(118,0,0)]
done=merge(arms('LR',done_arm),{
 'Hop':{'y':track([(0,0),(8,14),(24,-105),(36,-92),(50,5),(56,0),(64,0),(74,-48),(86,0),(150,0)])},
 'HeadPose':{'rotation':track([(0,0),(24,-.07),(50,.06),(80,-.04),(110,0)]),'y':track([(0,0),(8,10),(24,-8),(50,6),(60,0)])},
 'brows':{'y':[k(0,-8)]},
 'eye-left':{'opacity':hold([(0,0)])},'eye-right':{'opacity':hold([(0,0)])},
 'HappyEyes':{'opacity':hold([(0,1)])},'ClosedWrap':{'opacity':hold([(0,0)])},
 'mouth':{'opacity':[k(0,0)]},'Smile':{'opacity':[k(0,1)]},
 'EarPoseL':{'rotation':[k(0,.1)],'y':[k(0,-10)]},'EarPoseR':{'rotation':[k(0,-.1)],'y':[k(0,-10)]},
 'tail':{'rotation':track([(0,0),(10,.16),(20,-.16),(30,.16),(40,-.16),(50,.16),(62,-.1),(76,.1),(90,0),(150,0)])},
})

# ---- Mood 7: Interrupted (held "pause" stance: slumped, half-lidded, paws down, pause mark)
interrupted=merge({
 'HeadPose':{'y':track([(0,0),(26,34),(90,34)]),'rotation':track([(0,0),(26,-.05),(90,-.05)])},
 'brows':{'y':track([(0,0),(24,12),(90,12)])},
 'eye-left':{'scaleY':track([(0,1),(24,.42),(90,.42)])},'eye-right':{'scaleY':track([(0,1),(24,.42),(90,.42)])},
 'pupil-left':{'y':track([(0,0),(24,16),(90,16)])},'pupil-right':{'y':track([(0,0),(24,16),(90,16)])},
 'mouth':{'opacity':[k(0,0)]},'Thought':{'opacity':[k(0,1)]},
 'EarPoseL':{'rotation':track([(0,0),(26,-.22),(90,-.22)]),'y':track([(0,0),(26,16),(90,16)])},
 'EarPoseR':{'rotation':track([(0,0),(26,.22),(90,.22)]),'y':track([(0,0),(26,16),(90,16)])},
 'tail':{'rotation':track([(0,0),(26,-.1),(90,-.1)])},
 'PauseIcon':{'opacity':hold([(0,0),(14,1)]),'scaleX':track([(0,0),(14,0),(34,1)],'back'),'scaleY':track([(0,0),(14,0),(34,1)],'back')},
})

# ---- Mood 8: Failed (held: frown, droopy ears, sweat drop)
failed=merge({
 'HeadPose':{'y':track([(0,0),(30,40),(108,40)]),'rotation':track([(0,0),(18,-.05),(34,.04),(52,-.02),(108,-.02)])},
 'brows':{'y':track([(0,0),(24,-10),(108,-10)]),'rotation':[k(0,-.04)]},
 'eye-left':{'scaleY':track([(0,1),(26,.9),(108,.9)])},'eye-right':{'scaleY':track([(0,1),(26,.9),(108,.9)])},
 'mouth':{'opacity':[k(0,0)]},'Concern':{'opacity':[k(0,1)]},
 'EarPoseL':{'rotation':track([(0,0),(28,-.9),(108,-.9)]),'x':track([(0,0),(28,-70),(108,-70)]),'y':track([(0,0),(28,70),(108,70)]),'scaleY':track([(0,1),(28,.88),(108,.88)])},
 'EarPoseR':{'rotation':track([(0,0),(28,.9),(108,.9)]),'x':track([(0,0),(28,70),(108,70)]),'y':track([(0,0),(28,70),(108,70)]),'scaleY':track([(0,1),(28,.88),(108,.88)])},
 'tail':{'rotation':track([(0,0),(30,-.16),(108,-.16)])},
 'SweatDrop':{'opacity':hold([(0,0),(30,1)]),'scaleX':track([(0,0),(30,.3),(46,1.5)],'back'),'scaleY':track([(0,0),(30,.3),(46,1.5)],'back'),
              'y':track([(0,0),(30,-10),(108,34)],'soft')},
})

# ================= Antic moods 9-14 (random idle anticks; all loop) =================
def sw(period,hi,lo,total,phase=0):
    """Alternating hi/lo every `period` frames (total must be a whole number of 2*period)."""
    return track([(i*period,hi if (i+phase)%2==0 else lo) for i in range(total//period+1)])
def const(val): return [k(0,val)]
HAPPY={'eye-left':{'opacity':hold([(0,0)])},'eye-right':{'opacity':hold([(0,0)])},
       'HappyEyes':{'opacity':hold([(0,1)])},'ClosedWrap':{'opacity':hold([(0,0)])}}
SMILE={'mouth':{'opacity':[k(0,0)]},'Smile':{'opacity':[k(0,1)]}}

# ---- 9 Hula
HULA=144
def hula_arm(sign_r):
    return [(0,-1.2*sign_r,.8),(36,1.2*sign_r,.8),(72,-1.2*sign_r,.8),(108,1.2*sign_r,.8),(144,-1.2*sign_r,.8)]
hula_tracks={
 'Groove':{'x':track([(0,-18),(36,18),(72,-18),(108,18),(144,-18)]),'rotation':track([(0,.06),(36,-.06),(72,.06),(108,-.06),(144,.06)])},
 'Skirt':{'opacity':[k(0,1)]},'Lei':{'opacity':[k(0,1)]},
 'EarPoseL':{'rotation':[k(0,.12)],'y':[k(0,-20)]},'EarPoseR':{'rotation':[k(0,-.12)],'y':[k(0,-20)]},
 'tail':{'rotation':sw(18,.2,-.2,HULA)},
 'HeadPose':{'rotation':track([(0,-.04),(36,.04),(72,-.04),(108,.04),(144,-.04)])},
 'brows':{'y':[k(0,-8)]},
}
for i in range(SKIRT_N):
    lag=10+i*3
    hula_tracks[f'Strand{i}']={'rotation':smp(HULA,4,lambda f,lag=lag:.26*math.sin(2*math.pi*(f-lag-9)/72))}
hula=merge(arms('L',hula_arm(1)),arms('R',hula_arm(-1)),HAPPY,SMILE,hula_tracks)

# ---- 10 Skate
SKATE=180
def speed_keys(ph):
    def op(f):
        s=(f-ph)%36
        env=max(0,min(1,f/12,(130-f)/12))
        return env*math.sin(math.pi*s/36)
    def xo(f): return -60*((f-ph)%36)/36
    return smp(SKATE,4,op),smp(SKATE,4,xo)
skate_tracks={
 'Groove':{'x':track([(0,-60),(130,60),(180,-60)]),
   'rotation':track([(0,.08),(92,.08),(108,-.15),(124,.1),(134,.08),(142,-.05),(166,-.05),(180,.08)]),
   'y':[k(0,0),k(16,0),k(21,8),k(28,0),k(56,0),k(61,8),k(68,0),k(94,0),k(100,10,'out'),k(112,-110,'in'),k(128,6),k(134,0),k(180,0)],
   'scaleY':track([(0,1),(16,1),(21,.97),(28,1),(56,1),(61,.97),(68,1),(94,1),(100,.93),(108,1.03),(128,.94),(136,1),(180,1)])},
 'Board':{'opacity':[k(0,1)],'rotation':track([(0,0),(104,0),(112,-.18),(124,.1),(134,0),(180,0)])},
 'WheelB':{'rotation':[k(0,0,'linear'),k(SKATE,4*math.pi,'linear')]},'WheelF':{'rotation':[k(0,0,'linear'),k(SKATE,4*math.pi,'linear')]},
 'EarPoseL':{'rotation':track([(0,-.25),(134,-.25),(142,.15),(166,.15),(180,-.25)])},
 'EarPoseR':{'rotation':track([(0,-.25),(134,-.25),(142,.15),(166,.15),(180,-.25)])},
 'tail':{'rotation':track([(0,.1),(90,-.1),(180,.1)])},
}
for n,ph in zip('ABC',(0,12,24)):
    o,x_=speed_keys(ph)
    skate_tracks['Speed'+n]={'opacity':o,'x':x_}
skate_arm=[(0,.7,.35),(96,.7,.35),(110,1.2,.5),(130,.7,.35),(180,.7,.35)]
skate=merge(arms('LR',skate_arm),SMILE,skate_tracks)

# ---- 11 Gaming
GAME=144
game_tracks={
 'Controller':{'opacity':[k(0,1)],'rotation':sw(12,.05,-.05,GAME)},
 'paw-left':{'x':[k(0,135)],'y':sw(6,29,41,GAME),'rotation':sw(6,-.1,.1,GAME)},
 'paw-right':{'x':[k(0,-135)],'y':sw(6,41,29,GAME),'rotation':sw(6,.1,-.1,GAME)},
 'pupil-left':{'x':sw(18,-12,12,GAME),'y':[k(0,10)]},'pupil-right':{'x':sw(18,-12,12,GAME),'y':[k(0,10)]},
 'brows':{'y':[k(0,10)]},
 'mouth':{'opacity':hold([(0,0)])},
 'Thought':{'opacity':hold([(0,1),(120,0),(144,1)])},
 'Smile':{'opacity':hold([(0,0),(120,1),(144,0)])},
 'Groove':{'rotation':track([(0,0),(40,.04),(60,0),(110,-.04),(130,0),(144,0)])},
 'Hop':{'y':track([(0,0),(120,0),(130,-40),(144,0)])},
 'HeadPose':{'y':sw(12,4,0,GAME)},
 'EarPoseL':{'rotation':track([(0,0),(120,0),(128,.14),(144,0)]),'y':track([(0,0),(120,0),(128,-22),(144,0)])},
 'EarPoseR':{'rotation':track([(0,0),(120,0),(128,-.14),(144,0)]),'y':track([(0,0),(120,0),(128,-22),(144,0)])},
 'eye-left':{'opacity':hold([(0,1),(120,0),(144,1)])},'eye-right':{'opacity':hold([(0,1),(120,0),(144,1)])},
 'HappyEyes':{'opacity':hold([(0,0),(120,1),(144,0)])},'ClosedWrap':{'opacity':hold([(0,1),(120,0),(144,1)])},
 'tail':{'rotation':sw(12,.06,-.06,GAME)},
}
gaming=merge(game_tracks)

# ---- 12 Snooze
SNOOZE=240
snooze_tracks={
 'SleepEyes':{'opacity':[k(0,1)]},
 'eye-left':{'opacity':hold([(0,0)])},'eye-right':{'opacity':hold([(0,0)])},'ClosedWrap':{'opacity':hold([(0,0)])},
 'HeadPose':{'rotation':[k(0,.12)],'y':track([(0,30),(120,38),(240,30)])},
 'EarPoseL':{'rotation':[k(0,-.3)],'y':[k(0,20)]},'EarPoseR':{'rotation':[k(0,.3)],'y':[k(0,20)]},
 'brows':{'y':[k(0,8)]},
 'mouth':{'opacity':[k(0,0)]},'Smile':{'opacity':[k(0,.7)],'scaleX':[k(0,.6)],'scaleY':[k(0,.5)]},
 'Groove':{'scaleY':track([(0,1),(120,1.03),(240,1)])},
 'paw-left':{'x':[k(0,95)],'y':[k(0,22)]},'paw-right':{'x':[k(0,-95)],'y':[k(0,22)]},
 'tail':{'rotation':[k(0,-.2)]},
}
for i,n in enumerate(('ZA','ZB','ZC')):
    t=i*40
    snooze_tracks[n]={'opacity':track([(t,0),(t+20,1),(t+110,1),(t+140,0),(SNOOZE,0)]),
      'x':track([(t,0),(t+140,30),(SNOOZE,30)],'out'),'y':track([(t,0),(t+140,-30),(SNOOZE,-30)],'out'),
      'scaleX':track([(t,.7),(t+60,1),(t+140,1.1)]),'scaleY':track([(t,.7),(t+60,1),(t+140,1.1)])}
snooze=merge(snooze_tracks)

# ---- 13 Juggle
JUG=120
JPEAK=770
def ball_keys(phase):
    def pos(f):
        s=(f-phase)%120; leg=s//60; u=(s%60)/60
        x=580*u if leg==0 else 580*(1-u)
        return x,-JPEAK*4*u*(1-u)
    xs=smp(JUG,4,lambda f:pos(f)[0]); ys=smp(JUG,4,lambda f:pos(f)[1])
    return xs,ys
def toss(times,first):
    out=[(0,first)]
    for t in times:
        out+=[(t-8,(.7,.4)),(t,(1.3,.8,'back')),(t+12,(.85,.5))]
    return out
def flat(keys):
    seen={}
    for fr,val in keys: seen[fr]=val
    res=[]
    for fr,val in sorted(seen.items()):
        res.append((fr,)+tuple(val))
    return res
L_keys=flat(toss((8,48,88),(.7,.4))+[(JUG,(.7,.4))])
R_keys=flat(toss((28,68,108),(.85,.5))+[(JUG,(.85,.5))])
jug_tracks={
 'Groove':{'rotation':sw(20,.03,-.03,JUG)},
 'brows':{'y':[k(0,-10)]},
 'HeadPose':{'y':[k(0,-12)],'rotation':sw(20,-.04,.04,JUG)},
 'pupil-left':{'x':sw(10,-8,8,JUG),'y':[k(0,-14)]},'pupil-right':{'x':sw(10,-8,8,JUG),'y':[k(0,-14)]},
 'EarPoseL':{'rotation':[k(0,.12)],'y':[k(0,-18)]},'EarPoseR':{'rotation':[k(0,-.12)],'y':[k(0,-18)]},
 'tail':{'rotation':sw(10,.1,-.1,JUG)},
}
for n,ph in zip(('Ball1','Ball2','Ball3'),(8,48,88)):
    xs,ys=ball_keys(ph)
    jug_tracks[n]={'opacity':[k(0,1)],'x':xs,'y':ys}
PF_L=[(0,.2)]+[p for t in (8,48,88) for p in ((t-8,.3),(t,-.7),(t+12,0))]+[(JUG,.3)]
PF_R=[(0,0)]+[p for t in (28,68,108) for p in ((t-8,.3),(t,-.7),(t+12,0))]+[(JUG,0)]
def pf(lst):
    d={};[d.__setitem__(a,b) for a,b in lst]; return sorted(d.items())
juggle=merge(arms('L',L_keys,paw_flap=pf(PF_L)),arms('R',R_keys,paw_flap=pf(PF_R)),SMILE,jug_tracks)

# ---- 14 Jam
JAM=96
def note_keys(ph):
    def op(f):
        s=(f-ph)%96
        return min(1,s/10)*(1 if s<60 else max(0,1-(s-60)/30))
    return smp(JAM,4,op),smp(JAM,4,lambda f:-110*((f-ph)%96)/96),smp(JAM,4,lambda f:14*math.sin(2*math.pi*(f-ph)/96))
jam_tracks={
 'Headphones':{'opacity':[k(0,1)]},
 'HeadPose':{'y':track([(0,0),(12,40),(24,0),(36,40),(48,0),(60,40),(72,0),(84,40),(96,0)]),'rotation':sw(24,-.05,.05,JAM)},
 'Groove':{'rotation':sw(24,-.04,.04,JAM)},
 'paw-left':{'x':[k(0,115)],'y':sw(12,150,126,JAM)},'paw-right':{'x':[k(0,-115)],'y':sw(12,126,150,JAM)},
 'EarPoseL':{'y':track([(0,0),(12,-12),(24,0),(36,-12),(48,0),(60,-12),(72,0),(84,-12),(96,0)])},
 'EarPoseR':{'y':track([(0,0),(12,-12),(24,0),(36,-12),(48,0),(60,-12),(72,0),(84,-12),(96,0)])},
 'tail':{'rotation':sw(6,.22,-.22,JAM)},
}
for n,ph in zip(('NoteA','NoteB','NoteC'),(0,32,64)):
    o,y_,x_=note_keys(ph)
    jam_tracks[n]={'opacity':o,'y':y_,'x':x_}
jam=merge(HAPPY,SMILE,jam_tracks)

specs=[
 ('Idle',1,False,{}),
 ('Listening',180,True,{'HeadPose':{'rotation':track([(0,-.025),(90,.025),(180,-.025)])},'brows':{'y':[k(0,-8)]}}),
 ('Working',WORK,True,working),
 ('Paused',60,False,{'eye-left':{'scaleY':[k(0,.68)]},'eye-right':{'scaleY':[k(0,.68)]},'HeadPose':{'y':[k(0,5)]}}),
 ('Waiting',WAIT,True,waiting),
 ('Saved',96,False,{'HeadPose':{'rotation':track([(0,0),(24,-.04),(48,.03),(96,0)])},'mouth':{'opacity':track([(0,1),(12,0),(78,0),(96,1)])},'Smile':{'opacity':track([(0,0),(12,1),(78,1),(96,0)])}}),
 ('Done',150,False,done),
 ('Interrupted',90,False,interrupted),
 ('Failed',108,False,failed),
 ('Hula',HULA,True,hula),
 ('Skate',SKATE,True,skate),
 ('Gaming',GAME,True,gaming),
 ('Snooze',SNOOZE,True,snooze),
 ('Juggle',JUG,True,juggle),
 ('Jam',JAM,True,jam),
]
moods={i:(name,make(name,dur,loop,tracks,True)) for i,(name,dur,loop,tracks) in enumerate(specs)}
a_poke=make('Poke',58,False,{'Poke':{'scaleX':track([(0,1),(10,1.035),(23,.985),(40,1)]),'scaleY':track([(0,1),(10,.965),(23,1.015),(40,1)])}})
a_rest=make('PokeRest',1,False,{'Poke':{'scaleX':[k(0,1)],'scaleY':[k(0,1)]}})
a_x=make('LookX',100,False,{f'Gaze-{s}':{'x':track([(0,-15),(50,0),(100,15)])} for s in ('left','right')})
a_y=make('LookY',100,False,{f'Gaze-{s}':{'y':track([(0,-12),(50,0),(100,12)])} for s in ('left','right')})

# ---- Celebrate layer (mood 6 only): stars pop, then twinkle and the body sways while Done is held
star_names=list(STARS)
rest_tracks={'Sway':{'rotation':[k(0,0)]}}
for n in star_names:
    rest_tracks[n]={'opacity':hold([(0,0)]),'scaleX':[k(0,1)],'scaleY':[k(0,1)],'rotation':[k(0,0)]}
a_c_rest=make('CelebrateRest',1,False,rest_tracks)
pop_tracks={'Sway':{'rotation':track([(0,0),(40,-.025),(80,.025),(100,0)])}}
for i,n in enumerate(star_names):
    d=6+i*8
    pop_tracks[n]={'opacity':hold([(0,0),(d,1)]),'scaleX':track([(0,0),(d,0),(d+12,1.4),(d+28,1)],'back'),'scaleY':track([(0,0),(d,0),(d+12,1.4),(d+28,1)],'back'),
                   'rotation':track([(0,-.7),(d,-.7),(d+28,0)])}
a_c_pop=make('CelebratePop',100,False,pop_tracks)
tw_tracks={'Sway':{'rotation':track([(0,0),(60,.03),(120,0),(180,-.03),(240,0)])}}
for i,n in enumerate(star_names):
    o=i*30
    # one dip and one swell per 240-frame loop, offset per star, always starting and ending at scale 1
    dip=40+o%160; swell=dip+70
    scale=sorted({0:1,dip:.78,swell:1.18,min(swell+50,240):1,240:1}.items())
    tw_tracks[n]={'opacity':hold([(0,1)]),'scaleX':track(scale),'scaleY':track(scale),
                  'rotation':track([(0,0),(120,.18),(240,0)])}
a_c_tw=make('CelebrateTwinkle',240,True,tw_tracks)

vm,inst,pm,px,py,pp,sm=[v.nid() for _ in range(7)]

def condition(prop,value=None,op='equal'):
    typ,key=('Trigger',686) if value is None else ('Number',636)
    tail='TriggerComparator value="0"' if value is None else f'NumberComparator value="{value}"'
    opattr='' if value is None else f' opValue="{op}"'
    return f'<TransitionViewModelCondition{opattr}><TransitionPropertyViewModelComparator><BindableProperty{typ}><DataBindContext sourcePathIds="{vm}-{prop}" propertyKey="{key}"/></BindableProperty{typ}></TransitionPropertyViewModelComparator><TransitionValue{tail}/></TransitionViewModelCondition>'

def layer(name,body):
    return f'<StateMachineLayer name="{name}"><AnyState x="0" y="-140"/><ExitState x="1800" y="-140"/>{body}</StateMachineLayer>'
idle_state=v.nid()
sm_xml=f'<StateMachine name="Main" id="{sm}">'+layer('IdleLife',f'<EntryState x="0" y="0"><StateTransition stateToId="{idle_state}"/></EntryState><AnimationState id="{idle_state}" x="200" y="0" animationId="{a_idle}"/>')
states={i:v.nid() for i in moods}
MIX={4:320,6:140,**{i:200 for i in range(9,15)}}
sm_xml+='<StateMachineLayer name="Mood"><AnyState x="0" y="-140">'
for i in moods:
    sm_xml+=f'<StateTransition stateToId="{states[i]}" duration="{MIX.get(i,180)}">{condition(pm,i)}</StateTransition>'
sm_xml+=f'</AnyState><ExitState x="1900" y="-140"/><EntryState x="0" y="0"><StateTransition stateToId="{states[0]}"/></EntryState>'
for i,(name,aid) in moods.items():
    sm_xml+=f'<AnimationState id="{states[i]}" x="{200+i*180}" y="{i%2*160}" animationId="{aid}" reset="true"/>'
sm_xml+='</StateMachineLayer>'
c_rest,c_pop,c_tw=v.nid(),v.nid(),v.nid()
sm_xml+=layer('Celebrate',
    f'<EntryState x="0" y="0"><StateTransition stateToId="{c_rest}"/></EntryState>'
    f'<AnimationState id="{c_rest}" x="200" y="0" animationId="{a_c_rest}"><StateTransition stateToId="{c_pop}" duration="0">{condition(pm,6)}</StateTransition></AnimationState>'
    f'<AnimationState id="{c_pop}" x="400" y="0" animationId="{a_c_pop}" reset="true">'
    f'<StateTransition stateToId="{c_rest}" duration="250">{condition(pm,6,"notEqual")}</StateTransition>'
    f'<StateTransition stateToId="{c_tw}" enableExitTime="true" exitTimeIsPercetange="true" exitTime="100" duration="120"/></AnimationState>'
    f'<AnimationState id="{c_tw}" x="600" y="0" animationId="{a_c_tw}" reset="true"><StateTransition stateToId="{c_rest}" duration="250">{condition(pm,6,"notEqual")}</StateTransition></AnimationState>')
r,p=v.nid(),v.nid()
sm_xml+=layer('Poke',f'<EntryState x="0" y="0"><StateTransition stateToId="{r}"/></EntryState><AnimationState id="{r}" x="200" y="0" animationId="{a_rest}"><StateTransition stateToId="{p}" duration="40">{condition(pp)}</StateTransition></AnimationState><AnimationState id="{p}" x="400" y="0" animationId="{a_poke}" reset="true"><StateTransition stateToId="{r}" enableExitTime="true" exitTimeIsPercetange="true" exitTime="100" duration="100"/></AnimationState>')+'</StateMachine>'
look=f'<Joystick name="Gaze" xId="{a_x}" yId="{a_y}"><DataBindContext sourcePathIds="{vm}-{px}" propertyKey="299"/><DataBindContext sourcePathIds="{vm}-{py}" propertyKey="300"/></Joystick>'
world_xml=v.emit(world,(0,0),'')
world_xml=world_xml.replace('<Node x="0" y="0" name="World"','<Node x="-15" y="10" name="World"',1)
xml=f'<Rive version="1" kind="fragment"><Artboard name="Freddai" id="0:2" width="1200" height="1230" styleId="0:5" defaultStateMachineId="{sm}" viewModelId="{vm}" viewModelInstanceId="{inst}"><LayoutComponentStyle name="Artboard Style" id="0:5"/>{world_xml}{sm_xml}{look}'+''.join(a[2] for a in v.ANIMS)+'</Artboard>'
xml+=f'<ViewModel name="Pet" id="{vm}" defaultInstanceId="{inst}">'
for name,prop in [('mood',pm),('lookX',px),('lookY',py)]:
    xml+=f'<ViewModelPropertyNumber name="{name}" id="{prop}"/>'
xml+=f'<ViewModelPropertyTrigger name="poke" id="{pp}"/><ViewModelInstance name="Default" exports="true" id="{inst}">'
for prop in (pm,px,py):
    xml+=f'<ViewModelInstanceNumber propertyValue="0" viewModelPropertyId="{prop}"/>'
xml+=f'<ViewModelInstanceTrigger propertyValue="0" viewModelPropertyId="{pp}"/></ViewModelInstance></ViewModel></Rive>'
ET.indent(tree:=ET.ElementTree(ET.fromstring(xml)),space='  ')
tree.write(HERE/'scene.rml',encoding='unicode')
print('Generated scene.rml from unchanged dormouse-v3.svg:',len(v.BY_NAME),'named rig parts,',len(v.ANIMS),'animations')
