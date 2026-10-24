# Builds the owner's screens page from a door-glow.mjs run (#306 door glow):
#   python3 door-glow-page.py <shots dir (with glow-stats.json)> <out dir>
# then publish <out dir>/index.html with its img/ folder as an artifact.
import json, html, shutil, os, glob, sys
src=sys.argv[1]
out=sys.argv[2]
HERE=os.path.dirname(os.path.abspath(__file__))
shutil.rmtree(out,ignore_errors=True); os.makedirs(out+'/img')
for f in glob.glob(src+'/*.png'):
    if 'timed-out' not in f: shutil.copy(f,out+'/img/')
stats={r['file']:r for r in json.load(open(src+'/glow-stats.json'))}
doors=[('fire','Parlour','cold fireplace','Fire','orange','an','left'),
       ('leaf','Conservatory','cracked window','Leaf','green','a','right'),
       ('water','Scullery','flames','Water','blue','a','right'),
       ('light','Blue Bedroom','dark closet','Light','yellow','a','left')]
dev={'iphone':('iPhone 15',393,852,'393 × 852 pt, insets 59 top / 34 bottom'),'se':('iPhone SE',375,667,'375 × 667 pt, insets 20 top / 0 bottom')}
def clean(t): return (t or '').replace(' ',' ').strip()
def fig(d,power,room,thing,elem,colour,art,side,state):
    name,w,h,spec=dev[d]
    f=f'{d}-glow-{power}-{state}-high.png'
    r=stats[f]
    bub=clean(r.get('bubble')); act=clean(r.get('action'))
    shows=[]
    shows.append(f'a bubble reading “{bub}”' if bub else 'no bubble')
    shows.append(f'a button reading “{act}”' if act else 'no button')
    if state=='asleep':
        lead=f'{room}, the {thing} door still asleep, with the Keeper facing it. On screen: '
    else:
        lead=f'{room}, the {thing} door just woken by a {elem} friend. The Keeper stands in the room, apart from the door; {art} {colour} glow marks the door on the {side} wall. On screen: '
    cap=f'{name}. {lead}{" and ".join(shows)}.'
    label='Asleep' if state=='asleep' else 'Just woken'
    return f'<figure><img src="img/{f}" width="{w}" height="{h}" alt="{html.escape(name)}: {power} door {state}"><figcaption><b>{label}</b> · {html.escape(cap)} <span class="pin">?tier={r["tier"]} pinned · {spec}</span></figcaption></figure>'
secs=''
for power,room,thing,elem,colour,art,side in doors:
    row=''
    for d in dev:
        row+=''.join(fig(d,power,room,thing,elem,colour,art,side,s) for s in ('asleep','woke'))
    secs+=f'<section><h2>{elem} · {room}</h2><div class="grid">{row}</div></section>'
page=open(HERE+'/door-glow-page.html').read().replace('@@SECTIONS@@',secs)
open(out+'/index.html','w').write(page)
print('ok',len(stats))
