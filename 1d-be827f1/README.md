# #37 1d captures: the advent calendar sheet (client `be827f1`)

Real server on a December clock (`HP_DEV_NOW` 2026-12-05T05:30Z), the real sheet, high tier, DPR 2, no dev HUD, chromium + SwiftShader.
iPhone 393x852 with safe-area insets top 59 / bottom 34 (night = America/Sao_Paulo, day = Asia/Bangkok), iPad 820x1180 (night).
A fresh Keeper: Day 5 is today, Days 1-4 can be caught up.

Frames: 00-entry (Presents row + badge in My Home) · 01 sheet (today, catch-up, wrapped, 24 fireworks, 25 star) · 02 a locked day tapped (note in its own one-line slot: the sheet keeps its top and size) · 03 reveal after opening today's · 04 today opened · 05 missed day picked · 06 reveal of the missed day · 07 catch-up used (opened + missed + wrapped).
Legend now has Opened / Today / Catch up / Missed / Wrapped · not yet.

Measured per frame in the page (sidecar `.json`): sheet top-bottom in CSS px (iPhone bottom 806 = 852-34-12; the HUD ends about 115), scroll overflow, smallest tap target (CSS px), text runs under 14 px, lowest text contrast against its solid background (WCAG, text on gradient boxes is on white tags), runs under 4.5:1.

| frame | sheet top-bottom | scroll overflow px | min target px | text < 14 px | min contrast | runs < 4.5:1 |
|---|---|---|---|---|---|---|
| ipad-night-01-sheet-today-catchup | 265-915 | 0 | 44 | 0 | 4.95 | 0 |
| ipad-night-02-locked-tapped | 265-915 | 0 | 44 | 0 | 4.95 | 0 |
| ipad-night-03-reveal-today | 404-776 | 0 | 44 | 0 | 4.95 | 0 |
| ipad-night-04-today-opened | 304-876 | 0 | 44 | 0 | 4.95 | 0 |
| ipad-night-05-catchup-picked | 304-876 | 0 | 44 | 0 | 4.95 | 0 |
| ipad-night-06-reveal-catchup | 382-798 | 0 | 44 | 0 | 4.95 | 0 |
| ipad-night-07-catchup-used | 315-865 | 0 | 44 | 0 | 5.53 | 0 |
| iphone-day-01-sheet-today-catchup | 130-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-day-02-locked-tapped | 130-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-day-03-reveal-today | 390-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-day-04-today-opened | 226-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-day-05-catchup-picked | 226-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-day-06-reveal-catchup | 434-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-day-07-catchup-used | 255-806 | 0 | 44 | 0 | 5.53 | 0 |
| iphone-night-01-sheet-today-catchup | 130-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-night-02-locked-tapped | 130-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-night-03-reveal-today | 434-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-night-04-today-opened | 226-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-night-05-catchup-picked | 226-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-night-06-reveal-catchup | 434-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-night-07-catchup-used | 255-806 | 0 | 44 | 0 | 5.53 | 0 |
