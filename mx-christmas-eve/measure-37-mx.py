#!/usr/bin/env python3
"""Reads the .json sidecars next to the frames (DOM rects at shot time, CSS px) and prints the README numbers."""
import json, glob, sys, os
d = sys.argv[1]
for f in sorted(glob.glob(f'{d}/*.json')):
    m = json.load(open(f)); n = os.path.basename(f)[:-5]; out = []
    w, h = m['inner']['w'], m['inner']['h']; ins = m['inset']
    s = m.get('strip')
    if s:
        r = s['rect']; out.append(f"strip h={r['h']:.0f} ({r['t']:.0f}-{r['b']:.0f}) w={r['w']:.0f}")
        nm, sl, en, pa, pc = s['name'], s['slot'], s['energy'], s['patch'], s['pct']
        inside = lambda x: x and x['t'] >= r['t']-0.5 and x['b'] <= r['b']+0.5 and x['l'] >= r['l']-0.5 and x['r'] <= r['r']+0.5
        out.append(f"name {nm['w']:.0f}px clipped={nm['clipped']} in-strip={inside(nm)}")
        out.append(f"slot {sl['w']:.0f}px in-strip={inside(sl)}")
        if pa: out.append(f"energy {en['w']:.0f}px patch {pa['w']:.0f}px (track+star+%) in-strip={inside(pa)} pct '{pc['text']}' {pc['w']:.0f}px; overlaps slot={pa['r']>sl['l']+0.5} overlaps energy={pa['l']<en['r']-0.5}")
    texts = [t for t in m['text'] if t['t']]
    if texts: out.append(f"min text {min(t['fs'] for t in texts):.0f}px (n={len(texts)})")
    tg = m['targets']
    if tg: out.append(f"min target {min(min(t['w'], t['h']) for t in tg):.0f}px (n={len(tg)})")
    for p in m['panels']:
        k = p['cls'].split()[0]
        fit = p['sh'] <= p['ch'] + 1
        inside = p['t'] >= ins['top'] - 0.5 and p['b'] <= h - ins['bottom'] + 0.5 and p['l'] >= ins['left'] - 0.5 and p['r'] <= w - ins['right'] + 0.5
        out.append(f"{k}: {p['t']:.0f}-{p['b']:.0f} x {p['l']:.0f}-{p['r']:.0f} in-safe-area={inside} fits-no-scroll={fit} (scroll {p['sh']}/{p['ch']})")
    if m.get('chipHits') is not None: out.append(f"chip overlaps real controls: {m['chipHits'] or 'none'}")
    if m.get('big'):
        b = m['big']; out.append(f"scale: big h={b['big']['h']:.0f} tiny h={b['tiny']['h']:.0f} puddlepuff h={b['pp']['h']:.0f} (big/pp = {b['big']['h']/b['pp']['h']:.1f}x)")
    print(f"- **{n}** ({w}x{h}, insets t{ins['top']:.0f} b{ins['bottom']:.0f} l{ins['left']:.0f} r{ins['right']:.0f}): " + '; '.join(out))
