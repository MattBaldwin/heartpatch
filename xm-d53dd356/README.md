# #37 XM: Jolly Elf Costume, re-shoot after supervisor 55's render check

Costume data at `d53dd356` on `issue-37-christmas-milestones`. Dev Keeper gallery
(`/keepers.html?base=<base>&wear=jolly-elf-costume&view=closeup&quality=high`),
headless Chromium (SwiftShader), 2x, HUD hidden, cropped 300x330 css px to the Keeper.
Bases pip, clover, rowan, maple. Views: front (yaw 0), three-quarter (yaw 35),
back (yaw 180, lean 0), eye-level (yaw 15, lean 55). `contact-sheet.png`: rows = bases, columns = views.

Fixes against the six notes:
1. Shoulders: sweater and collar widened, the two shoulder caps dropped (the piece cap is 24), so no base shirt shows at the collar ends or seams.
2. Skirt: cone taller and narrower at the top, so it tucks under the belt instead of a flat dish.
3. Back: a red bow with a gold knot at the belt; the hat tip is its own cone bent over (roll -108) so it really droops.
4. Sparkle: bulbs 50% bigger, and the pompom is `glow` (a data flag; the part kit is unchanged).
5. Camera: framing pulled out so the drooping pompom is inside the frame on all four bases.
6. "Big goals, each with a prize!" overlap: lives in the shared Milestones screen, not this lane; see PR Coordinator notes.

Piece count stays at the 24 cap (-2 shoulder caps, -1 leg stripe, +2 bow, +1 hat tip).
The three `milestones-*` PNGs are unchanged from `xm-4b2ce77/` (data for the card did not change).
