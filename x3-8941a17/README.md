# #37 X3 captures round 2: Snowbundle and Bundlebit at 8941a17

Branch `issue-37-x3-snowbundle` at `8941a17` (Snowbundle as a wide low snow-heap with a round head, cranberry band, gold star points).
Quality tier **high** (`?tier=high`, pinned) in every frame, named in each filename. Chromium + SwiftShader, DPR 2, dev stats badge and
gallery control panel hidden by CSS. 16 frames.

- **iphone**: 393x852, isMobile, hasTouch, CDP safe-area top 59 / bottom 34. **ipad**: 820x1180.
- Server env: `HP_DEV_SQUISHY_GRANTS=true HP_MINI_BOSSES=on HP_SIGNUP_CODE=heartpatch-dev-family`, fresh DB `heartpatch_x3cap`.
  Night: `HP_DEV_NOW=2026-12-25T01:00:00Z`; day: `HP_DEV_NOW=2026-12-25T12:00:00Z` (server restarted between). Browser `timezoneId` America/Sao_Paulo
  (night = Dec 24 22:00 patch-local, day = Dec 25 09:00). Team set to Lv 20 with SQL in the capture DB.
- Spec: `zz-capture-x3.spec.ts.txt` (gallery shots now come from `CAPTURE_SHOTS` JSON; fight spec takes a second shot after picking one move).
  `playwright.capture.config.ts.txt` is the config used (SwiftShader flags, no webServer; servers started by hand).

## Frames (per device `iphone-` / `ipad-`)
- `gallery-row-high.png`: `look=snowbundle,bundlebit,papa-brrr&row&tier=high` (default angle).
- `gallery-row-pitch12-high.png`: same plus `pitch=12&distance=18`.
- `gallery-snowbundle-whole-high.png`, `gallery-bundlebit-whole-high.png`: **fallback used**: `look=<id>&row&tier=high&pitch=12&distance=10`.
  `view=closeup` could not be widened: it still cropped the star points (tried alone and with `distance=9&pitch=12`, which just zoomed to a sphere), so I used the row fallback, which frames the whole figure.
- `day-01-fight-high.png`, `night-01-fight-high.png`: real Christmas Eve fight, move picker up after the entrance, +3 s.
- `day-02-fight-after-pick-high.png`, `night-02-fight-after-pick-high.png`: first squishy's first move picked, +3.5 s later.
- Boss-card frames dropped as requested.

## Render check
The Agent tool is **not available** in this session, so no helper was spawned and there is no helper verdict. Self-check by the capturing session
(not a helper verdict), PASS on the captures, with notes:
- Frames sharp, no HUD or stats badge, tier in filename, faces visible, Snowbundle named in the fight strip.
- Snowbundle reads as a wide low two-tier snow heap with a round head, no neck, round hand nubs, ice-blue body, white belly, cranberry band, gold star points; sleepy smile, cute. Bundlebit small and round with cranberry cap and gold bead. Both clearly differ from Papa Brrr (cap, moustache, sneakers).
- Gallery: Snowbundle is smaller than Papa Brrr (accepted).
- Notes: at the default angle (`gallery-row-high`, ipad) the top-down view hides faces under caps; iphone `gallery-row-pitch12` crops Papa Brrr at the right edge (width); the pale belly patch looks pinkish-white; at night the rim glow is iridescent.
