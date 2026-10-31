# 727e capture rig (scratch, not for merge)

What's here:
- `manifest.json`: the 63 After shots for screens v2 (https://claude.ai/artifact/5MPxqMyKedhUTRWpKEBKEY), with device, tier, insets and exactly what each stub changed.
- `gen.py` + `tmpl.html`: build the review page from `shots/*.png` and the manifest. Run `python3 gen.py <sha>`; it converts the shots to JPEG in `site/v2/`.

The Playwright spec itself (`apps/client/tests/e2e/zz-after-shots.spec.ts`) was temporary and was deleted after capture, as the lane brief asked. To rebuild it, copy the helpers from `long-night.spec.ts` and `hollow.spec.ts`, then:
- Run with `cd apps/client && PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm exec playwright test <spec> --project=iphone-chromium`. Needs local Postgres (role/db heartpatch), `.env` from `.env.example`, `pnpm db:migrate` and `pnpm build`.
- Real flows: `POST /maps/:id/long-night {weekday}` (today+2, or today), `POST /maps/:id/dev/nightfall`, a second Keeper by invite for the greyed chooser, and claimed land with no fire for "Light my land" and the tile line.
- Stubs use `page.route` on `GET /maps/:id/hollow`: `route.fetch()`, then edit the JSON. For the Gap: an open `longNight.gap`, `now` at 7:31 PM map time and `night.isNight`. For the 42-min chip: `now` = `nextAt` − 42 min. For the night chip: `now` 10 min after nightfall. Stub `GET /maps/:id/stats` with `keeperOfTheNight` for the crown. For a not-held reveal, use the localStorage key `heartpatch.long-night.result.<me>.<map>`. For the report block, clear `heartpatch.long-night.told.<user>.<map>`. For the Gap battle, answer the gap-encounter POST with the reply from `POST /maps/:id/dev/battles`, then flip the status stub to had.
- Insets: CDP `Emulation.setSafeAreaInsetsOverride` with `{top:59,bottom:34}` upright, or `{left:59,right:59,bottom:21}` sideways.
- Test ids: `night-caption`, `night-feed`, `night-show-skip`, `tray-hint` / `tray-hint-ok`, `tray-handle-*`, `long-night-chip`, `long-night-notice`, `long-night-reveal`, `long-night-gap`.
