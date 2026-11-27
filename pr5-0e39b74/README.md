# #190 PR 5 (#898) at `0e39b74`: signature moments, captured

- **Build:** `190-boss-signatures` at `0e39b74`, `?tier=high&battle-clock=manual`, Chromium + SwiftShader, DPR 2, dev HUD hidden. iPhone 393×852 with the notch insets (CDP `setSafeAreaInsetsOverride` 59/34). Day is `America/Los_Angeles` (it was about 13:00 there).
- **Spec:** `zz-capture-190-pr5.spec.ts.txt`, a throwaway. To run it, copy it to `apps/client/tests/e2e/`.
  - It uses the e2e boss stub with `signatures: true`, which gives the stub's moves the four signature (effect, element) shapes.
  - It holds the battle clock and advances it exactly onto each beat.
  - Capture only: the HUD's 1.1 s sticker-hide timer is held. A SwiftShader frame takes about 1 s, so the timer would otherwise hide the sticker before the shot. This means a sticker can show carried over from the step before (for example "3!" in 01b and "Backup!" in 03b). In the game it would be gone.
- **Only iPhone day was captured.** The night and iPad passes were stopped: see "Status". The `iphone-night/` folder from an earlier run is not included.

## Measurements (sidecar JSON per frame)

| frame | at ms | live particles | draw calls | sticker | sticker box | boss face | team top |
|---|---|---|---|---|---|---|---|
| 00-rest | — | 0 | 54 | — | — | 0.435–0.487 | 0.524 |
| 01-leaf-pile | 520 | 134 | 56 | 2… | 0.151–0.202 | 0.634–0.670 | 0.695 |
| 01a-three | 200 | 19 | 57 | 3! | 0.151–0.201 | 0.620–0.654 | 0.677 |
| 01b-leaf-burst | 380 | 99 | 59 | 3! (carried) | 0.151–0.201 | facing away | 0.682 |
| 02-shout | 260 | 62 | 58 | Everyone! | 0.147–0.205 | 0.619–0.654 | 0.678 |
| 03-backup-call | 300 | 45 | 56 | Backup! | 0.148–0.204 | 0.553–0.616 | 0.676 |
| 03b-backup-flash | 110 | 39 | 58 | Backup! (carried) | 0.148–0.204 | facing away | 0.679 |
| 04-drift | 440 | 78 | 58 | Everyone! | 0.147–0.205 | 0.607–0.665 | 0.678 |
| 04b-drift-hit | 200 | 89 | 59 | Everyone! | 0.147–0.205 | 0.606–0.669 | 0.676 |

- **Draw calls:** 54 at rest and at most 59 at a beat. The extra calls are the existing pooled effect shapes switching on while they have live particles. No new meshes.
- **Particles:** the unit-tested peaks for each turn, counted from spawn, are leaf 132/150 and rings/arcs ≤ 80. The captured frames peak at 142 live.
- **Frame time:** not measurable here. SwiftShader renders in software at about 1 fps. An on-device capture is still owed.
- **Stickers:** no sticker box overlaps the boss face or any team box. The smallest gap is about 0.35 of the screen height.
- **"Everyone!":** the stub's shout and drift are copies of its area stomp, so they hit everyone and show this sticker. The real Full Name Shout hits one foe.

## Render read (helper subagent, text only): not ready for the owner

- **PASS:** 00-rest, 01a-three.
- **Hard concerns (effects):**
  - 01-leaf-pile: only about 15 of 134 leaves show. They clump on the boss's cheek and eye, inside the face box, and read red-heavy. Small red flecks on its cheek could read as marks.
  - 03-backup-call: the frost shards land on the boss's forehead, between its eyes, not on its shoulders. The shrug doesn't read.
  - 03b-backup-flash: the flash reads as a pale second sun up-left of the boss, and the halos are small and low.
- **Soft concerns (effects):**
  - 02-shout: the flare is small and the "rings" read as discs, partly behind the team.
  - 04-drift: the skid arc reads as scattered debris level with the team.
  - 04b-drift-hit: the sparks run up and behind rather than in a clear camera-side arc.
  - 01b-leaf-burst: reads as a green splat. The leaf element's ordinary impact halo dominates it.
- **From the camera or HUD, not this PR:**
  - The boss faces away in 01b and is sideways in 03b, on its own beats.
  - The middle team squishy covers the boss's mouth.
  - The left friend is cropped at the screen edge.
  - The sun sits behind the strip.

## Status

#898 is not ready to merge on looks. The code passed reviewer round 4 (APPROVE at `0e39b74`), but the effects still need a visual tuning pass (see the lane handoff on #190). The likely fixes:
- anchor the pile and the shards from the boss's real height and face box, not `at.y ± h`;
- make the backup flash a burst, not a disc;
- lift the drift arc toward the camera.
