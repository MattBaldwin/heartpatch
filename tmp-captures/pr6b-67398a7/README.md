# #190 PR 6b captures (lane 6b-3), branch issue-190-pr6b-camera-hud at 67398a7

Temporary: committed on the PR branch like `pr6b-8a5a45c/` in e77553d, and deleted in the next commit (the squash merge drops it).

Chromium + SwiftShader, DPR 2, `?battle-clock=manual`, day (Asia/Dubai). The boss fight is boss-stub.ts's three-squishy stand-in (Puddlepuff ×3 against a Puddlepuff boss). Spec: `zz-capture-190.spec.ts.txt` (CAPTURE_DEVICE, CAPTURE_PART = sig | flinch | win | loss).

Changes to the spec since e77553d:
- **Safe areas on iPad too:** the CDP inset override now runs for both devices. iPhone gets 59 top / 34 bottom, and iPad gets **24 / 20** (a home-bar iPad).
- **Sidecar fields:** each `.json` sidecar adds `safeArea` (the `env(safe-area-inset-*)` the page resolves), `nameBar` and `endCard` (boxes as fractions of the height).
- **Flinch part:** adds `02c` (600 ms later) and a `.meshes.json` beside 02b and 02c. That file lists every mesh the battle scene drew, projected to CSS px, with thin-instance positions.
- **Win part:** checks the joining dim (`dim-check.json`). It shoots `08-joining-as-before` (timed as in e77553d), then holds the beat's CSS animations at their peak for `08-joining`.

Frames were shot at 67398a7 = f175144 + a docs-only merge of main. The review fix after it (`rollReach`: the idle sway no longer widens the fit radius) moves the phone camera a few percent at rest. It changes nothing in the HUD or the safe areas.

## Folders
- `ipad-day-flinch/` (820×1180, insets 24/20): 00 rest, 02 shout, 02b Flinched!, 02c Flinched! 600 ms later.
- `ipad-day-loss/` (insets 24/20): 00 rest, 06 loss twirl, 06b later, 06c loss card.
- `iphone-day-win/` (393×852, insets 59/34): 00 rest, 05 tuckered, 07 ask 0/4, 07b not yet, 08-joining-as-before, 08 joining (held at the dim's peak), 08b joined, plus `dim-check.json`.
- `main-ab38d7f-ipad-day-flinch/`: **main** at ab38d7f, iPad flinch part: 00 rest, 02 shout, 02b Flinched!. The mesh dump failed there (the worktree's Vite deps URL), so 02c is missing. The frames are enough.

## What to look at
1. **iPad safe areas (render-check 1):**
   - Name bar: top at 32 px in every iPad frame (`strip.top` 0.0271 × 1180), which is the 24 px inset + 8 px `--boss-strip-top`. Its chip dots are whole.
   - Bottom handle: ends at 1160 px, on the 20 px inset line.
   - Loss card (06c): bottom at 1148 px (0.9729), so 32 px above the edge: the 20 px inset + 12 px (battle.css:1729).
   - The HUD pads every edge with `env(safe-area-inset-*)`: battle.css:48–50, 277–280, 453–455, 1118–1141, 1259–1261, 1341–1372 and 1729–1731.
2. **Purple half-sphere (render-check 2) is on main too, and it isn't this PR's.** Compare `ipad-day-flinch/ipad-02b-flinched-day.png` with `main-ab38d7f-ipad-day-flinch/ipad-02b-flinched-day.png`: the same shape, in exactly the same two colours, (82,67,116) and (167,154,194).
   - **What it is:** `ipad-02b-flinched-day.meshes.json` shows `fx-puff` with 7 live instances, 6 of them at CSS (382–395, 822–825), right on the shape. That is the **droop** burst: 6 puffs, `EXTRAS.droop`, element-fx.ts:971.
   - **Why a flinch fires droop:** the flinch is an `effect` step with `squish: 'wobble'` and no `status` (battle-playback.ts:546). choreography.ts:929 defaults it to `step.status ?? 'droop'` and plays `fx(status)` (the "too dizzy or sleepy" branch).
   - **Why it looks dark and half hidden:** `EffectPool.#color` converts each fx colour to linear space (effects.ts:281), and the unlit `fx-mat` never converts it back. The pale `#d3cce0` draws as (167,154,194), which is its linear value. `#a59cb8` draws as linear (96,85,122), darkened further by the arena's contrast. The puffs spawn at 0.4 × height up and 0.3 × height toward the camera, so the head hides part of the cluster.
   - **In 02c** the puffs have dropped and spread (fx-puff at y 881–890).
   - Neither choreography.ts:929 nor effects.ts is changed by this PR. The only choreography change here is the boss `steady` flag.
3. **Joining dim (render-check 4): a capture artefact, confirmed.**
   - The dim and sparkles are CSS animations (befriend-beat.css, `--beat-ms` 1500 ms). They run on real time; only their removal waits on the battle clock.
   - `dim-check.json`: when `.befriend-dim` appears, its animation is at 0 ms (opacity 0). At the old shot time it is at 600 ms (opacity 0.69). The old `shot()` then waits another 600 ms and takes a slow software-GL screenshot, so the frame landed in the fade-out.
   - `08-joining-as-before` (mean brightness 197) shows no dim or sparkles. `08-joining`, held at 375 ms (25 %, the peak), shows both (mean 147). On a phone the battle clock is real time, so the two stay in step.
   - **Note:** at its peak the dim also covers the result card (`.befriend-beat` z-index 4). This was flagged, not changed: it's PR 6's beat (#916).
4. The **"Everyone!" sticker** left over in later frames is still the capture's disabled 1100 ms sticker hide.
