#!/usr/bin/env python3
"""#190 PR 1 (real HUD at f48d8ca): per-frame numbers from the .json sidecars + pixels. Prints a markdown table.
Usage: python3 -I measure-190-pr1.py <dir with <frame>.png + .json> [--downscale]
--downscale rewrites each PNG to device size AFTER measuring (measure on the 2x originals).
Fractions are of window height; px are CSS px."""
import json, sys, pathlib
import numpy as np
from PIL import Image
root = pathlib.Path(sys.argv[1]); down = '--downscale' in sys.argv
f = lambda x: '-' if x is None else f'{x:.3f}'
def ncol(img, y0, y1, x0=0.0, x1=1.0):
    w, h = img.size
    a, b = max(0, int(y0 * h)), min(h, int(y1 * h))
    if b <= a: return 0
    c = np.asarray(img.crop((int(x0 * w), a, int(x1 * w), b)).convert('RGB')).astype(int) >> 4
    return len(np.unique(c[..., 0] * 256 + c[..., 1] * 16 + c[..., 2]))
def vis(r): return bool(r) and r['right'] - r['left'] > 0 and r['bottom'] - r['top'] > 0
rows = []
for png in sorted(root.glob('*.png')):
    jp = png.with_suffix('.json')
    if not jp.exists(): continue
    m = json.loads(jp.read_text()); img = Image.open(png)
    H = m['inner']['h']; W = m['inner']['w']; R = m['rects']
    b = m['battle'] or {}; fr = b.get('framing') or {}; pl = b.get('playing')
    band, face, team = fr.get('band'), fr.get('face'), [t for t in (fr.get('team') or []) if t]
    facing = fr.get('bossFacing')
    strip, handle = R['strip'], R['handle']
    s_bot = strip['bottom'] / H if vis(strip) else None
    h_top = handle['top'] / H if vis(handle) else None
    dom = f"{f(s_bot)}–{f(h_top)}" + (f" ({(h_top - s_bot) * 100:.1f}%)" if s_bot and h_top else '')
    hook = f"{f(band and band['top'])}–{f(band and band['bottom'])}"
    pct = f"{(band['bottom'] - band['top']) * 100:.1f}%" if band else '-'
    # face in band (only when facing the camera)
    if face and band and facing is not None and facing >= 0.3:
        top_lim = max(band['top'], s_bot or 0)
        fin = 'YES' if face['top'] >= top_lim - 1e-6 and face['bottom'] <= band['bottom'] + 1e-6 else f"NO ({face['top']:.3f}–{face['bottom']:.3f})"
    else: fin = f"n/a (bossFacing {facing:.2f})" if facing is not None else 'n/a'
    # eyes vs handle top
    tmax = max([t['bottom'] for t in team], default=None)
    eyes = '-' if tmax is None or h_top is None else (f"clear ({(h_top - tmax) * H:.0f}px)" if tmax <= h_top else f"OVERLAP {(tmax - h_top) * H:.0f}px")
    # energy bar and the hourglass chip
    e = R['energy']; bar = (e['right'] - e['left']) if vis(e) else None
    wd = R['winding']
    wv = m.get('windVis')
    live = wv is None or (not wv.get('hidden') and wv.get('opacity') != '0' and wv.get('visibility') != 'hidden' and wv.get('display') != 'none')
    if vis(wd) and vis(strip) and live:
        ins = wd['left'] >= strip['left'] - .5 and wd['right'] <= strip['right'] + .5 and wd['top'] >= strip['top'] - .5 and wd['bottom'] <= strip['bottom'] + .5
        hg = f"shown, {'inside strip' if ins else 'CLIPPED'}" + ('' if wv else ' (slot rect only; visibility not recorded)')
    else: hg = 'not shown' + (' (slot rect only)' if vis(wd) else '')
    # targets >=44
    tg = [('chip', c['w'], c['h']) for c in (m.get('friendRects') or []) if c['w'] > 0]
    for mv in m.get('moveRects') or []:
        if mv['w'] > 0 and mv['h'] > 0 and mv['top'] >= 0 and mv['bottom'] <= H + .5: tg.append((mv['t'], mv['w'], mv['h']))
    lv = R['leave']
    if vis(lv): tg.append(('✕', lv['right'] - lv['left'], lv['bottom'] - lv['top']))
    small = [f"{n}:{w:.0f}x{h:.0f}" for n, w, h in tg if min(w, h) < 43.9]
    mn = min([min(w, h) for n, w, h in tg], default=None)
    tgt = ('YES' if not small else 'NO ' + ', '.join(small)) + (f' (min {mn:.0f})' if mn else '')
    # ✕ vs band
    if vis(lv) and band:
        xin = 'OVERLAPS band' if lv['bottom'] / H > band['top'] and lv['top'] / H < band['bottom'] else f"clear (✕ bottom {lv['bottom'] / H:.3f} ≤ band top {band['top']:.3f})"
    else: xin = '-'
    # caption sticker vs team eye boxes (eye boxes are y-ranges only: the hook has no x)
    cp = R['caption']
    if vis(cp) and m.get('captionVisible', '0/').split('/')[0] not in ('0', None):
        c0, c1 = cp['top'] / H, cp['bottom'] / H
        ov = [t for t in team if c0 < t['bottom'] and c1 > t['top']]
        stk = (f"covers eyes' rows ({c0:.3f}–{c1:.3f})" if ov else f"clear of eyes (sticker {c0:.3f}–{c1:.3f}, eyes {min(t['top'] for t in team):.3f}–{tmax:.3f})") if team else 'no eyes'
        if h_top and c1 > h_top: stk += '; OVER handle'
    else: stk = 'no sticker'
    bc = ncol(img, band['top'], band['bottom']) if band else 0
    fc = ncol(img, face['top'], face['bottom'], .25, .75) if face else 0
    sc = m.get('sheetScroll') or {}
    ov = '-' if not sc.get('pickerClient') else f"picker {sc['pickerScroll']}/{sc['pickerClient']}, sheet {sc['sheetScroll']}/{sc['sheetClient']}"
    rd = R.get('round'); ch = [c for c in (m.get('friendRects') or []) if c['w'] > 0]
    gap = f"{min(c['left'] for c in ch) - rd['right']:.1f}px" if vis(rd) and ch else '-'
    stat = ','.join(c.get('status') or '?' for c in (m.get('friendRects') or []))
    rows.append((png.stem, m['device'] + f" {W}x{H}", f"{m.get('dockSheet')} / {f'{pl['kind']}@{int(pl['at'])}ms' if pl else 'idle'}", dom, hook, pct, fin, eyes,
                 f"{bar:.0f}" if bar else '-', hg, tgt, xin, stk, f"{bc}/{fc}", ov, stat, gap, (m.get('captionText') or m.get('caption') or '')[:40]))
    if down:
        tw, th = (W, H)
        img.convert('RGB').resize((tw, th), Image.LANCZOS).save(png, optimize=True)
hdr = ['frame','device','sheet / step','band DOM (strip→handle)','band hook','band %','face in band','eyes vs handle','bar px','⏳','targets ≥44','✕ vs band','sticker vs eyes','colours band/face','fits','chip status','Round↔chip gap','caption']
print('| ' + ' | '.join(hdr) + ' |'); print('|' + '---|' * len(hdr))
for r in rows: print('| ' + ' | '.join(str(x) for x in r) + ' |')
# sheet heights across picker steps
for hp in sorted(root.glob('*sheet-heights.json')):
    hs = json.loads(hp.read_text()); d = {round(x['dock'], 1) for x in hs if x.get('dock')}; s = {round(x['sheet'], 1) for x in hs if x.get('sheet')}
    print(f"\n{hp.name}: {len(hs)} picker steps; dock heights {sorted(d)}, sheet heights {sorted(s)} -> {'IDENTICAL' if len(d) == 1 and len(s) == 1 else 'DIFFERS'}")
