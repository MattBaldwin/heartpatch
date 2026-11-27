#!/usr/bin/env python3
"""#190 PR1b (d6e0c66): caption vs friend-callout rects, from the .json sidecars (+ pixels for colours). Markdown table.
Usage: python3 -I measure-190-pr1b.py <dir with <frame>.png + .json> [--downscale]
--downscale rewrites each PNG to device size AFTER measuring (measure on the 2x originals). px are CSS px; fractions are of window height.
Intersection: caption rect vs each visible callout rect (axis-aligned boxes, the laid-out getBoundingClientRect, which includes the -6deg tilt).
Gap = caption.top - callout.bottom (positive: callout wholly above the pill). Chips: friendRects. Stage-stack top: hook band top / strip bottom."""
import json, sys, pathlib
import numpy as np
from PIL import Image
root = pathlib.Path(sys.argv[1]); down = '--downscale' in sys.argv
f = lambda x: '-' if x is None else f'{x:.3f}'
def vis(r): return bool(r) and r['right'] - r['left'] > 0 and r['bottom'] - r['top'] > 0
def inter(a, b): return min(a['right'], b['right']) - max(a['left'], b['left']) > 0 and min(a['bottom'], b['bottom']) - max(a['top'], b['top']) > 0
def rr(r): return f"{r['left']:.0f},{r['top']:.0f}–{r['right']:.0f},{r['bottom']:.0f}"
def ncol(img, y0, y1, x0=0.0, x1=1.0):
    w, h = img.size; a, b = max(0, int(y0 * h)), min(h, int(y1 * h))
    if b <= a: return 0
    c = np.asarray(img.crop((int(x0 * w), a, int(x1 * w), b)).convert('RGB')).astype(int) >> 4
    return len(np.unique(c[..., 0] * 256 + c[..., 1] * 16 + c[..., 2]))
rows = []; verdict = []
for png in sorted(root.glob('*.png')):
    jp = png.with_suffix('.json')
    if not jp.exists(): continue
    m = json.loads(jp.read_text()); img = Image.open(png)
    H = m['inner']['h']; W = m['inner']['w']; R = m['rects']
    b = m['battle'] or {}; fr = b.get('framing') or {}; pl = b.get('playing')
    band, face = fr.get('band'), fr.get('face'); team = [t for t in (fr.get('team') or []) if t]; facing = fr.get('bossFacing')
    strip, handle = R['strip'], m.get('handleRect') or R['handle']
    s_bot = strip['bottom'] / H if vis(strip) else None; h_top = handle['top'] / H if handle else None
    pct = f"{(band['bottom'] - band['top']) * 100:.1f}%" if band else '-'
    if face and band and facing is not None and facing >= 0.3:
        top_lim = max(band['top'], s_bot or 0)
        fin = 'YES' if face['top'] >= top_lim - 1e-6 and face['bottom'] <= band['bottom'] + 1e-6 else f"NO ({face['top']:.3f}–{face['bottom']:.3f})"
    else: fin = 'n/a'
    tmax = max([t['bottom'] for t in team], default=None)
    eyes = '-' if tmax is None or h_top is None else (f"clear ({(h_top - tmax) * H:.0f}px)" if tmax <= h_top else f"OVERLAP {(tmax - h_top) * H:.0f}px")
    # hourglass
    wd, wv = R['winding'], m.get('windVis')
    live = wv is None or (not wv.get('hidden') and wv.get('opacity') != '0' and wv.get('visibility') != 'hidden' and wv.get('display') != 'none')
    if vis(wd) and vis(strip) and live:
        ins = wd['left'] >= strip['left'] - .5 and wd['right'] <= strip['right'] + .5 and wd['top'] >= strip['top'] - .5 and wd['bottom'] <= strip['bottom'] + .5
        hg = 'shown, inside strip' if ins else 'shown, CLIPPED'
    else: hg = 'not shown'
    # targets
    tg = [('chip', c['w'], c['h']) for c in (m.get('friendRects') or []) if c['w'] > 0]
    for mv in m.get('moveRects') or []:
        if mv['w'] > 0 and mv['h'] > 0 and mv['top'] >= 0 and mv['bottom'] <= H + .5: tg.append((mv['t'], mv['w'], mv['h']))
    lv = R['leave']
    if vis(lv): tg.append(('✕', lv['right'] - lv['left'], lv['bottom'] - lv['top']))
    small = [f"{n}:{w:.0f}x{h:.0f}" for n, w, h in tg if min(w, h) < 43.9]
    mn = min([min(w, h) for n, w, h in tg], default=None)
    tgt = ('YES' if not small else 'NO ' + ', '.join(small)) + (f' (min {mn:.0f})' if mn else '')
    # caption vs callouts vs chips
    cap = m.get('captionRect'); capon = vis(cap) and (m.get('captionText') or '').strip() != ''
    cos = [c for c in (m.get('calloutRects') or []) if not c['hidden'] and c['w'] > 0 and c['opacity'] != '0']
    chips = [c for c in (m.get('friendRects') or []) if c['w'] > 0]
    inters, gaps, covers, tops = [], [], [], []
    for c in cos:
        if capon:
            inters.append(inter(cap, c)); gaps.append(cap['top'] - c['bottom'])
        covers.append([i for i, ch in enumerate(chips) if inter(ch, c)])
        tops.append(c['top'])
    if cos and capon:
        isx = 'NO' if not any(inters) else 'YES'
        gp = '/'.join(f"{g:.1f}" for g in gaps)
        verdict.append((png.stem, isx, min(gaps)))
    else: isx, gp = ('-', '-')
    cov = '-' if not cos else ('YES chip ' + ','.join(str(i) for cl in covers for i in cl) if any(covers) else 'NO')
    # stack end: callout top vs stage band top and strip bottom (px)
    stk = '-'
    if cos and band:
        t = min(tops); stk = f"top {t:.0f}px; band top {band['top'] * H:.0f}px ({'inside band' if t >= band['top'] * H else 'ABOVE band top'}); strip bottom {strip['bottom']:.0f}px ({'clear' if t >= strip['bottom'] else 'OVER strip'})"
    cc = [f"chip{a['pos']}×chip{c['pos']} {min(a['right'],c['right'])-max(a['left'],c['left']):.0f}px" for i,a in enumerate(cos) for c in cos[i+1:] if inter(a,c)]
    callouts = '; '.join(f"chip{c['pos']} \"{c['text']}\" {rr(c)}" for c in cos) or '-'
    bc = ncol(img, band['top'], band['bottom']) if band else 0
    rows.append((png.stem, m['device'] + f" {W}x{H}", f"{m.get('dockSheet')} / {f'{pl['kind']}@{int(pl['at'])}ms' if pl else 'idle'}",
                 rr(cap) if capon else 'none', callouts + ('; CALLOUTS OVERLAP EACH OTHER: ' + ', '.join(cc) if cc else ''), isx, gp, cov, stk, pct, fin, eyes, hg, tgt, (m.get('captionText') or '')[:40]))
    if down: img.convert('RGB').resize((W, H), Image.LANCZOS).save(png, optimize=True)
hdr = ['frame','device','sheet / step','caption rect','callout rects','intersect?','gap px (caption top − callout bottom)','covers chip?','stack end','band %','face in band','eyes vs handle','⏳','targets ≥44','caption']
print('| ' + ' | '.join(hdr) + ' |'); print('|' + '---|' * len(hdr))
for r in rows: print('| ' + ' | '.join(str(x) for x in r) + ' |')
if verdict:
    print(f"\nCaption+callout frames: {len(verdict)}; any intersection: {any(v[1]=='YES' for v in verdict)}; min vertical gap {min(v[2] for v in verdict):.1f}px")
