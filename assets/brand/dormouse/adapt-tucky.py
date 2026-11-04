"""Build the Freddai dormouse v2 SVG using Tucky's existing facial construction.
Reads Tucky only. Writes versioned Freddai assets. No Rive/runtime integration.
"""
from pathlib import Path
import copy
import xml.etree.ElementTree as ET
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True, help='Tucky public/mascot/tucky-animated.svg')
parser.add_argument('--version', choices=['v2', 'v3', 'v4'], default='v3')
args = parser.parse_args()
NS = '{http://www.w3.org/2000/svg}'
ET.register_namespace('', NS[1:-1])
root = ET.parse(args.source).getroot()
def select(predicate):
    return next(e for e in root.iter() if predicate(e))
def by_id(name):
    return select(lambda e: e.get('id') == name)
def by_class(name):
    return select(lambda e: name in e.get('class', '').split())
def serialize(el):
    return ET.tostring(el, encoding='unicode')
body = copy.deepcopy(by_id('body'))
head = copy.deepcopy(by_id('head'))
head.set('id', 'head-outline')
brows = copy.deepcopy(by_class('tucky-brows'))
brows.set('id', 'brows')
nose = copy.deepcopy(by_class('tucky-nose'))
nose.set('id', 'nose')
eyes = []
for side, original in zip(['left', 'right'], [e for e in root.iter() if e.get('class') == 'tucky-eye']):
    eye = copy.deepcopy(original)
    eye.set('id', 'eye-'+side)
    eye.attrib.pop('class', None)
    for child in list(eye)[3:]:
        eye.remove(child)
    pupil = next(e for e in eye.iter() if e.get('class') == 'pupil')
    pupil.set('id', 'pupil-'+side)
    eyes.append(serialize(eye))
body_svg=serialize(body)
head_svg=serialize(head)
face = f'''<g id="head">
<g id="ear-left"><circle cx="378" cy="260" r="104" fill="url(#fur)" stroke="#382610" stroke-width="19"/><circle cx="378" cy="260" r="65" fill="url(#ear)" stroke="#7D5235" stroke-width="9"/></g>
<g id="ear-right"><circle cx="876" cy="260" r="104" fill="url(#fur)" stroke="#382610" stroke-width="19"/><circle cx="876" cy="260" r="65" fill="url(#ear)" stroke="#7D5235" stroke-width="9"/></g>
{head_svg}
<path id="cream-cheeks" d="M292 563C320 511 386 542 425 565C484 598 552 588 627 602C700 588 770 598 829 565C868 542 934 511 962 563C1007 646 926 701 865 709C815 729 788 718 765 715C690 771 565 771 489 715C464 720 433 730 387 710C327 699 247 646 292 563Z" fill="url(#cream)" stroke="none"/>
<g id="eye-patches" fill="#765038" stroke="none"><path d="M377 552C352 513 365 402 416 374C469 344 532 392 550 488L557 551C511 580 426 582 377 552Z"/><path d="M877 552C902 513 889 402 838 374C785 344 722 392 704 488L697 551C743 580 828 582 877 552Z"/></g>
{serialize(brows)}
{''.join(eyes)}
{serialize(nose)}
<g id="mouth" fill="none" stroke-width="12"><path d="M626 630V660"/><path d="M565 658Q573 688 598 683Q616 681 626 665Q638 683 658 683Q685 687 691 658"/></g>
<g id="whiskers-left" fill="none" stroke="#765038" stroke-width="7"><path d="M381 626Q307 600 263 612M380 649Q307 644 272 660"/></g>
<g id="whiskers-right" fill="none" stroke="#765038" stroke-width="7"><path d="M873 626Q947 600 991 612M874 649Q947 644 982 660"/></g>
</g>'''
defs='''<defs>
<radialGradient id="fur" cx="38%" cy="28%" r="85%"><stop stop-color="#D3A16B"/><stop offset=".65" stop-color="#B78351"/><stop offset="1" stop-color="#925F39"/></radialGradient>
<radialGradient id="cream" cx="40%" cy="25%" r="90%"><stop stop-color="#FFF0D5"/><stop offset="1" stop-color="#EBC99A"/></radialGradient>
<radialGradient id="ear" cx="40%" cy="30%" r="80%"><stop stop-color="#F2C5A5"/><stop offset="1" stop-color="#CF9872"/></radialGradient>
<clipPath id="eye-470"><ellipse cx="470" cy="509" rx="69" ry="94"/></clipPath>
<clipPath id="eye-788"><ellipse cx="788" cy="509" rx="69" ry="94"/></clipPath>
</defs>'''
tail='''<g id="tail"><path d="M413 1080C315 1135 162 1104 143 1002C126 923 179 855 252 865C311 872 351 928 335 973C320 1013 268 1009 256 976" fill="url(#fur)" stroke-width="20"/><path d="M184 997C192 1047 290 1074 353 1040" fill="none" stroke="#D5A16B" stroke-width="23"/></g>'''
paws='''<g id="paw-left" fill="url(#fur)"><path d="M405 767C349 779 333 849 372 878C404 900 433 878 454 838C466 811 457 792 439 793C438 765 418 757 405 767Z" stroke-width="17"/><path d="M397 840L410 856M417 825L433 838" fill="none" stroke-width="8"/></g>
<g id="paw-right" fill="url(#fur)"><path d="M849 767C905 779 921 849 882 878C850 900 821 878 800 838C788 811 797 792 815 793C816 765 836 757 849 767Z" stroke-width="17"/><path d="M857 840L844 856M837 825L821 838" fill="none" stroke-width="8"/></g>'''
wrap=lambda title,box,content:f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="{box}" role="img" aria-labelledby="title desc"><title id="title">{title}</title><desc id="desc">Warm cinnamon dormouse with rounded ears, dark eye patches, cream cheeks and expressive eyes. Adapted from Tucky's vector construction.</desc>{defs}<g stroke="#382610" stroke-width="17" stroke-linejoin="round" stroke-linecap="round">{content}</g></svg>\n'''
if args.version in ('v3', 'v4'):
    # Return toward the selected dormouse: compact body, soft oval head,
    # smaller ears, dark expressive eyes, tiny smile and a fluffy resting tail.
    body_svg = '<g transform="translate(627 765) scale(1.12 .82) translate(-627 -765)">' + body_svg + '</g>'
    softer_head = copy.deepcopy(head)
    softer_head.set('d', 'M305 450C310 282 447 177 627 177C807 177 944 282 949 450C1009 520 1006 620 941 681C878 754 769 789 627 789C485 789 376 754 313 681C248 620 245 520 305 450Z')
    face = face.replace(head_svg, serialize(softer_head))
    face = face.replace('r="104"', 'r="86"').replace('r="65"', 'r="53"')
    face = face.replace('M292 563C320 511 386 542 425 565C484 598 552 588 627 602C700 588 770 598 829 565C868 542 934 511 962 563C1007 646 926 701 865 709C815 729 788 718 765 715C690 771 565 771 489 715C464 720 433 730 387 710C327 699 247 646 292 563Z',
        'M300 556C326 514 380 528 428 551C494 585 551 580 627 592C703 580 760 585 826 551C874 528 928 514 954 556C990 625 932 687 865 717C796 750 715 767 627 767C539 767 458 750 389 717C322 687 264 625 300 556Z')
    for side, center in [('left', 470), ('right', 788)]:
        face = face.replace(f'id="eye-{side}"', f'id="eye-{side}" transform="translate({center} 500) scale(.92) translate(-{center} -500)"')
        face = face.replace(f'id="pupil-{side}"', f'id="pupil-{side}" transform="translate({center} 509) scale(1.08 1) translate(-{center} -509)"')
    face = face.replace(serialize(nose), '<g id="nose" transform="translate(626 600) scale(.78) translate(-626 -600)">'+serialize(nose).replace('id="nose"', 'id="nose-shape"').replace('fill="#382610"', 'fill="#845039"')+'</g>')
    face = face.replace('<path d="M626 630V660"/><path d="M565 658Q573 688 598 683Q616 681 626 665Q638 683 658 683Q685 687 691 658"/>', '<path d="M583 662Q626 698 669 662"/>')
    face = face.replace(serialize(brows), serialize(brows).replace('stroke-width="17"', 'stroke-width="12"'))
    tail = '''<g id="tail"><path d="M461 1055C386 1113 229 1105 174 1041C150 1014 148 980 160 951L149 952L168 926L160 923C186 896 224 882 257 889L251 880C291 879 327 896 349 923L352 912C388 936 397 960 414 980C443 1002 463 1022 461 1055Z" fill="url(#fur)" stroke-width="19"/><path d="M196 968C231 930 294 935 334 975" fill="none" stroke="#925F39" stroke-width="11"/><path d="M211 1009C248 1032 307 1044 364 1030" fill="none" stroke="#D5A16B" stroke-width="20"/></g>'''
if args.version == 'v4':
    # Body now has approximately the head's visible width and height.
    # Use a round silhouette rather than stretching the existing torso/feet.
    body_svg = '''<g id="body">
<path id="body-outline" d="M410 660C315 700 240 850 245 1030C230 1190 350 1320 627 1320C904 1320 1024 1190 1009 1030C1014 850 939 700 844 660Z" fill="url(#fur)" stroke-width="20"/>
<path id="belly" d="M454 767C379 831 329 949 338 1070C345 1208 457 1293 627 1293C797 1293 909 1208 916 1070C925 949 875 831 800 767Z" fill="url(#cream)" stroke="none"/>
<g id="foot-left"><path d="M388 1279C343 1273 319 1296 334 1325C357 1362 434 1359 479 1331C461 1300 421 1282 388 1279Z" fill="url(#fur)" stroke-width="16"/><path d="M367 1306Q352 1320 369 1337M404 1307Q388 1325 407 1341" fill="none" stroke-width="8"/></g>
<g id="foot-right"><path d="M866 1279C911 1273 935 1296 920 1325C897 1362 820 1359 775 1331C793 1300 833 1282 866 1279Z" fill="url(#fur)" stroke-width="16"/><path d="M887 1306Q902 1320 885 1337M850 1307Q866 1325 847 1341" fill="none" stroke-width="8"/></g>
</g>'''
    paws = paws.replace('id="paw-left"', 'id="paw-left" transform="translate(-40 105)"').replace('id="paw-right"', 'id="paw-right" transform="translate(40 105)"')
    tail = '<g transform="translate(-10 220)">' + tail + '</g>'
out=Path(__file__).resolve().parent
version = args.version
content = (body_svg+tail if version in ('v3', 'v4') else tail+body_svg)+face+paws
character_box = '-73 65 1400 1400' if version == 'v4' else '65 90 1130 1130'
(out/f'dormouse-{version}.svg').write_text(wrap(f'Freddai dormouse {version}',character_box,content))
(out/f'dormouse-icon-{version}.svg').write_text(wrap(f'Freddai dormouse icon {version}','130 100 1000 1000','<rect id="background" x="130" y="100" width="1000" height="1000" rx="220" fill="#969D76" stroke="none"/>'+f'<g transform="translate(0 90)">{face}</g>'))
for filename in [f'dormouse-{version}.svg',f'dormouse-icon-{version}.svg']:
    svg=ET.parse(out/filename)
    ids=[e.get('id') for e in svg.iter() if e.get('id')]
    assert len(ids)==len(set(ids))
    print(filename, 'valid XML;', len(ids),'unique named groups/assets')
