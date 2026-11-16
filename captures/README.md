# #234 boss follow-ups: mini-boss captures (real server)

Fights against real mini-bosses from `packages/shared/src/data/server/boss-species.ts`, served by the real Fastify server. No route stubs. These captures still need the coordinator's render-check.

| File | Device | Shows | Boss |
| --- | --- | --- | --- |
| `iphone-01-rest.png` | iPhone | Arena at rest, round 1, picking | Rakelet |
| `iphone-02-windup-chip.png` | iPhone | Boss plate's "⏳ Winding up…" chip while picking (round 5), last in the chip row | Rakelet |
| `iphone-03-windup.png` | iPhone | "Winding up!" sticker, power-up near its top, face showing | Rakelet |
| `iphone-03b-windup-peak.png` | iPhone | Same power-up at its highest point (boss turned away mid-jiggle) | Rakelet |
| `iphone-03c-windup-start.png` | iPhone | Same power-up, first frame (sticker popping in) | Rakelet |
| `iphone-04-landing.png` | iPhone | "Here it comes!" (Count to Three lands) | Rakelet |
| `iphone-05-flinch.png` | iPhone | "Flinched!" on a Puddlepuff after Full Name Shout | Mommentum |
| `iphone-06-backup.png` | iPhone | Log line "Backup! Mama Bear Charge!" (Ask Your Mother's assist) | Papa Brrr |
| `iphone-07-fired-up.png` | iPhone | "Fired up! 🔥" (Mama Bear Charge, Mommentum at low energy) | Mommentum |
| `ipad-01-rest.png` | iPad | Arena at rest, round 1, picking | Rakelet |
| `ipad-03-windup.png` | iPad | "Winding up!" sticker, power-up near its top, face showing | Rakelet |
| `ipad-03b-windup-peak.png` | iPad | Same power-up at its highest point (boss turned away) | Rakelet |
| `ipad-04-landing.png` | iPad | "Here it comes!" (Count to Three lands) | Rakelet |

Windup framing: re-shot on `6ce0e62` (the ⏳ chip now keeps its slot and sits last in the plate's chip row, so the boss head is one height at rest and mid-round). The rest and windup frames (`*-01-rest`, `iphone-02-windup-chip`, `*-03-windup`, `*-03b-windup-peak`, `iphone-03c-windup-start`) are from this re-shoot; the other five are unchanged. `ipad-02-windup-chip.png` is removed rather than left stale: its re-shoot needs a second fight, and the spec stalled twice on the reload between fights (waiting on the lobby's "Visit patch"). `ipad-03-windup.png` and `ipad-03b-windup-peak.png` show the iPad plate with the ⏳ chip last in its one chip row. In every windup frame (16 on each device) the boss's head stays below the turn-order strip (`[data-testid=boss-order]`).

Clearance at the highest point of the power-up, CSS px from the strip's bottom edge:

| Device | Strip box (CSS y) | Head top (hair tips) | Eyes (top) |
| --- | --- | --- | --- |
| iPhone 393×852 | 231 to 265 | 293, **28 px** clear | 310, **45 px** clear |
| iPad 820×1180 | 207 to 241 | 293.5, **52 px** clear | the face is well clear |

Before `6ce0e62` the iPhone head cleared the strip by about 5 px (the ⏳ chip wrapped the chip row mid-round and grew the head). Measured from the PNGs: the topmost boss pixel row (differs from that row's background) and the topmost dark (eye) pixel row inside the boss's columns, at DPR 2. At rest the plate keeps an empty row for the hidden ⏳ chip on iPhone (round-1 non-blocker 3, a coordinator carry-over).

## How they were shot

- Chromium `/opt/pw-browsers/chromium`, flags `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. Playwright projects `iphone-chromium` and `ipad-chromium` (`PW_CHROMIUM_EXECUTABLE`), `--workers=1 --trace off`.
- Set-up runs at the project's viewport, with `deviceScaleFactor` 2. Once the fight is on screen, `setViewportSize` switches to iPhone 393×852 CSS (786×1704 px) or iPad 820×1180 CSS (1640×2360 px).
- Quality tier `?tier=high`. The dev HUD is hidden with `.dev-status { display: none }` (the app has no HUD toggle).
- Server env: `HP_MINI_BOSSES=testers`, `HP_MINI_BOSSES_TESTERS=<the spec's account names>` (a comma-separated list of `cap_…bo` names; the spec signs up the first unused one), `HP_DEV_SQUISHY_GRANTS=true`, `HP_SIGNUP_CODE=heartpatch-dev-family`, `HP_DEV_SIGNUP_LIMIT_PER_IP=500`, `HP_DEV_MAP_CREATE_LIMIT_PER_IP=500`, `DATABASE_URL` set to a local Postgres 16. The real clock was used (no `HP_DEV_NOW`).
- No dev route starts a boss fight, so the spec uses `psql` to:
  - pin this week's visit in `boss_windows` (the chosen boss on a free meadow tile, open now)
  - set squishy levels: Partner 18 and team 30 for Rakelet and Papa Brrr (boss Lv 20), and all 12 for Mommentum's flinch run, so she's faster than the team
  - reset tries and encounters between fights
  
  The fight is entered the real way: the tile card, then "Let's go!".
- Timers: step timers are slowed 5× once the fight is on screen. During a windup, the page's clock (`performance.now`, rAF times and those timers) also drops to 1/20 speed on iPhone (1/100 on iPad), so the power-up can be shot frame by frame. A MutationObserver shoots each caption or sticker the moment it appears.

## Re-run

```sh
cp captures/zz-capture-234.spec.ts.txt apps/client/tests/e2e/zz-capture-234.spec.ts
pnpm --filter @heartpatch/shared build && pnpm db:migrate
# Start the server with the env above (`pnpm --filter @heartpatch/server dev`) and the client (`pnpm --filter @heartpatch/client dev`).
cd apps/client
PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium CAPTURE_OUT=../../captures \
  CAPTURE_DEVICE=iphone CAPTURE_BOSS=rakelet CAPTURE_FRAMES=rest,chip,windup,landing \
  npx playwright test zz-capture-234 --project iphone-chromium --workers=1 --trace off
# Other runs:
#   CAPTURE_BOSS=mommentum CAPTURE_FRAMES=flinch,firedup [CAPTURE_PARTNER_LEVEL=12 CAPTURE_TEAM_LEVEL=12]
#   CAPTURE_BOSS=papa-brrr CAPTURE_FRAMES=backup
#   CAPTURE_DEVICE=ipad --project ipad-chromium [CAPTURE_WINDUP_SCALE=0.01]
rm tests/e2e/zz-capture-234.spec.ts   # typecheck picks it up otherwise
```

The windup comes out as `<device>-03-windup-burst-NN-<ms>.png` frames. The files above are picked from those frames. Moves are random, so the spec keeps fighting, up to `CAPTURE_BUDGET_MS`, until every wanted frame shows up.
