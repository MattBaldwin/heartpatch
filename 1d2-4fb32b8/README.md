# #37 1d2 captures: open a wrapped present from the bag (client `4fb32b8`)

Real server on a December clock (`HP_DEV_NOW` 2026-12-05T05:30Z), the real sheet, high tier, DPR 2, no dev HUD, chromium + SwiftShader.
iPhone 393x852 with safe-area insets top 59 / bottom 34 (night = America/Sao_Paulo, day = Asia/Bangkok), iPad 820x1180 (night).
A fresh Keeper with 2 wrapped presents granted through the dev endpoint, page reloaded so the bag reads them. Day 5 is today, Days 1-4 can be caught up.

Frames: 01 sheet with the present button (one line of pictures for what it might hold, names in its aria-label) · 02 reveal "Your present had…" with "1 more to open" · 03 sheet with the last present · 04 reveal of the last one · 05 sheet with no present left (button gone).

Spec: `zz-capture-37-bag-present.spec.ts.txt` (throwaway, not committed to the app repo).

Measured per frame in the page (sidecar `.json`): sheet top-bottom in CSS px (iPhone bottom 806 = 852-34-12; HUD ends about 115), scroll overflow, smallest tap target, text runs under 14 px, lowest text contrast, runs under 4.5:1.

| frame | sheet top-bottom | scroll overflow px | min target px | text < 14 px | min contrast | runs < 4.5:1 |
|---|---|---|---|---|---|---|
| ipad-night-01-sheet-with-present | 264-916 | 0 | 44 | 0 | 4.95 | 0 |
| ipad-night-02-reveal-present-1-left | 409-771 | 0 | 44 | 0 | 4.95 | 0 |
| ipad-night-03-sheet-last-present | 264-916 | 0 | 44 | 0 | 4.95 | 0 |
| ipad-night-04-reveal-last-present | 409-771 | 0 | 44 | 0 | 4.95 | 0 |
| ipad-night-05-sheet-no-present | 265-915 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-day-01-sheet-with-present | 119-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-day-02-reveal-present-1-left | 444-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-day-03-sheet-last-present | 119-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-day-04-reveal-last-present | 444-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-day-05-sheet-no-present | 130-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-night-01-sheet-with-present | 119-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-night-02-reveal-present-1-left | 444-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-night-03-sheet-last-present | 119-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-night-04-reveal-last-present | 444-806 | 0 | 44 | 0 | 4.95 | 0 |
| iphone-night-05-sheet-no-present | 130-806 | 0 | 44 | 0 | 4.95 | 0 |

Notes: with a present in the bag the sheet is bottom-anchored and its top sits at 119 on iPhone (130 without), clear of the HUD. The first version of this block scrolled by 104 px with real insets (a 393x852 viewport without insets hid it); fixed with a one-line icon hint, a 44 px grid and buttons while a present is in the bag.
