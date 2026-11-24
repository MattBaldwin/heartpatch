#!/usr/bin/env python3
"""#868 round 2: per-frame numbers from pixels + sidecar JSON (hook scene.framing, DOM rects). Prints a table; never views images.
Usage: python3 -I measure.py <dir with night/ day/ ...>"""
import json, sys, pathlib
import numpy as np
from PIL import Image
root = pathlib.Path(sys.argv[1])
f = lambda x: '-' if x is None else f'{x:.3f}'
def ncol(img, y0, y1, x0=0.0, x1=1.0):
    w, h = img.size
    a, b = max(0, int(y0*h)), min(h, int(y1*h))
    if b <= a: return 0
    c = np.asarray(img.crop((int(x0*w), a, int(x1*w), b)).convert('RGB')) >> 4
    return len(np.unique(c[...,0].astype(int)*256+c[...,1]*16+c[...,2]))
def blob(img, y0, y1):
    """bbox (fractions of screen) of the largest grey (r~g~b, 110-215) patch in the band, if >0.4% of band area"""
    w, h = img.size
    a, b = int(y0*h), int(y1*h)
    if b <= a: return None
    p = np.asarray(img.crop((0, a, w, b)).convert('RGB')).astype(int)
    m = (abs(p[...,0]-p[...,1]) < 10) & (abs(p[...,1]-p[...,2]) < 10) & (p[...,0] > 110) & (p[...,0] < 215)
    # coarse 8px cells: cell is grey if >60% grey
    ch, cw = m.shape[0]//8, m.shape[1]//8
    c = m[:ch*8,:cw*8].reshape(ch,8,cw,8).mean((1,3)) > .6
    if c.sum() < 0.004*ch*cw: return None
    ys, xs = np.nonzero(c)
    return f'{(a+ys.min()*8)/h:.2f}-{(a+ys.max()*8+8)/h:.2f}/x{xs.min()*8/w:.2f}-{(xs.max()*8+8)/w:.2f}'
print('| run | frame | build | step | band | plate+Order bottom | cards top | boss face (hook) | facing | boss face in band | team eyes (hook) | team eyes vs cards | colours in band | face-row colours | grey blob bbox | shields |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for png in sorted(root.glob('*/*.png')):
    m = json.loads(png.with_suffix('.json').read_text())
    img = Image.open(png); H = m['inner']['h']; R = m['rects']
    b = m['battle'] or {}; fr = b.get('framing') or {}; pl = b.get('playing')
    vis = lambda k: R.get(k) and R[k]['bottom'] > 0
    head = R['bossHead']['bottom']/H if vis('bossHead') else None
    cards = R['friends']['top']/H if vis('friends') else None
    plate = (max([R[k]['bottom'] for k in ('plate','order') if vis(k)] or [0])/H) or None
    face, band, team, fac = fr.get('face'), fr.get('band'), fr.get('team') or [], fr.get('bossFacing')
    if vis('result'): verdict = 'result screen (no face framed)'
    elif not face or not band: verdict = 'no face (hook null)'
    else:
        ok = face['top'] >= max(band['top'], plate or 0)-1e-6 and face['bottom'] <= band['bottom']+1e-6
        if fac is not None and fac < 0.3: verdict = 'face not visible (faces away)'
        else: verdict = 'YES' if ok else ('under plate' if face['bottom'] <= (plate or band['top']) else 'NO (partly out)')
    tb = [t for t in team if t and np.isfinite(t.get('bottom', float('nan')))]
    tt = f"{min(t['top'] for t in tb):.3f}-{max(t['bottom'] for t in tb):.3f}" if tb else '-'
    tv = ('above cards' if max(t['bottom'] for t in tb) <= cards+1e-6 else 'UNDER CARDS') if tb and cards else '-'
    bandpx = (head, cards)
    bc = ncol(img, *bandpx) if head and cards else '-'
    fc = ncol(img, face['top'], face['bottom'], .25, .75) if face and not vis('result') else '-'
    bl = blob(img, *bandpx) if head and cards else None
    sh = b.get('shields'); shs = '-' if sh is None else ('a' if sh.get('a') else '')+('b' if sh.get('b') else '') or 'none'
    step = f"{pl['kind']}@{int(pl['at'])}ms" if pl else 'idle'
    cap = (m.get('caption') or '').replace('\n',' ')[:28]
    stem = png.stem; build = 'before' if stem.endswith('-before') else 'after'
    print(f"| {png.parent.name} | {stem.rsplit('-',1)[0]} | {build} | {step} `{cap}` | {f(band and band['top'])}–{f(band and band['bottom'])} | {f(plate)} | {f(cards)} | "
          f"{f(face and face['top'])}–{f(face and face['bottom'])} | {f(fac)} | {verdict} | {tt} | {tv} | {bc} | {fc} | {bl or 'none'} | {shs} |")
