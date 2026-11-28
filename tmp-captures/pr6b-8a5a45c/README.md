# #190 PR 6b captures, branch issue-190-pr6b-camera-hud at 8a5a45c

Temporary: committed on the PR branch because this lane may not push to `captures-190-boss-hud`; deleted in the next commit (the squash merge drops it).

Chromium + SwiftShader, DPR 2, `?battle-clock=manual`, day (Asia/Dubai). iPhone 393×852 with CDP safe-area insets 59/34; iPad 820×1180.
The boss fight is boss-stub.ts's three-squishy stand-in (Puddlepuff ×3 against a Puddlepuff boss). Spec: `zz-capture-190.spec.ts.txt` (CAPTURE_DEVICE, CAPTURE_PART = sig | flinch | win | loss).
Each PNG has a `.json` sidecar: `battle.framing` gives the band, the boss `face` (eyes-and-mouth box; `bottom` is the mouth), each friend's `team` box with `head` (its top, tuft included), and `rise` (world units the camera rose to clear the mouth, max 3).

- `before-iphone-day/`: main at cafb6f3 (copied from captures-190-boss-hud `pr6b-b678858/`; main's battle code is unchanged since). Frames 00–04b as below, no 02b.
- `iphone-day-sig/` (after): 00 rest (picker up), 01 leaf pile (windup), 01a "3!", 01b leaf burst (landing hit), 02 shout, 02b Flinched!, 03 backup call, 03b backup flash, 04 drift, 04b drift hit.
- `iphone-day-win/`: 00 rest, 05 tuckered, 07 ask (warmth 0/4), 07b not yet, 08 joining (dim + sparkles), 08b joined.
- `iphone-day-loss/`: 00 rest, 06 loss twirl, 06b twirl later, 06c loss card.
- `ipad-day-flinch/`: 00 rest, 02 shout, 02b Flinched! (5e).
- `ipad-day-sig/`: 00–04 as iPhone (no 04b drift hit: the run hit its 2 h limit).
- `ipad-day-win/`: 00 rest, 05 tuckered, 07 ask 0/4 (the run failed at the not-yet text check, so no not-yet/joined on iPad).
- `ipad-day-loss/`: 00 rest, 06 loss twirl, 06b, 06c loss card.

What to look at:
- 5a boss faces the team: every after frame except the loss twirl (the taunt turns it on purpose).
- 5b mouth: clear at rest, windup, 3!, shout, Flinched!, backup and the end beats. Still partly covered in 01b leaf burst, 04 drift and 04b drift hit, where the boss closes in on the row: the rise is at its 3-unit cap and the depth gap is too small for a rise to separate them.
- 5c end friends: leaf burst / drift hit left friend (knocked back, rolled over) at the left edge.
- 5d sun: low at the left, clear of the name bar (a cloud now shows near the bar in some frames: the camera rises).
- 5e Flinched!: above the caption pill on iPhone and iPad (`ipad-day-flinch/ipad-02b-flinched-day.png`). A "Flinched!" left over in later iPhone frames is a capture artefact (the 1100 ms sticker hide is disabled so slow frames keep it).
- Night: not shot (time ran out).
