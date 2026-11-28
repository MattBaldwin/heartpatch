# #37 X3 captures round 3: Snowbundle and Bundlebit at 9566b17

Branch `issue-37-x3-snowbundle` at `9566b17`. **This is the final look at 9566b17**: Snowbundle has a sleepy face, a deeper ice-blue body,
a cranberry band with gold crown points; Bundlebit has a gold bead. Same recipe and spec as round 2 (`x3-8941a17/`).
Quality tier **high** (`?tier=high`, pinned) in every frame, named in each filename. Chromium + SwiftShader, DPR 2, dev stats badge and
gallery control panel hidden by CSS. 16 frames.

- **iphone**: 393x852, isMobile, hasTouch, CDP safe-area top 59 / bottom 34. **ipad**: 820x1180.
- Server env: `HP_DEV_SQUISHY_GRANTS=true HP_MINI_BOSSES=on HP_SIGNUP_CODE=heartpatch-dev-family`, fresh DB `heartpatch_x3cap` (migrated).
  Night: `HP_DEV_NOW=2026-12-25T01:00:00Z`; day: `HP_DEV_NOW=2026-12-25T12:00:00Z` (server restarted between). Browser `timezoneId` America/Sao_Paulo
  (night = Dec 24 22:00 patch-local, day = Dec 25 09:00). Team set to Lv 20 with SQL in the capture DB.
- How shot: servers started by hand (not the Playwright webServer); `playwright.capture.config.ts.txt` + `zz-capture-x3.spec.ts.txt`
  (fight spec: real Christmas Eve boss visit, tap the boss, Fight; gallery shots come from `CAPTURE_SHOTS` JSON).
  Environment note: port 3000 was held by another dev server, so the capture API server ran on port 3100 with the vite proxy repointed
  there (local uncommitted tweak, no effect on the render).

## Frames (per device `iphone-` / `ipad-`)
- `gallery-row-high.png`: `look=snowbundle,bundlebit,papa-brrr&row&tier=high` (default angle).
- `gallery-row-pitch12-high.png`: same plus `pitch=12&distance=18` on ipad; **`distance=22` on iphone** so Papa Brrr is not cropped at the right edge.
- `gallery-snowbundle-whole-high.png`, `gallery-bundlebit-whole-high.png`: `look=<id>&row&tier=high&pitch=12&distance=10` (whole-figure row fallback, as in round 2).
- `day-01-fight-high.png`, `night-01-fight-high.png`: real Christmas Eve fight, move picker up after the entrance, +3 s.
- `day-02-fight-after-pick-high.png`, `night-02-fight-after-pick-high.png`: first squishy's first move picked, +3.5 s later.

## Render check
Not done by the capturing session (another agent does it). Each frame was only verified to be written and non-blank.
