#!/usr/bin/env python3
"""#190 M0: per-frame numbers from pixels + sidecar JSON (extends measure-868-round3.py). Prints a markdown table.
Usage: python3 -I measure-190-m0.py <dir with <frame>.png + .json> [--downscale]
--downscale rewrites each PNG to 393x852 (iPhone) / 820x1180 (iPad) AFTER measuring (measure on the 2x originals)."""
import json, sys, pathlib
import numpy as np
from PIL import Image
root = pathlib.Path(sys.argv[1]); down = '--downscale' in sys.argv
f = lambda x: '-' if x is None else f'{x:.3f}'
def region(img, y0, y1, x0=0.0, x1=1.0):
    w, h = img.size
    a, b = max(0, int(y0 * h)), min(h, int(y1 * h))
    return np.asarray(img.crop((int(x0 * w), a, int(x1 * w), b)).convert('RGB')).astype(int) if b > a else None
def ncol(p):
    if p is None: return 0
    c = p >> 4
    return len(np.unique(c[..., 0] * 256 + c[..., 1] * 16 + c[..., 2]))
OPT = {'today': 'Today', 'opt1': 'Option 1', 'opt1c': 'Option 1c', 'opt3': 'Option 3'}
rows = []
for png in sorted(root.glob('*.png')):
    m = json.loads(png.with_suffix('.json').read_text())
    img = Image.open(png); H = m['inner']['h']; W = m['inner']['w']; R = m['rects']
    vis = lambda r: r and r['bottom'] > 0 and r['right'] > r['left']
    b = m['battle'] or {}; fr = b.get('framing') or {}; pl = b.get('playing')
    var = m['variant']['var']; cap = m['variant']['cap']
    head = R['bossHead']['bottom'] / H if vis(R['bossHead']) else None
    plate_b = max([R[k]['bottom'] / H for k in ('plate', 'order') if vis(R[k])] or [0]) or None
    strip = max(x for x in (head, plate_b) if x) if (head or plate_b) else None
    fr_rect = R['friends'] if vis(R['friends']) else None
    handle = fr_rect['top'] / H if fr_rect else None
    chips = m.get('friendRects') or []
    chip_top = min([c['top'] for c in chips if c['w'] > 0], default=None)
    chip_top = chip_top / H if chip_top else None
    band, face, team = fr.get('band'), fr.get('face'), [t for t in (fr.get('team') or []) if t]
    bandpct = (band['bottom'] - band['top']) if band else None
    # face in band: inside the hook band and below the DOM strip's bottom
    if face and band and strip is not None:
        fin = 'YES' if face['top'] >= max(band['top'], strip) - 1e-6 and face['bottom'] <= band['bottom'] + 1e-6 else 'NO'
    else: fin = 'no face'
    # team eyes above the handle (the top of what safe() reads as the bottom edge)
    tmax = max([t['bottom'] for t in team], default=None)
    eyes = '-' if tmax is None or handle is None else ('YES' if tmax <= handle + 1e-6 else f'NO (+{(tmax-handle)*H:.0f}px)')
    # tap targets: chips + visible picker buttons + go + the ✕
    tg = []
    for c in chips:
        if c['w'] > 0: tg.append(('chip', c['w'], c['h']))
    for mv in m.get('moveRects') or []:
        if mv['w'] > 0 and mv['h'] > 0 and mv['top'] >= 0 and mv['bottom'] <= H + 0.5: tg.append((mv['t'], mv['w'], mv['h']))
    if vis(R['leave']): tg.append(('✕', R['leave']['right'] - R['leave']['left'], R['leave']['bottom'] - R['leave']['top']))
    small = [f"{n}:{w:.0f}x{h:.0f}" for n, w, h in tg if min(w, h) < 43.9]
    mn = min([min(w, h) for n, w, h in tg], default=None)
    tgt = ('YES' if not small else 'NO ' + ', '.join(small)) + (f' (min {mn:.0f}px)' if mn else '')
    # DOM band: strip bottom -> handle/cards top (today: head bottom -> cards top)
    dom_top = strip
    dom = f"{f(dom_top)}–{f(handle)}"
    # stage colours: distinct RGB>>4 in the hook band (full width) and in the face rows (centre half)
    bc = ncol(region(img, band['top'], band['bottom'])) if band else 0
    fc = ncol(region(img, face['top'], face['bottom'], 0.25, 0.75)) if face else 0
    # picker overflow (risen frames)
    sc = m.get('sheetScroll') or {}
    ov = '-' if not sc.get('pickerClient') else f"picker {sc['pickerScroll']}/{sc['pickerClient']}px, sheet {sc['sheetScroll']}/{sc['sheetClient']}px"
    # overlap of the ✕ with the band (it sits at inset+58, inside the stage band under the strip)
    lv = R['leave']
    xin = '-' if not vis(lv) or not band else (f"overlaps band top ({lv['top']/H:.3f}–{lv['bottom']/H:.3f} vs {band['top']:.3f})" if lv['top'] / H < band['top'] < lv['bottom'] / H else ('inside band' if band['top'] <= lv['top'] / H < band['bottom'] else 'outside band'))
    name = png.stem
    rows.append(dict(name=name, opt=OPT.get(var, var) + (f' ({cap})' if cap and var in ('opt1','opt1c') else ''), step=(f"{pl['kind']}@{int(pl['at'])}ms" if pl else 'idle'),
        dom=dom, hook=f"{f(band and band['top'])}–{f(band and band['bottom'])}", pct=f"{bandpct*100:.1f}%" if bandpct else '-',
        face=f"{f(face and face['top'])}–{f(face and face['bottom'])}", fin=fin, eyes=eyes, tgt=tgt, bc=bc, fc=fc, ov=ov, xin=xin,
        dist=fr.get('distance'), chip_top=chip_top, handle=handle, strip=strip, tmax=tmax))
    if down:
        tw, th = (393, 852) if m['device'] == 'iphone' else (820, 1180)
        img.convert('RGB').resize((tw, th), Image.LANCZOS).save(png, optimize=True)
print('| frame | option | step | band DOM (strip → handle/cards top) | band hook | band % of screen | face (hook) | face in band | eyes above handle | targets ≥44pt | stage colours (band / face rows) | picker fits | ✕ vs band | camera distance |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for r in rows:
    d = f"{r['dist']:.1f}" if r['dist'] else '-'
    print(f"| {r['name']} | {r['opt']} | {r['step']} | {r['dom']} | {r['hook']} | {r['pct']} | {r['face']} | {r['fin']} | {r['eyes']} | {r['tgt']} | {r['bc']} / {r['fc']} | {r['ov']} | {r['xin']} | {d} |")
