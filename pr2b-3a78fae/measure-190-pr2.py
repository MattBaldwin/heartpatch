#!/usr/bin/env python3
"""Measures every PNG in the given folders against its .json sidecar (the battle dev hook's scene.framing / scene.playing
and DOM rects taken at shot time). Prints a markdown table; --overlays writes *.mask.png next to each PNG (not committed).

Numbers:
  dist       scene.framing.distance (camera distance)
  face       boss face box (eyes + mouth) top-bottom, fraction of viewport height, and its gap (css px) under the HUD strip
  team       the three friends' face boxes (top-bottom, fractions)
  edge       WORST BODY EDGE |x| of the end friends in normalized viewport coords (-1..1), measured on the PNG: the leftmost /
             rightmost column holding body-blue pixels in the team's rows (team face top - 0.05 H .. the sheet handle top).
             This is the silhouette INCLUDING ears and tail beads, so it is stricter than the unit test's body-circle edge (0.97).
  feet       lowest body-blue row of the team above the handle, as a fraction of viewport height (profile feetY target 0.62)
  chips      body-blue pixels that sit inside each team chip's DOM rect (overlap of a chip with a squishy)
"""
import json, sys, glob, os
import numpy as np
from PIL import Image

def mask_blue(a):
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    # the Puddlepuff body blues: strongly blue, brighter than the fog / grass / hills around them
    return (b > r + 55) & (b > g + 20) & (b > 150) & (r < 160)

def measure(png, overlays=False):
    m = json.load(open(png[:-4] + '.json'))
    img = Image.open(png).convert('RGB')
    W2, H2 = img.size
    s = m['inner']['dpr']
    W, H = W2 / s, H2 / s
    f = (m['battle'] or {}).get('framing') or {}
    pl = (m['battle'] or {}).get('playing')
    face, team = f.get('face'), f.get('team') or []
    rects = m['rects']
    strip = rects.get('strip')
    handle = rects.get('handle')
    row = {'frame': os.path.basename(png)[:-4], 'size': f'{int(W)}x{int(H)}',
           'beat': f"{pl['kind']}@{int(pl['at'])}ms" if pl else 'idle',
           'dist': f.get('distance'), 'facing': f.get('bossFacing')}
    if face:
        row['face'] = f"{face['top']:.3f}-{face['bottom']:.3f}"
        if strip and strip['bottom']:
            row['face_gap'] = face['top'] * H - strip['bottom']
        row['face_in_band'] = bool(face['top'] >= f['band']['top'] - 1e-3 and face['bottom'] <= f['band']['bottom'] + 1e-3)
    row['band'] = f"{f['band']['top']:.3f}-{f['band']['bottom']:.3f}" if f else '-'
    row['team'] = ' / '.join(f"{t['top']:.3f}-{t['bottom']:.3f}" for t in team) or '-'
    a = np.asarray(img)
    mask = mask_blue(a)
    limit = (handle['top'] if handle and handle['bottom'] else H) * s
    top = max(0, (min([t['top'] for t in team]) - 0.05) * H2) if team else 0.45 * H2
    rows = np.zeros(mask.shape[0], bool); rows[int(top):int(limit)] = True
    sub = mask & rows[:, None]
    cols = np.where(sub.sum(axis=0) >= 3)[0]
    if len(cols):
        xl, xr = cols.min(), cols.max()
        el, er = xl / W2 * 2 - 1, xr / W2 * 2 - 1
        row['edge_l'], row['edge_r'], row['edge'] = el, er, max(abs(el), abs(er))
    # the body alone: a morphological opening (erode then dilate, 41 px at 2x) drops the ear tips and the tail beads
    # (~30 px wide) and keeps the ~200 px teardrop, so its edge is the body's, not a bead's
    def box(m, k, axis):  # window sum of width k along axis (same size), via cumsum
        c = np.cumsum(np.pad(m.astype(np.int32), [(k // 2 + 1, k // 2) if i == axis else (0, 0) for i in range(2)]), axis=axis)
        n = m.shape[axis]
        hi = np.take(c, range(k, k + n), axis=axis); lo = np.take(c, range(0, n), axis=axis)
        return hi - lo
    q = 4; k = 41 // q | 1  # work at 1/4 size
    small = sub[:sub.shape[0] // q * q, :sub.shape[1] // q * q].reshape(sub.shape[0] // q, q, sub.shape[1] // q, q).any(axis=(1, 3))
    er = box(box(small, k, 0) == k, k, 1) == k  # erode (separable: all-ones window)
    er = box(box(small, k, 0) == k, k, 1) == k
    di = (box(box(er, k, 0) > 0, k, 1) > 0)
    opened = np.kron(di, np.ones((q, q), bool))
    bc = np.where(opened.sum(axis=0) >= q * 2)[0]
    if len(bc):
        bl, br = bc.min() / W2 * 2 - 1, bc.max() / W2 * 2 - 1
        row['body_l'], row['body_r'], row['body'] = bl, br, max(abs(bl), abs(br))
    rws = np.where(sub.sum(axis=1) >= 3)[0]
    if len(rws):
        row['feet'] = rws.max() / H2
        row['feet_px'] = rws.max() / s
        # the sheet handle's top edge is the line the feet must stay above
        row['feet_to_handle'] = (limit - rws.max()) / s
    chips = []
    for i, c in enumerate(m.get('friendRects') or []):
        x0, x1, y0, y1 = [int(round(v * s)) for v in (c['left'], c['right'], c['top'], c['bottom'])]
        n = int(mask[max(y0, 0):y1, max(x0, 0):x1].sum())
        chips.append(n)
    row['chip_overlap_px'] = chips
    if overlays:
        o = a.copy(); o[sub] = [255, 0, 255]
        Image.fromarray(o).save(png[:-4] + '.mask.png')
    return row

if __name__ == '__main__':
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    ov = '--overlays' in sys.argv
    rows = []
    for d in args:
        for png in sorted(glob.glob(os.path.join(d, '*.png'))):
            if png.endswith('.mask.png') or not os.path.exists(png[:-4] + '.json'): continue
            rows.append(measure(png, ov))
    hdr = ['frame', 'size', 'beat', 'dist', 'facing', 'face', 'face_gap', 'face_in_band', 'band', 'team', 'body_l', 'body_r', 'body', 'edge_l', 'edge_r', 'edge', 'feet', 'feet_to_handle', 'chip_overlap_px']
    print('| ' + ' | '.join(hdr) + ' |'); print('|' + '---|' * len(hdr))
    def fm(v):
        if v is None: return '-'
        if isinstance(v, float): return f'{v:.3f}' if abs(v) < 10 else f'{v:.1f}'
        return str(v)
    for r in rows: print('| ' + ' | '.join(fm(r.get(h)) for h in hdr) + ' |')
    if '--json' in sys.argv:
        json.dump(rows, open('measure.json', 'w'), indent=1)
