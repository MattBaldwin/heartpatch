#!/usr/bin/env python3
"""#868 round 3: per-frame numbers from pixels + sidecar JSON. Prints a markdown table; never views images.
Usage: python3 -I measure-868-round3.py <dir with <run>/<frame>.png+.json> [round2 data dir]
Extends measure-868.py: adds open, cardsFaded, card opacity (DOM), cards pixel check, team-eyes check, facing check, rest drift vs round 2."""
import json, sys, pathlib
import numpy as np
from PIL import Image
root = pathlib.Path(sys.argv[1])
r2 = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None
f = lambda x: '-' if x is None else f'{x:.3f}'
def region(img, y0, y1):
    w, h = img.size
    a, b = max(0, int(y0 * h)), min(h, int(y1 * h))
    return np.asarray(img.crop((0, a, w, b)).convert('RGB')).astype(int) if b > a else None
def ncol(p):
    if p is None: return 0
    c = p >> 4
    return len(np.unique(c[..., 0] * 256 + c[..., 1] * 16 + c[..., 2]))
def contrast(p):  # std of luminance: low = washed/faded, high = opaque UI
    if p is None: return 0.0
    return float((0.299 * p[..., 0] + 0.587 * p[..., 1] + 0.114 * p[..., 2]).std())
rows = []
rest = {}
for png in sorted(root.glob('*/*.png')):
    m = json.loads(png.with_suffix('.json').read_text())
    img = Image.open(png); H = m['inner']['h']; R = m['rects']
    b = m['battle'] or {}; fr = b.get('framing') or {}; pl = b.get('playing')
    vis = lambda k: R.get(k) and R[k]['bottom'] > 0
    head = R['bossHead']['bottom'] / H if vis('bossHead') else None
    cards = R['friends']['top'] / H if vis('friends') else None
    cardsb = R['friends']['bottom'] / H if vis('friends') else None
    plate = R['plate']['bottom'] / H if vis('plate') else None
    order = R['order']['bottom'] / H if vis('order') else None
    sheet = R['sheet']['top'] / H if vis('sheet') else None
    pb = max([x for x in (head, plate, order) if x] or [0]) or None
    face, band, team, fac = fr.get('face'), fr.get('band'), fr.get('team') or [], fr.get('bossFacing')
    fd = m.get('friendsDom') or {}
    cf = fr.get('cardsFaded')
    tb = [t for t in team if t and np.isfinite(t.get('bottom', float('nan')))]
    tmax = max([t['bottom'] for t in tb], default=None)
    if tmax is None or cards is None: teamv = '-'
    else: teamv = 'pass (faded)' if cf else ('pass' if tmax <= cards + 1e-6 else 'FAIL')
    if vis('result'): fv = 'result card up'
    elif fac is not None and fac < 0.3: fv = 'null OK' if not face else 'FAIL (face set, facing away)'
    elif not face or not band: fv = 'FAIL (face null while facing)'
    else:
        ok = face['top'] >= max(band['top'], pb or 0) - 1e-6 and face['bottom'] <= band['bottom'] + 1e-6
        fv = 'pass' if ok else 'FAIL'
    # pixel check of the cards' box: distinct colours and luminance std
    pc = contrast(region(img, cards, cardsb)) if cards else None
    pn = ncol(region(img, cards, cardsb)) if cards else None
    run = png.parent.name; frame = png.stem
    if frame.endswith('01-rest') or frame == 'iphone-01-rest' or frame == 'ipad-01-rest': rest[(run, frame)] = (pc, pn)
    rows.append((run, frame, png, m, locals().copy()))
print('| run | frame | step | band (hook) | open | cardsFaded | cards opacity (DOM) | `.battle-cards-faded` | cards top | cards pixels (colours / lum-std; vs rest) | team box bottom | team eyes | boss face (hook) | bossFacing | boss face | head/plate/Order bottom | sheet top |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for run, frame, png, m, L in rows:
    fr = L['fr']; pl = L['pl']; band = L['band']; face = L['face']
    step = f"{pl['kind']}@{int(pl['at'])}ms" if pl else 'idle'
    r0 = rest.get((run, frame.split('-')[0] + '-01-rest'))
    pxs = '-' if L['pc'] is None else f"{L['pn']} / {L['pc']:.1f}" + (f"; {L['pc']/r0[0]:.2f}× rest lum-std" if r0 and r0[0] else '')
    hp = '/'.join(f(L[k]) for k in ('head', 'plate', 'order'))
    print(f"| {run} | {frame} | {step} | {f(band and band['top'])}–{f(band and band['bottom'])} | {f(fr.get('open'))} | {fr.get('cardsFaded')} | "
          f"{L['fd'].get('opacity','-')} | {L['fd'].get('faded','-')} | {f(L['cards'])} | {pxs} | {f(L['tmax'])} | {L['teamv']} | "
          f"{f(face and face['top'])}–{f(face and face['bottom'])} | {f(L['fac'])} | {L['fv']} | {hp} | {f(L['sheet'])} |")
# rest drift vs round 2 (same device/time-of-day, after build)
if r2:
    print('\nRest drift vs round 2 (|Δ| of face top/bottom, band, cards top):')
    for run, frame, png, m, L in rows:
        if not frame.endswith('01-rest'): continue
        tod = 'night' if 'night' in run else 'day'
        p = r2 / f"{'ipad' if frame.startswith('ipad') else tod}-{frame}-after.json"
        if not p.exists(): continue
        o = json.loads(p.read_text()); of = o['battle']['framing']; nf = L['fr']
        d = lambda a, b: abs(a - b)
        print(f"- {run} {frame}: face top Δ{d(of['face']['top'], nf['face']['top']):.3f} bottom Δ{d(of['face']['bottom'], nf['face']['bottom']):.3f}; "
              f"band top Δ{d(of['band']['top'], nf['band']['top']):.3f} bottom Δ{d(of['band']['bottom'], nf['band']['bottom']):.3f}; "
              f"cards opacity {L['fd'].get('opacity')}, cardsFaded {nf.get('cardsFaded')}")
