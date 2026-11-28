# #37 X3 captures round 5: Snowbundle and Bundlebit at 1603a0b

Branch `issue-37-x3-snowbundle` at `1603a0b`. **This is the final look at 1603a0b.** The only change since f174a73 is that Bundlebit has no belly patch.
- **Gallery frames (8) are new at 1603a0b.**
- **Fight frames (8, `*-night-*` and `*-day-*`) are copied unchanged from `x3-f174a73/`.** The fight frames show only Snowbundle, which is unchanged, and the boss data is identical.

Same recipe as `x3-f174a73/`. Quality tier **high** (`?tier=high`, pinned), named in each filename. Chromium + SwiftShader, DPR 2, dev stats badge and gallery control panel hidden by CSS.

- **iphone**: 393x852, isMobile, hasTouch, CDP safe-area top 59 / bottom 34. **ipad**: 820x1180.
- Server env: `HP_DEV_SQUISHY_GRANTS=true HP_MINI_BOSSES=on HP_SIGNUP_CODE=heartpatch-dev-family`, fresh DB `heartpatch_x3cap5` (migrated), `HP_DEV_NOW=2026-12-25T12:00:00Z`. Browser `timezoneId` America/Sao_Paulo.

## Gallery frames (per device `iphone-` / `ipad-`)
- `gallery-row-high.png`: `look=snowbundle,bundlebit,papa-brrr&row&tier=high`.
- `gallery-row-pitch12-high.png`: same plus `pitch=12&distance=18` on ipad; `distance=22` on iphone (Papa Brrr not cropped).
- `gallery-snowbundle-whole-high.png`, `gallery-bundlebit-whole-high.png`: `look=<id>&row&tier=high&pitch=12&distance=10`.

## Render check
Not done by the capturing session. Each gallery frame was only verified to be written and non-blank.

## Deviations
Port 3000 was taken, so the capture API ran on port 3100 with the vite proxy repointed in a throwaway worktree. Extra env `HP_SIGNUP_CODE`, `HP_DEV_SIGNUP_LIMIT_PER_IP=500`, `HP_DEV_MAP_CREATE_LIMIT_PER_IP=500`. System Chrome via `PW_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome`. Fight frames were not re-shot (copied). The spec's DB name was changed to `heartpatch_x3cap5`.
