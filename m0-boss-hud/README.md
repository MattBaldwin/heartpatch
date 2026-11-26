# #190 M0: boss HUD mockup options on the notched iPhone, measured

Capture-time mockups only: **no app code changed**. Each option is CSS (plus a 50 ms DOM sync loop) injected with
`page.addStyleTag` / `page.evaluate` after the fight is up, on `main` `bc0e111` (runtime checkout in a worktree; this
branch holds only these files). Measured by `measure-190-m0.py` (PIL + the `.json` sidecars: the battle dev hook's
`scene.framing`, DOM rects at shot time). PNGs are downscaled to 393×852 / 820×1180 **after** measuring (on the 2× originals).

## Method / environment

- Spec: `zz-capture-190.spec.ts.txt` (from `round2-19a0d8c/zz-capture-868-round2.spec.ts.txt`; copy to
  `apps/client/tests/e2e/zz-capture-190.spec.ts`). Real server, Rakelet pinned into `boss_windows` with SQL `now()`, team Lv 30, Partner Lv 18,
  `?tier=high`, Chromium + SwiftShader, DPR 2, night timezone America/Sao_Paulo (the windup pair also in Asia/Bangkok = day).
- Env: `service postgresql start`; role + db `heartpatch`; `cp .env.example .env`; `pnpm install`; `pnpm db:migrate && pnpm db:seed`; `pnpm build`;
  server and client dev servers started by hand with `HP_MINI_BOSSES=testers HP_MINI_BOSSES_TESTERS=capa,…,capl` (+ the e2e defaults
  `HP_SIGNUP_CODE`, `HP_DEV_SQUISHY_GRANTS=true`, …); `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`, `--project=iphone-chromium|ipad-chromium`, `--trace off`.
- iPhone 393×852 with CDP safe-area insets top 59 / bottom 34; iPad 820×1180 no insets.
- **Rest mode** (`CAPTURE_MODE=rest`): all variants shot in turn on **one** fight at the move picker (same boss pose
  family), each after ~5 s so the camera has eased to the re-measured band. **Windup mode** (`CAPTURE_MODE=windup CAPTURE_VARIANT=opt1`): Option 1 applied for the whole
  fight; the round2 caption hunter shoots the "Winding up!" burst and the hit.
- **How the 3D stage re-frames:** `battle-hud.ts` `safe()` measures `.boss-head` bottom (+10 px) and `.boss-friends` top, and caps the band bottom at
  `1 − sheet max-height / H`. The overrides keep those class names at the new sizes and `applyVariant` fires a `resize` (which makes `safe()` forget its cache),
  so the real camera re-fitted by itself: `scene.framing.band` is the true hook band, no hook set by hand. (Camera pitch is untouched: M0's "frame at pitch 4°" was not asked of this lane.)
- **Column notes.** band DOM = strip/`.boss-head` bottom → `.boss-friends` top (the handle top, incl. its 8 px clear); band hook = `scene.framing.band`;
  band % = hook band height; face in band = face top ≥ max(band top, strip bottom) and bottom ≤ band bottom; eyes above handle = every team eye box bottom ≤ handle top;
  targets = chip circles, visible picker buttons, Go, ✕ (CSS px; 44 pt = 44 px); stage colours = distinct RGB>>4 colours in the hook band (full width) / in the face rows (centre half): hundreds = the stage is not a flat dome; picker fits = `scrollHeight/clientHeight` of the picker and of the sheet.

## The options (what each frame is)

- **Today**: as is.
- **Option 1** (plan's recommendation): top strip 44 px at inset + 8 (name, energy bar, one chip slot, the order dots once a round plays) replacing the plate; bottom sheet collapsed to a 72 px handle (64 px chips + 8 px clear) holding three team chips (ring = energy %, status dot, tinted disc with the initial) replacing the cards.
  - `collapsed` = during a round (picker hidden). `risen` = at the picker: sheet 34vh **total**, the chips on its top 72 px (the plan's literal "~34vh"), today's picker underneath.
  - **Option 1c** (extra data point): the handle sits **on top of** a 34vh picker (sheet 34vh + 72 px), so the picker is not squeezed.
- **Option 3** (minimal): today's layout, plate + Order on one 44 px row at inset + 112 (under the ✕ / Round row), cards and sheet untouched.
- iPad: Today / Option 1 collapsed / Option 1 risen.

## Results

### iPhone, at rest (move picker), night

| frame | option | step | band DOM (strip → handle/cards top) | band hook | band % of screen | face (hook) | face in band | eyes above handle | targets ≥44pt | stage colours (band / face rows) | picker fits | ✕ vs band | camera distance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| frame | option | step | band DOM (strip → handle/cards top) | band hook | band % of screen | face (hook) | face in band | eyes above handle | targets ≥44pt | stage colours (band / face rows) | picker fits | ✕ vs band | camera distance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| iphone-01-rest-opt1-collapsed | Option 1 (collapsed) | idle | 0.130–0.876 | 0.142–0.876 | 73.4% | 0.334–0.376 | YES | YES | YES (min 44px) | 1066 / 424 | - | overlaps band top (0.137–0.189 vs 0.142) | 44.0 |
| iphone-01-rest-opt1 | Option 1 (risen) | idle | 0.130–0.620 | 0.142–0.620 | 47.8% | 0.314–0.357 | YES | YES | YES (min 44px) | 1044 / 418 | picker 216/216px, sheet 336/321px | overlaps band top (0.137–0.189 vs 0.142) | 44.0 |
| iphone-01-rest-opt1c | Option 1c (risen) | idle | 0.130–0.536 | 0.142–0.536 | 39.4% | 0.245–0.285 | YES | YES | YES (min 44px) | 1023 / 422 | picker 216/216px, sheet 276/276px | overlaps band top (0.137–0.189 vs 0.142) | 47.8 |
| iphone-01-rest-opt3 | Option 3 | idle | 0.252–0.529 | 0.264–0.529 | 26.5% | 0.300–0.327 | YES | YES | YES (min 44px) | 957 / 376 | picker 216/216px, sheet 276/276px | outside band | 70.0 |
| iphone-01-rest-today | Today | idle | 0.366–0.529 | 0.378–0.529 | 15.1% | 0.379–0.406 | YES | YES | YES (min 44px) | 862 / 388 | picker 216/216px, sheet 276/276px | outside band | 70.0 |

### iPad, at rest (move picker), night

| frame | option | step | band DOM (strip → handle/cards top) | band hook | band % of screen | face (hook) | face in band | eyes above handle | targets ≥44pt | stage colours (band / face rows) | picker fits | ✕ vs band | camera distance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| frame | option | step | band DOM (strip → handle/cards top) | band hook | band % of screen | face (hook) | face in band | eyes above handle | targets ≥44pt | stage colours (band / face rows) | picker fits | ✕ vs band | camera distance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ipad-01-rest-opt1-collapsed | Option 1 (collapsed) | idle | 0.044–0.939 | 0.053–0.939 | 88.6% | 0.261–0.319 | YES | YES | YES (min 44px) | 1191 / 419 | - | overlaps band top (0.049–0.086 vs 0.053) | 32.1 |
| ipad-01-rest-opt1 | Option 1 (risen) | idle | 0.044–0.660 | 0.053–0.660 | 60.7% | 0.261–0.319 | YES | YES | YES (min 44px) | 1180 / 419 | picker 220/220px, sheet 306/306px | overlaps band top (0.049–0.086 vs 0.053) | 32.1 |
| ipad-01-rest-today | Today | idle | 0.194–0.586 | 0.203–0.586 | 38.3% | 0.301–0.339 | YES | YES | YES (min 44px) | 1080 / 413 | picker 220/220px, sheet 246/246px | outside band | 49.8 |

### iPhone, Option 1 during a boss beat (the hit, night)

| frame | option | step | band DOM (strip → handle/cards top) | band hook | band % of screen | face (hook) | face in band | eyes above handle | targets ≥44pt | stage colours (band / face rows) | picker fits | ✕ vs band | camera distance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| iphone-03-hit | Option 1 (collapsed) | hit@1698ms | 0.130–0.876 | 0.142–0.876 | 73.4% | 0.343–0.391 | YES | YES | YES (min 44px) | 1076 / 477 | - | overlaps band top (0.137–0.189 vs 0.142) | 42.4 |

### iPhone, Option 1 during the windup (day)

| frame | option | step | band DOM (strip → handle/cards top) | band hook | band % of screen | face (hook) | face in band | eyes above handle | targets ≥44pt | stage colours (band / face rows) | picker fits | ✕ vs band | camera distance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| iphone-02-windup-00 | Option 1 (collapsed) | effect@33ms | 0.130–0.876 | 0.142–0.876 | 73.4% | 0.373–0.412 | YES | YES | YES (min 44px) | 816 / 310 | - | overlaps band top (0.137–0.189 vs 0.142) | 43.6 |
| iphone-02-windup-01 | Option 1 (collapsed) | effect@381ms | 0.130–0.876 | 0.142–0.876 | 73.4% | 0.302–0.356 | YES | YES | YES (min 44px) | 821 / 356 | - | overlaps band top (0.137–0.189 vs 0.142) | 43.6 |


## Reading it

- **Option 1 gives the stage 73.4% of the iPhone screen when collapsed** (hook band 0.142–0.876, the plan's 0.736 within a hair), up from **15.1%** today and 26.5% for Option 3.
  The hook agrees with the DOM (0.130 vs 0.142 = the camera's +10 px margin). The face is inside the band in every frame, and the camera distance falls from 70 to 44 (inside `fogReference` 45; fogEnd 85 as the plan expects).
  The stage keeps 1000+ distinct colours (it is a scene, not a flat dome); the face rows hold 300–480.
- **Risen (picker open):** Option 1 literal = band 0.142–0.620 (**47.8%**, the plan's "0.48"); Option 1c = 0.142–0.536 (**39.4%**); Option 3 and Today keep 26.5% / 15.1% because their picker never moved.
  In Option 1 literal the picker itself fits (216/216 px) but the **sheet scrolls by 15 px** (336 in 321), and today's picker still carries its own three team cards ("Puddlepuff / Picking… / Next"), duplicating the chips right above it: the real PR should drop that row from the picker.
- **iPad (820×1180, no insets):** collapsed 88.6%, risen 60.7% (today 38.3%); the strip and chips are small on a wide screen (strip capped at 560 px, chips 56 px).
- **Targets:** every chip (56×56), picker button, Go and ✕ measured ≥ 44 px.

## Findings the owner should know before choosing

1. **The ⏳ "Winding up…" chip does not fit the strip at 393 px.** With name + bar + chip + order dots in one 44 px row the chip is clipped to "⏳ Winding" under the Order pill (windup frames above). The real strip needs a shorter chip ("⏳" alone, or the Order dots dropping the label/turn pill) or the bar must shrink.
2. **The ✕ (and the "Round" chip, hidden in Option 1) sit at inset + 58, i.e. they now overlap the top 5 px of the stage band** (✕ 0.137–0.189 vs band top 0.142) and float over the stage's top-right corner. The ✕ is a 44 px target so it cannot shrink; moving it into the strip row would cost chip-slot width.
3. **Option 3's gain is real but small** (15.1% → 26.5%; face still fits at distance 70): it keeps today's cards, so the cards-fade hack (#868) would stay.

## Overrides used (verbatim)

`overrides/overrides.css`:

```css
/* #190 M0 capture-time overrides. Injected with page.addStyleTag after the fight is up; no app code changes.
   Gated by <html data-var="opt1|opt1c|opt3"> and <html data-cap="collapsed|risen"> (set by sync.js). */

/* ── shared: the one-row top strip (Option 1 and Option 3) ───────────────── */
html[data-var] .boss-head {
  right: calc(env(safe-area-inset-right) + 12px) !important;
  left: var(--cap-strip-left, calc(env(safe-area-inset-left) + 12px)) !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 6px !important;
  height: 44px;
  max-width: 560px !important;
  margin: 0 auto !important;
}
html[data-var] .boss-plate {
  box-sizing: border-box;
  flex: 1 1 auto;
  flex-direction: row !important;
  align-items: center;
  gap: 8px !important;
  min-width: 0;
  width: auto !important;
  height: 44px;
  padding: 0 12px !important;
  border-radius: 22px !important;
}
html[data-var] .boss-plate-row:first-child { flex: 0 0 auto; }
html[data-var] .boss-name { overflow: visible; text-overflow: clip; }
html[data-var] .boss-plate .battle-energy { flex: 1 1 0; width: auto !important; min-width: 40px; height: 12px !important; }
html[data-var] .boss-plate-chips { flex-wrap: nowrap !important; flex: 0 0 auto; }
/* one chip slot: only the ⏳ chip; the level, stomps, tries and until chips leave the strip */
html[data-var] .boss-level,
html[data-var] .boss-chip-gold,
html[data-var] .boss-chip-try,
html[data-var] .boss-chip-until,
html[data-var] .boss-order-label { display: none !important; }
html[data-var] .boss-order {
  box-sizing: border-box;
  flex: 0 0 auto;
  height: 44px;
  padding: 0 12px !important;
  border-radius: 22px !important;
}

/* ── Option 1: strip at inset + 8, full width (the ✕ and Round sit at inset + 58, below it) ── */
html[data-var='opt1'] .boss-head,
html[data-var='opt1c'] .boss-head { top: calc(env(safe-area-inset-top) + 8px) !important; }
html[data-var='opt1'] .boss-round,
html[data-var='opt1c'] .boss-round { display: none !important; }

/* ── Option 3: today's layout, only the top block on one row (below the ✕ / Round row) ── */
html[data-var='opt3'] .boss-head { top: calc(env(safe-area-inset-top) + 112px) !important; }

/* ── Option 1: team chips in the handle (replaces .boss-friends) ──────────── */
html[data-var='opt1'] .boss-friends,
html[data-var='opt1c'] .boss-friends {
  right: 0 !important;
  bottom: calc(env(safe-area-inset-bottom)) !important;
  left: 0 !important;
  display: flex !important;
  flex-direction: row !important;
  align-items: flex-end;
  justify-content: center !important;
  gap: 28px !important;
  box-sizing: border-box;
  height: 72px !important;
  max-width: none !important;
  margin: 0 !important;
  padding-bottom: 4px;
  z-index: 3;
  pointer-events: auto;
}
html[data-var='opt1'][data-cap='risen'] .boss-friends {
  /* the chips ride the top 72 px of the 34vh sheet (the plan's literal reading) */
  bottom: calc(34vh + env(safe-area-inset-bottom) - 72px) !important;
}
html[data-var='opt1c'][data-cap='risen'] .boss-friends {
  /* the handle sits on top of a 34vh picker */
  bottom: calc(34vh + env(safe-area-inset-bottom)) !important;
}
html[data-var='opt1'] .boss-friends-placed,
html[data-var='opt1c'] .boss-friends-placed { height: 72px !important; }
html[data-var='opt1'] .boss-friend,
html[data-var='opt1c'] .boss-friend,
html[data-var='opt1'] .boss-friends-placed > .boss-friend,
html[data-var='opt1c'] .boss-friends-placed > .boss-friend {
  --pct: 100;
  --tint: #ffe2ee;
  position: relative !important;
  left: auto !important;
  box-sizing: border-box;
  flex: 0 0 56px !important;
  align-items: center;
  justify-content: center;
  width: 56px !important;
  height: 56px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 50% !important;
  background: conic-gradient(#6fcf8a calc(var(--pct) * 1%), rgb(255 255 255 / 70%) 0) !important;
  transform: none !important;
}
html[data-var='opt1'] .boss-friend-tint-1, html[data-var='opt1c'] .boss-friend-tint-1 { --tint: #fff0b8; }
html[data-var='opt1'] .boss-friend-tint-2, html[data-var='opt1c'] .boss-friend-tint-2 { --tint: #d9f2d0; }
/* the portrait disc inside the ring (today's cards carry no portrait: a tinted disc with the initial) */
html[data-var='opt1'] .boss-friend::before,
html[data-var='opt1c'] .boss-friend::before {
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: var(--tint);
  content: '';
}
/* status dot */
html[data-var='opt1'] .boss-friend::after,
html[data-var='opt1c'] .boss-friend::after {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 14px;
  height: 14px;
  border: 2px solid #fffaf1;
  border-radius: 50%;
  background: #6fcf8a;
  content: '';
}
html[data-var='opt1'] .boss-friend-down::after, html[data-var='opt1c'] .boss-friend-down::after { background: #b9b0bd; }
html[data-var='opt1'] .boss-friend .battle-energy, html[data-var='opt1c'] .boss-friend .battle-energy { display: none !important; }
html[data-var='opt1'] .boss-friend-name, html[data-var='opt1c'] .boss-friend-name {
  position: relative;
  z-index: 1;
  display: block;
  font-size: 0;
}
html[data-var='opt1'] .boss-friend-name::first-letter, html[data-var='opt1c'] .boss-friend-name::first-letter { font-size: 22px; }

/* ── Option 1: the sheet. Collapsed = a 72 px handle (64 + 8 clear above it) holding the chips ── */
html[data-var='opt1'][data-cap='collapsed'] .battle-sheet,
html[data-var='opt1c'][data-cap='collapsed'] .battle-sheet {
  max-height: calc(72px + env(safe-area-inset-bottom)) !important;
  min-height: calc(72px + env(safe-area-inset-bottom)) !important;
  overflow: hidden !important;
  padding: 0 !important;
}
html[data-var='opt1'][data-cap='collapsed'] .battle-sheet > *,
html[data-var='opt1c'][data-cap='collapsed'] .battle-sheet > * { display: none !important; }
/* Risen: today's picker in a 34vh sheet; the top 72 px are the chips' zone */
html[data-var='opt1'][data-cap='risen'] .battle-sheet {
  --battle-sheet-vh: 34;
  padding-top: 72px !important;
}
html[data-var='opt1c'][data-cap='risen'] .battle-sheet {
  --battle-sheet-vh: 34;
  max-height: calc(34vh + env(safe-area-inset-bottom)) !important;
}
```

`overrides/sync.js` (sets `data-cap` from picker visibility; mirrors each card's energy % onto the chip ring as `--pct`):

```js
/* Capture-time DOM sync (no app code touched): sets data-cap on <html> from the picker's visibility
   (window.__capForce = 'collapsed' pins it) and mirrors each team card's energy % onto the chip ring as --pct. */
(() => {
  if (window.__capSync) return;
  window.__capSync = setInterval(() => {
    const picker = document.querySelector('.boss-picker');
    const open = picker && !picker.hidden;
    document.documentElement.dataset.cap = window.__capForce === 'collapsed' ? 'collapsed' : open ? 'risen' : 'collapsed';
    for (const f of document.querySelectorAll('.boss-friend')) {
      const b = f.querySelector('.battle-energy');
      const v = b && b.getAttribute('aria-valuenow');
      if (v !== null && v !== undefined) f.style.setProperty('--pct', String(v));
    }
  }, 50);
})();
```

## Missing (honest list)

- **No Today / Option 3 windup or hit frames.** Rest frames are the only like-for-like comparison; the windup (day, 2 frames) and hit (night, 1 frame) are Option 1 only. The night windup did not occur in 7 rounds (hit caught), the day run caught it but its loop then failed on a later poll after the frames were saved.
- **Option 3 and Option 1c were not shot during a boss beat** (rest only). **No iPad** windup, hit, Option 1c or Option 3.
- **Camera pitch is today's 11°** in every frame; no pitch-4° frame (that is PR 2's captures, outside what this lane was told).
- **Chips are a mock:** the cards carry no portrait art, so the chip face is a tinted disc with the initial ("P" for Puddlepuff); the ring is a CSS conic-gradient fed by the card's energy bar value; the status dot only shows green / grey (tuckered). Real status icons were not mocked.
- **Callouts** ("Winding up!", "Just a little boop.") are today's `.boss-callout` stickers at their old place; the plan's "fixed slot near the boss" was not mocked. The tries chip, stomps chip, level and "here until" chips are hidden, not relocated (the plan moves tries to the entrance and result).
- **Strip energy bar:** at rest the bar's fill reads short in the strip frames while Today shows it full at the same instant; the fill width comes from the app's own `aria-valuenow`/inline width and was not chased down (not claimed as an override-free bar).
- **Risen sheet** was not hand-tuned (no handle drag affordance, no active-chip lift); the sheet's 15 px scroll in Option 1 literal is as measured.
- Only the **notched iPhone** inset set (59/34) was used; other iPhones' insets, landscape and a real device were not measured. Software GL (SwiftShader), so no frame-time claims.
- Day frames: only the two windup frames; rest frames are night only.
