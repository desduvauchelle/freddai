"""Render actual Rive frames into a labeled local animation review clip."""
from pathlib import Path
import subprocess
import shutil
import json
from PIL import Image, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent
RIVE=Path.home()/'.rive/bin/rive'
OUT=HERE/'build'
FRAMES=OUT/'preview-frames'
FRAMES.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',22)
small=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',14)
states=[('Idle',0,48),('Listening',1,24),('Working',2,24),('Paused',3,24),('Waiting',4,24),('Saved',5,24),('Done',6,30),('Interrupted',7,24),('Failed',8,24),('Poke',0,18),('Gaze',0,24)]
index=0
representatives=[]
for label,mood,count in states:
    for frame in range(count):
        advance=frame*5+1
        args=[str(RIVE),'.','--screenshot='+str(OUT/'raw.png'),'--scale=0.4','--data=mood='+str(mood)]
        if label=='Poke':
            args+=['--data=poke=1']
        if label=='Gaze':
            args+=['--data=lookX='+str(-1 if frame<12 else 1),'--data=lookY=-0.4']
        args+=['--advance='+str(advance),'--quiet']
        subprocess.run(args,cwd=HERE,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        img=Image.open(OUT/'raw.png').convert('RGB')
        draw=ImageDraw.Draw(img)
        draw.text((img.width/2,18),label,font=font,fill='#F1EEE6',anchor='mt')
        draw.text((img.width/2,img.height-20),'Freddai · dormouse motion study',font=small,fill='#B9B4A9',anchor='mm')
        target=FRAMES/f'{index:04d}.png'
        img.save(target)
        if frame==min(9,count-1):
            representatives.append((label,target))
        index+=1
    print('Rendered',label,flush=True)
# An assertion of runtime behavior: the sampled frames must actually differ.
for label in ['Idle','Working','Waiting','Done','Poke','Gaze']:
    start=sum(n for l,_,n in states[:next(i for i,s in enumerate(states) if s[0]==label)])
    assert (FRAMES/f'{start:04d}.png').read_bytes()!=(FRAMES/f'{start+9:04d}.png').read_bytes(),label
sheet=Image.new('RGB',(480*4,492*3),'#1E1E1E')
for i,(label,path) in enumerate(representatives):
    sheet.paste(Image.open(path),(i%4*480,i//4*492))
sheet.save(OUT/'states.png')
subprocess.run([shutil.which('ffmpeg'),'-y','-loglevel','error','-framerate','12','-i',str(FRAMES/'%04d.png'),'-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'dormouse-states.mp4')],check=True)
(OUT/'preview-manifest.json').write_text(json.dumps({'fps':12,'frames':index,'states':[s[0] for s in states]},indent=2)+'\n')
print('Wrote',OUT/'dormouse-states.mp4',flush=True)
