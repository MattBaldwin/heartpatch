import json,base64,io,os,glob,html
from PIL import Image
import numpy as np
HERE=os.path.dirname(os.path.abspath(__file__))
# SHEET_DIR is the working folder with final/, silnew/, sil/, meta.json and iou.json (see README.md).
R=os.environ.get('SHEET_DIR',HERE)
meta={m['id']:m for m in json.load(open(R+'/meta.json'))}
iou=json.load(open(R+'/iou.json'))
LINES=[
 ('Slipwaddle','Penguin that slides on its tummy',['slipwaddle','sledwaddle','blizzwaddle']),
 ('Oinkle','Piglet with a curly tail (the teen grows tusks)',['oinkle','snortle','tuskoink']),
 ('Cubbun','Bear cub that hugs its heart',['cubbun','brambun','grizzbun']),
 ('Spudsy','Potato with one tiny sprout',['spudsy','tatertot','hashbrawn']),
 ('Cloudlamb','Sheep made of actual cloud',['cloudlamb','cumulamb','fluffasus']),
 ('Glimbug','Firefly who lights the way',['glimbug','glimmerbug','beaconfly']),
 ('Dragofruit','Dragon that is also dragonfruit (passed sheet v1, unchanged)',['dragofruit','drakeberry','dragonbloom']),
 ('Quackle','Rubber duck that blows bubbles',['quackle','bubbleduck','soapduke']),
 ('Lampfin','Anglerfish scared of its light',['lampfin','lanternfin','nightfin']),
]
STAGE=['Baby','Kid','Teen']
CAP=json.load(open(HERE+'/captions.json'))
def b64(path,fmt='JPEG',q=84,size=None):
    im=Image.open(path).convert('RGB')
    if size: im=im.resize(size,Image.LANCZOS)
    buf=io.BytesIO(); im.save(buf,fmt,quality=q,optimize=True) if fmt=='JPEG' else im.save(buf,fmt,optimize=True)
    return f"data:image/{fmt.lower()};base64,"+base64.b64encode(buf.getvalue()).decode()

def cropframe(i,dev,q=84):
    """Crop the colour frame to the squishy's silhouette plus a margin, so every form is framed whole and large."""
    col=Image.open(f"{R}/final/{i}-{dev}-high.png").convert('RGB')
    sil=np.array(Image.open(f"{R}/silnew/{i}-{dev}-high.png").convert('L'))<110
    ys,xs=np.where(sil)
    m=60 if dev=='iphone' else 100
    x0=max(0,xs.min()-m); x1=min(col.width,xs.max()+m*2)
    y0=max(0,ys.min()-m); y1=min(col.height,ys.max()+m)
    # keep a floor strip under the squishy so its shadow shows
    y1=min(col.height,y1+m)
    w=x1-x0; h=y1-y0
    minw=int(col.width*0.45)
    if w<minw: c=(x0+x1)//2; x0=max(0,min(col.width-minw,c-minw//2)); x1=x0+minw; w=minw
    im=col.crop((x0,y0,x1,y1))
    im.save(f"{R}/crops/{i}-{dev}.png")
    buf=io.BytesIO(); im.save(buf,'JPEG',quality=q,optimize=True)
    return "data:image/jpeg;base64,"+base64.b64encode(buf.getvalue()).decode(), im.width//2, im.height//2
def tile(path,W,H,pad=6):
    im=Image.open(path).convert('L'); a=np.array(im)<110
    ys,xs=np.where(a)
    a=a[ys.min():ys.max()+1,xs.min():xs.max()+1]
    h,w=a.shape; sc=min((W-2*pad)/w,(H-2*pad)/h)
    m=Image.fromarray((~a*255).astype('uint8')).resize((max(1,int(w*sc)),max(1,int(h*sc))),Image.LANCZOS)
    out=Image.new('L',(W,H),255); out.paste(m,((W-m.width)//2,(H-m.height)//2))
    buf=io.BytesIO(); out.save(buf,'PNG',optimize=True)
    return "data:image/png;base64,"+base64.b64encode(buf.getvalue()).decode()
def sil_new(i): return f'{R}/silnew/{i}-iphone-high.png'
def sil_old(i): return f'{R}/sil/{i}-iphone-high.png'
e=html.escape
out=[]
# silhouette strip
strip=[]
for name,hook,ids in LINES:
    cells=[]
    for i in ids:
        top=iou[i][:3]
        olds=''.join(f'<figure class="sil old"><img src="{tile(sil_old(k),96,120)}" width="96" height="120" alt="Silhouette of existing squishy {e(k)}"><figcaption>{e(k)}<br><span class="num">{s:.2f}</span></figcaption></figure>' for s,k in top)
        cells.append(f'<div class="silgroup"><figure class="sil new"><img src="{tile(sil_new(i),96,120)}" width="96" height="120" alt="Silhouette of new squishy {e(meta[i]["name"])}"><figcaption><b>{e(meta[i]["name"])}</b><br>{STAGE[ids.index(i)].lower()}</figcaption></figure><div class="closest"><span class="lbl">closest existing</span><div class="row">{olds}</div></div></div>')
    strip.append(f'<section class="silkind"><h3>{e(name)}</h3><div class="silrow">{"".join(cells)}</div></section>')
wall=''.join(f'<figure class="sil tiny"><img src="{tile(p,56,70,3)}" width="56" height="70" alt="" loading="lazy"><figcaption>{e(os.path.basename(p).split("-iphone")[0])}</figcaption></figure>' for p in sorted(glob.glob(R+'/sil/*-iphone-high.png')))
nwall=len(glob.glob(R+'/sil/*-iphone-high.png'))
worst=max((s,i,k) for i,v in iou.items() for s,k in v[:1])
kinds=[]
for name,hook,ids in LINES:
    m0=meta[ids[0]]
    forms=[]
    for st,i in zip(STAGE,ids):
        m=meta[i]
        cap=CAP[i]
        pi,pw,ph=cropframe(i,'iphone'); ai,aw,ah=cropframe(i,'ipad',82)
        forms.append(f'''<article class="form"><header><h4>{e(m["name"])} <span class="pill">{st.lower()}</span> <span class="pill r-{m["rarity"]}">{m["rarity"]}</span></h4><p class="cap">{e(cap)}</p></header>
<div class="shots"><figure><img src="{pi}" width="{pw}" height="{ph}" alt="{e(m["name"])} on iPhone, high tier"><figcaption>iPhone, high tier (?quality=high)</figcaption></figure>
<figure><img src="{ai}" width="{aw}" height="{ah}" alt="{e(m["name"])} on iPad, high tier"><figcaption>iPad, high tier (?quality=high)</figcaption></figure></div></article>''')
    kinds.append(f'<section class="kind" id="{ids[0]}"><div class="kh"><h2>{e(name)}</h2><p class="hook">“{e(hook)}”</p><p class="meta">{m0["element"]} · {m0["feeling"]} · {m0["rarity"]} kind</p></div>{"".join(forms)}</section>')
page=open(HERE+'/template.html').read()
page=page.replace('%%STRIP%%',''.join(strip)).replace('%%WALL%%',wall).replace('%%NWALL%%',str(nwall)).replace('%%KINDS%%',''.join(kinds)).replace('%%WORST%%',f'{worst[0]:.2f} ({worst[1]} against {worst[2]})')
open(R+'/sheet.html','w').write(page)
print(len(page)/1e6,'MB')
