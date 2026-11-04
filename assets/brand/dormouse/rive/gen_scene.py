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

breath=v.N('Breath',(627,1080),[art])
hop=v.N('Hop',(627,1080),[breath])
sway=v.N('Sway',(627,1080),[hop])
poke=v.N('Poke',(627,1080),[sway])
world=v.N('World',(0,0),[poke,think,qb,pause,sweat]+star_nodes)

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
MIX={4:320,6:140}
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
