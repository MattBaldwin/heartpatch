# #37 XM: Jolly Elf Costume, re-shoot after supervisor 55's render check

Costume data at `03cf4e22` on `issue-37-christmas-milestones`. Dev Keeper gallery
(`/keepers.html?base=<base>&wear=jolly-elf-costume&view=closeup&quality=high`),
headless Chromium (SwiftShader), 2x, HUD hidden, cropped 300x330 css px to the Keeper.
Bases pip, clover, rowan, maple. Views: front (yaw 0), three-quarter (yaw 35),
back (yaw 180, lean 0), eye-level (yaw 15, lean 55). `contact-sheet.png`: rows = bases, columns = views.

Fixes against the six notes:
1. Shoulders: sweater and collar widened, shoulder caps dropped (24-piece cap), no base shirt shows.
2. Skirt: taller, narrower cone tucked under the belt, rim within ~20% of sweater width.
3. Back: red bow with gold knot on the skirt; the hat tip is its own cone bent 128 degrees so it hangs; back view shot at lean -40 so the camera sees the back, not the hat top.
4. Sparkle: bulbs 80% bigger in brighter colours, plus a glowing pompom (data flags only; part kit unchanged).
5. Camera: framing pulled out so the drooping pompom is inside the frame on all four bases.
6. "Big goals, each with a prize!" overlap: lives in the shared Milestones screen, not this lane; see PR Coordinator notes.

Piece count stays at the 24 cap (-2 shoulder caps, -1 leg stripe, +2 bow, +1 hat tip).
The three `milestones-*` PNGs are unchanged from `xm-4b2ce77/` (data for the card did not change).
