# #37 X3 captures: Snowbundle and Bundlebit at d4b73e4

Branch `issue-37-x3-snowbundle` at `d4b73e4`. Quality tier **high** (`?tier=high`, pinned, governor off) in every frame,
named in each filename. Chromium + SwiftShader (`--use-gl=angle --use-angle=swiftshader`), DPR 2, dev stats badge and the
gallery's control panel hidden by CSS. Source: `zz-capture-x3.spec.ts.txt` (temporary Playwright spec, not committed to the branch).

- **iphone**: 393x852, isMobile, hasTouch, CDP `Emulation.setSafeAreaInsetsOverride` top 59 / bottom 34. **ipad**: 820x1180.
- Server env: `HP_DEV_SQUISHY_GRANTS=true HP_MINI_BOSSES=on`, fresh DB, `HP_DEV_NOW` below. Browser `timezoneId` America/Sao_Paulo
  (UTC-3, so the patch's zone is too). Players signed up in the UI, Partner and team set to Lv 20 with SQL in the capture DB.

## Frames

Gallery (`/gallery.html?bosses&...`, signed in on the same host):
- `{iphone,ipad}-gallery-row-high.png`: `look=snowbundle,bundlebit,papa-brrr&row&tier=high`. The gallery keeps roster order, so the row is Snowbundle (left), Bundlebit (middle), Papa Brrr (right).
- `{iphone,ipad}-gallery-row-lowangle-high.png`: same plus `pitch=15&distance=22`, so the faces are not under the caps.
- `{iphone,ipad}-gallery-closeup-snowbundle-high.png`, `...-closeup-bundlebit-high.png`: `view=closeup`, one look each.

Real Christmas Eve fight (the natural Eve visit, kind `christmas-eve`, no dev route; boss Snowbundle, Keeper level gate 5 met; battle screen with the move picker up, after the entrance):
- `{iphone,ipad}-fight-night-high.png`: `HP_DEV_NOW=2026-12-25T01:00:00Z` = Dec 24 22:00 patch-local.
- `{iphone,ipad}-fight-day-high.png`: `HP_DEV_NOW=2026-12-25T12:00:00Z` = Dec 25 09:00 patch-local (server restarted between).
- `{iphone,ipad}-bosscard-{night,day}-high.png`: the map's boss tile card just before "Let's go!".

## Render check

The brief called for a read-only helper agent, but the Agent tool was not available in this session, so the capturing session looked at every frame itself. Verdict: **PASS on the captures** (no HUD or stats badge, sharp at DPR 2, boss and face visible in both fights, tier named), with design observations only (not changed):
- Snowbundle is not clearly bigger than Papa Brrr in the gallery row (it is the smaller figure at the left); in the fight it reads as a round heap with arms out. It looks like one rounded body with a belly patch more than two clear tiers.
- The gold part shows as a thin scalloped gold trim under the cap, very small; blush is faint behind the eyes at distance.
- At the default gallery angle the cap hides Papa Brrr's face (hence the low-angle shots); at night the cap and rim glow iridescent.
- Bundlebit reads well: small, round, cranberry cap, gold bead, eyes, blush, smile.
