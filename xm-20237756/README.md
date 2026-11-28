# #37 XM: Jolly Elf Costume, re-shoot after supervisor 55's render check

Costume data at `20237756` on `issue-37-christmas-milestones`. Dev Keeper gallery
(`/keepers.html?base=<base>&wear=jolly-elf-costume&view=closeup&quality=high`), headless
Chromium (SwiftShader), 2x, HUD hidden, cropped 300x330 css px to the Keeper.
Bases pip, clover, rowan, maple. Views: front (yaw 0), three-quarter (yaw 35), back (yaw 180,
lean -40 so the camera sees the back and not the hat top), eye-level (yaw 15, lean 55).
`contact-sheet.png`: rows = bases, columns = views.

Fixes against the six notes:
1. Shoulders: sweater and collar widened, shoulder caps dropped (24-piece cap); no base shirt shows.
2. Skirt: taller, narrower cone tucked under the belt, rim within about 20% of the sweater width.
3. Back: a red two-loop bow with a gold knot on the skirt. The hat tip is its own narrow cone bent 135 degrees so it hangs, with the pompom on its end.
4. Sparkle: bulbs bigger and fully saturated, plus a glowing pompom (data flags only; the part kit is unchanged). The front wire arc was dropped to stay at 24 pieces.
5. Camera: framing pulled out; the pompom is whole on all four bases.
6. "Big goals, each with a prize!" overlap lives in the shared Milestones screen, not this lane (see PR Coordinator notes).

The three milestones-*.png are unchanged from xm-4b2ce77/ (the card data did not change).
Opus render-check history: round 1 ONE MORE ROUND, round 2 ONE MORE ROUND (flat bow, stiff tip, dull bulbs), round 3 see PR.
