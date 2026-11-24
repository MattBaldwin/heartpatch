#!/usr/bin/env python3
"""#868 captures: one row per PNG, measured from pixels + the shot's JSON sidecar
(hook scene.framing, DOM rects). Never looks at the picture; prints numbers.
Usage: python3 -I measure-868.py <captures dir>  (walks */*.png)"""
import json, sys, pathlib
from PIL import Image

root = pathlib.Path(sys.argv[1])
def f(x): return '-' if x is None else f'{x:.3f}'
def px(im):
    return im.get_flattened_data() if hasattr(im, 'get_flattened_data') else im.getdata()
def colours(img, y0, y1, x0=0.0, x1=1.0):
    w, h = img.size
    a, b = max(0, int(y0 * h)), min(h, int(y1 * h))
    if b <= a: return 0
    crop = img.crop((int(x0 * w), a, int(x1 * w), b)).convert('RGB')
    return len({(r >> 4, g >> 4, bl >> 4) for r, g, bl in px(crop)})

print('| run | frame | step | band (DOM head→cards) | hook band | plate+Order bottom | face (hook) | face in band | band colours | face-row colours |')
print('|---|---|---|---|---|---|---|---|---|---|')
for png in sorted(root.glob('*/*.png')):
    meta = json.loads(png.with_suffix('.json').read_text())
    img = Image.open(png)
    H = meta['inner']['h']
    R = meta['rects']
    fr = (meta['battle'] or {}).get('framing') or {}
    play = (meta['battle'] or {}).get('playing')
    vis = lambda k: R.get(k) and R[k]['bottom'] > 0
    head = R['bossHead']['bottom'] / H if vis('bossHead') else None
    cards = R['friends']['top'] / H if vis('friends') else None
    plate_b = max([R[k]['bottom'] for k in ('plate', 'order') if vis(k)] or [0]) / H or None
    face = fr.get('face'); band = fr.get('band')
    if not face or not band:
        verdict = 'no face (hook null)'
    else:
        top_ok = face['top'] >= max(band['top'], plate_b or 0) - 1e-6
        bot_ok = face['bottom'] <= band['bottom'] + 1e-6
        verdict = 'YES' if top_ok and bot_ok else ('under plate' if face['bottom'] <= (plate_b or band['top']) else 'NO (partly out)')
    bc = colours(img, head, cards) if head and cards else '-'
    fc = colours(img, face['top'], face['bottom'], 0.25, 0.75) if face else '-'
    if vis('result'): verdict += ' (result card up; band = above the card)'
    step = f"{play['kind']}@{int(play['at'])}ms" if play else 'idle'
    print(f"| {png.parent.name} | {png.stem} | {step} | {f(head)}–{f(cards)} | "
          f"{f(band and band['top'])}–{f(band and band['bottom'])} | {f(plate_b)} | "
          f"{f(face and face['top'])}–{f(face and face['bottom'])} | {verdict} | {bc} | {fc} |")
