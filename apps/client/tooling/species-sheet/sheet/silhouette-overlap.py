import sys,glob,os,json
from PIL import Image
import numpy as np
R=os.environ.get('SHEET_DIR',os.path.dirname(os.path.abspath(__file__)))
def mask(path,S=96):
    im=Image.open(path).convert('L'); a=np.array(im)<110
    ys,xs=np.where(a)
    if len(ys)==0: return None
    a=a[ys.min():ys.max()+1,xs.min():xs.max()+1]
    h,w=a.shape; sc=(S-4)/max(h,w)
    im2=Image.fromarray((a*255).astype('uint8')).resize((max(1,int(w*sc)),max(1,int(h*sc))))
    out=np.zeros((S,S),bool); b=np.array(im2)>127
    oy=(S-b.shape[0])//2; ox=(S-b.shape[1])//2
    out[oy:oy+b.shape[0],ox:ox+b.shape[1]]=b
    return out
def iou(a,b): return (a&b).sum()/max(1,(a|b).sum())
new=sys.argv[1].split(','); old_dir=R+'/sil'; new_dir=sys.argv[2]
old={os.path.basename(p).split('-iphone')[0]:mask(p) for p in glob.glob(old_dir+'/*-iphone-high.png')}
old={k:v for k,v in old.items() if v is not None}
res={}
for n in new:
    m=mask(f'{new_dir}/{n}-iphone-high.png')
    scored=sorted(((iou(m,v),k) for k,v in old.items()),reverse=True)[:3]
    res[n]=[(round(s,2),k) for s,k in scored]
json.dump(res,open(sys.argv[3],'w'))
for n,r in res.items(): print(n,r)
