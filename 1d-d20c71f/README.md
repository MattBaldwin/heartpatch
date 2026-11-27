# #37 1d captures: the advent calendar sheet (client `d20c71f`)

Real server on a December clock (`HP_DEV_NOW` 2026-12-05T05:30Z), the real sheet, high tier, DPR 2, no dev HUD, chromium + SwiftShader.
iPhone 393x852 with safe-area insets top 59 / bottom 34 (night = America/Sao_Paulo, day = Asia/Bangkok), iPad 820x1180 (night).
A fresh Keeper, so Day 5 is today and Days 1-4 can be caught up.

| frame | shows |
|---|---|
| 00-entry | the Presents row in the My Home tray, with its badge |
| 01-sheet-today-catchup | today (plum, gold ring, "Today"), catch-up days (gold, "Catch up"), wrapped locked days, 24 fireworks / 25 star |
| 02-locked-tapped | a locked day tapped: kind note, nothing sent to the server |
| 03-reveal-today | the reveal after opening today's |
| 04-today-opened | Day 5 opened (mint, tick), "come back tomorrow" |
| 05-catchup-picked | a missed day picked, the button names it |
| 06-reveal-catchup | the reveal for the missed day |
| 07-catchup-used | opened + missed + locked days, catch-up used (no button, a kind line) |

The `.json` sidecars hold the day states, sheet rect, 44 pt tap-target minimum and any text under 14 px (none).
