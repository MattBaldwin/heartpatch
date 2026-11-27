"""#190 PR 3 entrance captures: card vs boss face / team / band, skip hint, settled framing (from the JSON sidecars)."""
import json, glob, os
HEADROOM = 1.5
rows = []
for j in sorted(glob.glob('*/*.json')):
    m = json.load(open(j)); h = m['inner']['h']; f = (m['scene'] or {}).get('framing') or {}
    band = f.get('band'); face = f.get('face'); team = f.get('team') or []
    card = m['rects']['card']; skip = m['rects']['skip']; e = m['entrance']
    cardOn = card is not None and float(card['opacity']) > 0.01
    def frac(px): return px / h
    r = {'frame': m['file'][:-4], 'at': round(e['at']) if e else 'done', 'skippable': e['skippable'] if e else None,
         'skip_opacity': skip['opacity'] if skip else None,
         'band': f"{band['top']:.3f}-{band['bottom']:.3f}" if band else None,
         'face': f"{face['top']:.3f}-{face['bottom']:.3f}" if face else None,
         'team_top': f"{min(t['top'] for t in team):.3f}" if team else None,
         'feet': f"{f['teamFeet']:.3f}" if f.get('teamFeet') is not None else None}
    if cardOn and band and face:
        ct, cb = frac(card['top']), frac(card['bottom'])
        head = face['top'] - (face['bottom'] - face['top']) * HEADROOM
        r.update(card=f"{ct:.3f}-{cb:.3f}", card_opacity=card['opacity'],
                 in_band=ct >= band['top'] and cb <= band['bottom'],
                 clear_face=cb <= face['top'] or ct >= face['bottom'], clear_head=cb <= head,
                 clear_team=(cb <= min(t['top'] for t in team)) if team else None)
    rows.append(r)
keys = ['frame','at','skippable','skip_opacity','band','face','team_top','feet','card','card_opacity','in_band','clear_face','clear_head','clear_team']
print('| ' + ' | '.join(keys) + ' |'); print('|' + '---|' * len(keys))
for r in rows: print('| ' + ' | '.join(str(r.get(k, '')) for k in keys) + ' |')
