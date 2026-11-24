# #234 boss framing: before / after (PR #867)

Real Rakelet fight (`HP_MINI_BOSSES=testers`, dev squishy grants), Chromium + SwiftShader, tier high, dev HUD hidden.
**before** = `origin/main` `50ccdec`; **after** = PR head `7b034bc`. Same server, same fight setup, one fight per file set.
iPhone: 393x852 at DPR 2, safe-area insets top 59 / bottom 34 (CDP `Emulation.setSafeAreaInsetsOverride`), viewport set before the scene was built. Night = timezone America/New_York (~00:00 local), day = Asia/Tokyo (~14:00 local).
Steps: `rest` = fight start, boss at rest; `r1-play` = round 1 playback ~2.5 s after Go (boss windup/first hit); `r2-play` = round 2 playback ~1.5 s after Go; `result` = result screen.

## Measurements (pixel script on the PNGs, not eyeballed)
Stage band = iPhone CSS y 330-445 (below the HUD plate + Order strip, above the team cards); iPad y 260-600. "Non-sky" = pixels that differ >28 from their row's median colour (sky is a vertical gradient). Colours counted at RGB>>4. `distance`/`fogEnd` come from the dev hook `scene.framing`, which exists only on the PR (n/a on main; the triage lane measured 144-162 there).

| file | distance | fogEnd | stage colours | non-sky fraction | non-sky (lower half) | verdict |
|---|---|---|---|---|---|---|
| after-iphone-day-r1-play.png | 70 | 115 | 413 | 0.155 | 0.085 | visible |
| after-iphone-day-r2-play.png | 70 | 115 | 426 | 0.178 | 0.091 | visible |
| after-iphone-day-rest.png | 70 | 115 | 419 | 0.180 | 0.093 | visible |
| after-iphone-day-result.png | 65.1 | 110.1 | 383 | 0.198 | 0.085 | visible |
| after-iphone-night-r1-play.png | 69.4 | 109.4 | 712 | 0.306 | 0.369 | visible |
| after-iphone-night-r2-play.png | 68.5 | 108.5 | 479 | 0.229 | 0.142 | visible |
| after-iphone-night-rest.png | 70 | 110 | 515 | 0.220 | 0.132 | visible |
| after-iphone-night-result.png | 65.1 | 105.1 | 461 | 0.290 | 0.138 | visible |
| before-ipad-night-r1-play.png | n/a | n/a | 1044 | 0.158 | 0.212 | visible |
| before-ipad-night-r2-play.png | n/a | n/a | 1060 | 0.163 | 0.224 | visible |
| before-ipad-night-rest.png | n/a | n/a | 1038 | 0.165 | 0.233 | visible |
| before-ipad-night-result.png | n/a | n/a | 1127 | 0.239 | 0.357 | visible |
| before-iphone-day-r1-play.png | n/a | n/a | 6 | 0.000 | 0.000 | blank |
| before-iphone-day-r2-play.png | n/a | n/a | 46 | 0.004 | 0.000 | partial |
| before-iphone-day-rest.png | n/a | n/a | 4 | 0.000 | 0.000 | blank |
| before-iphone-day-result.png | n/a | n/a | 253 | 0.178 | 0.012 | visible |
| before-iphone-night-r1-play.png | n/a | n/a | 2 | 0.000 | 0.000 | blank |
| before-iphone-night-r2-play.png | n/a | n/a | 32 | 0.004 | 0.000 | partial |
| before-iphone-night-rest.png | n/a | n/a | 1 | 0.000 | 0.000 | blank |
| before-iphone-night-result.png | n/a | n/a | 318 | 0.149 | 0.033 | visible |

## Reading it
- **iPhone before:** rest and round-1 frames are blank (1-6 colours, 0.000 non-sky) at night and by day; round 2 is near blank. The result screen draws a scene (nearer camera), as the lane noted.
- **iPhone after:** every frame draws the arena, team and boss (380-710 colours, 0.15-0.31 non-sky), distance capped at 70, fog moved back (110 night / 115 day).
- The boss's head sits under the plate on the notched iPhone: the known #868 trade-off, not a failure here.
- **Not measured:** boss/team bounding boxes (colour clustering was unreliable against the HUD cards; look at the PNGs). The "after" iPad set was **not shot** (context cap; an attempt ran against the wrong client and was discarded). The iPad "before" frames are main's iPad at 820x1180 with no insets and DPR 2, downscaled to 60% for size. The band for iPad is a fixed guess, so its verdicts say nothing about the fix.
- Capture spec: derived from `captures/zz-capture-234.spec.ts.txt` on `captures-234-boss-followups`; not committed.
