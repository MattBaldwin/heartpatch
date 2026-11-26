#!/usr/bin/env python3
"""#37 M0 Christmas mockups: numbers only. Usage: measure-37-m0.py <dir with <device>-<tag>/ run folders> [--downscale]
Per frame (PNG + .json sidecar from zz-capture-37.spec.ts.txt):
  colours   distinct RGB>>4 colours in the map area (frame minus every position:fixed element's rect)
  lum/sd    mean luminance (0-255) and its std dev over the map area
  own dE    CIE76 dE between the mean colour of owned tile centres and unowned land tile centres (same frame)
  bulbs     overlay bulb count, mean core luminance, mean lift over the 02-snow pixels at the same spots
  text      WCAG contrast of every [data-cap-text] (computed fg over nearest opaque bg)
  targets   min(w, h) of mock tap targets (CSS px = pt) and of the real HUD buttons on screen
  notch     iPhone: fixed elements that cross the top 59 / bottom 34 insets
"""
import glob, json, math, os, re, sys
from PIL import Image

LAND = {'meadow', 'forest', 'old-forest', 'hills', 'pumpkin-fields', 'clearing'}


def lum(rgb):
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rel(rgb):
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])


def ratio(a, b):
    la, lb = rel(a), rel(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def lab(rgb):
    r, g, b = (lin(c) for c in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return (116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z)))


def dE(a, b):
    return math.dist(lab(a), lab(b))


def parse(css):
    m = re.findall(r'[\d.]+', css or '')
    return tuple(float(v) for v in m[:3]) if len(m) >= 3 else None


def mean_px(im, cx, cy, r=4, scale=2):
    x0, y0 = int(cx * scale), int(cy * scale)
    px = [im.getpixel((x, y))[:3] for x in range(max(0, x0 - r), min(im.width, x0 + r + 1))
          for y in range(max(0, y0 - r), min(im.height, y0 + r + 1))]
    n = len(px)
    if n == 0:
        return (0.0, 0.0, 0.0)
    return tuple(sum(p[i] for p in px) / n for i in range(3))


def covered(x, y, rects, pad=6):
    return any(r['left'] - pad <= x <= r['right'] + pad and r['top'] - pad <= y <= r['bottom'] + pad for r in rects)


def main(root, downscale):
    rows = []
    for jpath in sorted(glob.glob(os.path.join(root, '*', '*.json'))):
        meta = json.load(open(jpath))
        png = jpath[:-5] + '.png'
        im = Image.open(png).convert('RGB')
        sc = im.width / meta['inner']['w']
        W, H = meta['inner']['w'], meta['inner']['h']
        fixed = [r for r in meta['fixed'] if not (r['right'] - r['left'] >= W - 1 and r['bottom'] - r['top'] >= H - 1)]
        # map area: pixels outside any fixed element (sampled every 2nd pixel)
        seen, ls = set(), []
        for y in range(0, im.height, 2):
            for x in range(0, im.width, 2):
                if covered(x / sc, y / sc, fixed, 0):
                    continue
                p = im.getpixel((x, y))
                seen.add((p[0] >> 4, p[1] >> 4, p[2] >> 4))
                ls.append(lum(p))
        mean = sum(ls) / len(ls)
        sd = math.sqrt(sum((v - mean) ** 2 for v in ls) / len(ls))
        row = {'frame': os.path.basename(png)[:-4], 'colours': len(seen), 'lum': round(mean, 1), 'sd': round(sd, 1),
               'map_px_share': round(len(ls) * 4 / (im.width * im.height), 3)}
        # ownership delta
        own, wild = [], []
        for t in meta.get('tiles', []):
            if t['home'] or t['terrain'] not in LAND or t['xy'] is None:
                continue
            x, y = t['xy']
            if y < 120:
                continue
            # off-centre samples (the dark-moon / safe-glow marks sit on the centre of owned tiles)
            for dx, dy in ((-17, 8), (17, 8), (0, 15)):
                if 0 < x + dx < W and 0 < y + dy < H and not covered(x + dx, y + dy, fixed, 3):
                    (own if t['owned'] else wild).append(mean_px(im, x + dx, y + dy, 2, sc))
        if own and wild:
            mo = tuple(sum(c[i] for c in own) / len(own) for i in range(3))
            mw = tuple(sum(c[i] for c in wild) / len(wild) for i in range(3))
            row.update(own_n=len(own), wild_n=len(wild), own_rgb=[round(v) for v in mo], wild_rgb=[round(v) for v in mw],
                       own_dE=round(dE(mo, mw), 1), own_dL=round(lum(mo) - lum(mw), 1))
        # bulbs vs the snow frame without them
        st = meta.get('bulbs')
        if st:
            snow = Image.open(os.path.join(os.path.dirname(jpath), os.path.basename(png).split('-')[0] + '-' + os.path.basename(png).split('-')[1] + '-02-snow.png')).convert('RGB')
            core, lift = [], []
            for x, y in st['pts']:
                a, b = mean_px(im, x, y, 1, sc), mean_px(snow, x, y, 1, sc)
                core.append(lum(a)); lift.append(lum(a) - lum(b))
            row.update(bulbs=st['bulbs'], bulb_core_lum=round(sum(core) / len(core), 1), bulb_lift=round(sum(lift) / len(lift), 1),
                       bulb_ratio_vs_bg=round(sum(ratio(mean_px(im, x, y, 1, sc), mean_px(snow, x, y, 1, sc)) for x, y in st['pts']) / len(st['pts']), 2),
                       bulb_colours=st['byColor'])
        # text contrast
        tx = []
        for t in meta.get('texts', []):
            fg, bg = parse(t['fg']), parse(t['bg'])
            if fg and bg:
                tx.append((round(ratio(fg, bg), 2), t['text'][:18], t['size']))
        if tx:
            row['text_min'] = min(tx)[:2]
            row['text_n'] = len(tx)
            row['text_fail_4.5'] = [t for t in tx if t[0] < 4.5 and t[2] < 24]
        # tap targets
        mock = [t for t in meta['targets'] if re.search(r'\b(day|open|quiet|x)\b', t['cls'])]
        real = [t for t in meta['targets'] if t not in mock and t['w'] > 20]
        if mock:
            row['mock_targets_min'] = round(min(min(t['w'], t['h']) for t in mock), 1)
            row['mock_targets_n'] = len(mock)
        if real:
            row['hud_targets_min'] = round(min(min(t['w'], t['h']) for t in real), 1)
        # advent sheet vs surrounding snow
        for r in fixed:
            if r['cls'].startswith('') and 'cap-advent' in (r.get('id') or ''):
                pass
        # notch
        if meta['device'] == 'iphone':
            bad = [f"{r['cls'] or r['id']}:{round(r['top'])}-{round(r['bottom'])}" for r in fixed
                   if (r['top'] < 59 and r['bottom'] > 0 and r['top'] >= 0 and r['bottom'] - r['top'] < 400) or (r['bottom'] > H - 34 and r['top'] < H - 20 and r['bottom'] - r['top'] < 400 and r['top'] > 100)]
            row['notch_violations'] = bad
        rows.append(row)
        if downscale:
            im.resize((meta['inner']['w'], meta['inner']['h']), Image.LANCZOS).save(png, optimize=True)
    # snow vs today per run
    by = {}
    for r in rows:
        by[r['frame']] = r
    for f, r in by.items():
        if f.endswith('02-snow'):
            t = by.get(f.replace('02-snow', '01-today'))
            if t:
                r['vs_today'] = {'dlum': round(r['lum'] - t['lum'], 1), 'dsd': round(r['sd'] - t['sd'], 1), 'colours_ratio': round(r['colours'] / t['colours'], 2)}
    json.dump(rows, open(os.path.join(root, 'measure.json'), 'w'), indent=1)
    for r in rows:
        print(json.dumps(r))


if __name__ == '__main__':
    main(sys.argv[1], '--downscale' in sys.argv)
