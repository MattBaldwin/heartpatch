import json, os, subprocess, html, datetime, sys
S='/tmp/claude-0/-home-user-heartpatch/06d081df-f387-5d1b-a9fc-8394b1c9e92c/scratchpad'
sha=sys.argv[1]
m={e['file']:e for e in json.load(open(S+'/shots/manifest.json'))}
os.makedirs(S+'/site/v2',exist_ok=True)
def dev(e):
    v=e['viewport']; w,h=map(int,v.split('x'))
    d='iPhone SE' if w in (375,667) else 'iPhone 15'
    o='upright' if h>w else 'sideways'
    ins='safe-area insets emulated (CDP)' if e['insets']=='emulated' else ('no insets (SE has none)' if d=='iPhone SE' else 'insets not emulated')
    return f"{d} {w}×{h} · {o} · quality <code>{e['tier']}</code> · {ins}", o
SECTIONS=[
 ('gap-chip','The Gap chip','Owner-approved point 1. “✨ Juniper’s Gap is open” beside “🌙 Long Night”.',['gap-chip-se-up','gap-chip-i15-up','gap-chip-se-side'],''),
 ('gap-sheet','The Gap sheet','Owner-approved point 2, with the rescue-boost mention.',['gap-sheet-se-up','gap-sheet-i15-up','gap-sheet-se-side'],''),
 ('reveal','The 7:30 reveal','Owner-approved point 3: one plum “Go look 👀” and a quiet “Later”.',['reveal-go-look-se-up','reveal-go-look-i15-up','reveal-go-look-se-side'],'The result is this device’s real live Long Night. Only the status reply is stubbed to 7:31 PM with the Gap open. The reveal card is 98% opaque.'),
 ('crown','Keeper of the Night crown','Owner-approved point 4, held and not held, and on the patch stats sheet.',['report-held-crown-se-up','report-held-crown-i15-up','report-held-crown-se-side','report-miss-crown-se-up','report-miss-crown-i15-up','report-miss-crown-se-side','stats-crown-se-up','stats-crown-i15-up','stats-crown-se-side'],'The “Long Night tonight!” chip under the report comes from the dev clock’s real next Night, not the client.'),
 ('not-held','Not-held reveals','Both versions: some taken (rescue line), and my land stood.',['reveal-miss-rescue-se-up','reveal-miss-rescue-i15-up','reveal-miss-rescue-se-side','reveal-miss-stood-se-up','reveal-miss-stood-i15-up','reveal-miss-stood-se-side'],'The result comes from the device-cache result key in localStorage.'),
 ('gap-messages','Gap messages','“You’ve had your look 👀”, the server’s own refusal, and “One battle at a time”.',['had-look-se-up','had-look-i15-up','had-look-se-side','gap-message-closed-se-up','gap-message-closed-i15-up','gap-message-closed-se-side','gap-message-one-battle-se-up','gap-message-one-battle-i15-up','gap-message-one-battle-se-side'],'The local server’s map time is morning, so its real Gap reply is “closed”. The client shows the server’s words as sent.'),
 ('rescue','Rescue-boost line','The Hollow rescue list while the Gap is open.',['rescue-boost-se-up','rescue-boost-i15-up','rescue-boost-se-side'],''),
 ('tile','Tile panel: “He’ll come looking”','Claimed land with no fire, in the week of a Long Night. Real flow.',['tile-panel-dark-soon-se-up','tile-panel-dark-soon-i15-up','tile-panel-dark-soon-se-side'],'The panel is scrolled to the line. Its “scroll for more” fade still sits over the last words because the panel has more below. That fade is by design (map.css) and is logged as a follow-up.'),
 ('chooser','Patch-mate’s weekday chooser','A second Keeper sees it greyed: “The patch owner picks this.” Real flow.',['mate-weekday-chooser-se-up'],'Captured on SE upright only.'),
 ('chips','Chips','“in 2 days” and “tonight!” by day (real), then “🌇 in 42 min” and “🌙 Long Night” (stubbed clock).',['chip-in-2-days-se-up','chip-in-2-days-i15-up','chip-in-2-days-se-side','chip-tonight-se-up','chip-tonight-i15-up','chip-tonight-se-side','chip-42-min-se-up','chip-42-min-i15-up','chip-42-min-se-side','chip-night-se-up','chip-night-i15-up','chip-night-se-side'],'The map sky follows the device clock (late morning), so the dusk and night chips sit on a day-lit map. At real dusk and night the sky darkens.'),
 ('notice','Notice sheet and live feed','The chip’s sheet with “Light my land” (this patch has a dark spot), then the live feed and the dev strike’s reveal.',['notice-sheet-se-up','notice-sheet-i15-up','notice-sheet-se-side','live-feed-se-up','live-feed-i15-up','reveal-held-dev-se-up','reveal-held-dev-i15-up','reveal-held-dev-se-side'],'The dev route strikes by day, before 7:30, so this reveal has “Okay!” and no Go look, and the map stays day-lit.'),
]
used=set()
def fig(key):
    e=m.get(key+'.png')
    if not e: return ''
    used.add(key)
    src=S+'/shots/'+key+'.png'; out=S+'/site/v2/'+key+'.jpg'
    subprocess.run(['convert',src,'-strip','-quality','82',out],check=True)
    cap,o=dev(e)
    stub=f"<span class=stub>Stubbed: {html.escape(e['stubbed'])}</span>" if e.get('stubbed') else '<span>Real flow</span>'
    return f'<figure class="shot{" land" if o=="sideways" else ""}"><img src="v2/{key}.jpg" alt="{html.escape(e["title"])}, {cap.split(" · ")[0]}" loading="lazy"><figcaption><b>{html.escape(e["title"])}</b><span>{cap}</span>{stub}</figcaption></figure>'
secs=[]
for sid,t,lede,keys,note in SECTIONS:
    figs=''.join(fig(k) for k in keys)
    missing=[k for k in keys if k+'.png' not in m]
    if missing: note+=(' ' if note else '')+'Not captured: '+', '.join(missing)+'.'
    n=f'<p class=note>{note}</p>' if note else ''
    secs.append(f'<section id="{sid}"><header><h2>{t}</h2><p class=lede>{lede}</p></header>{n}<div class=strip>{figs}</div></section>')
# overlaps
def shot(src,title,cap,land):
    return f'<figure class="shot{" land" if land else ""}"><img src="{src}" alt="{html.escape(title)}" loading="lazy"><figcaption><b>{html.escape(title)}</b><span>{cap}</span></figcaption></figure>'
ov=[shot('shots/feed-se-l.jpg','Before (head 490d1cd): feed covers “Got it!”','iPhone SE 667×375 · sideways · quality <code>low</code> · no insets',True)]
for k in ['fix-12a-after-hint-up-se-side','fix-12a-after-got-it-se-side']:
    f=fig(k)
    if f: ov.append(f)
ov2=[shot('shots/reveal-se-p.jpg','Before (head 490d1cd): Adventure/Home tabs under the card','iPhone SE 375×667 · upright · quality <code>low</code> · no insets',False), fig('fix-12b-reveal-handles-hidden-se-up')]
secs.insert(0,f'''<section id="overlaps"><header><h2>The two fixed overlaps</h2><p class=lede>Found by the render-check on the first After screens.</p></header>
<p class=note><b>SE sideways, feed over “Got it!”:</b> while Sprout’s first-time tray hint is up, the narrator’s feed now waits, and it comes back once the hint is answered. The hint is in <code>mapBusy</code>, and a CSS fix makes a held feed really hide. <code>long-night.spec.ts</code> checks this.</p><div class=strip>{''.join(ov)}</div>
<p class=note><b>SE upright, cards over the side tabs:</b> while a Long Night card is up, both tabs are <code>visibility: hidden</code> (checked in the capture).</p><div class=strip>{''.join(ov2)}</div></section>''')
left=[k for k in m if k[:-4] not in used and not k.startswith('fix-12a-before')]
now=datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')
nav=''.join(f'<a href="#{s[0]}">{s[1]}</a>' for s in [('overlaps','Fixed overlaps')]+[(a,b) for a,b,*_ in SECTIONS])
page=open(S+'/tmpl.html').read().replace('@@VER@@',f'v2 · head {sha} · {now}').replace('@@NAV@@',nav).replace('@@SECS@@',''.join(secs))
open(S+'/site/index.html','w').write(page)
print('unused',left)
