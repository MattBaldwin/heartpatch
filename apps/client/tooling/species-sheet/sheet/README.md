# Species sheet tooling (#382)

Builds the Wave 2 species sheet: every new form shot at iPhone and iPad size as the battle renderer draws it, plus a solid-black silhouette check against the whole roster.

## Pieces

- `../shoot.mjs` captures frames from `/roster.html` (dev only). Env: `OUT`, `IDS`, `DEVICES` (iphone,ipad), `TIER` (default high), `STUDIO=1` (fog off, flat backdrop, matt floor), `ALONE=1` (no reference squishy), `SILHOUETTE=1` (flat black on white, also set `STUDIO=`), `RESUME=1` (skip frames already in `OUT`), `CONCURRENCY`. Failed frames retry twice.
- `shoot-many.sh` is a quick wrapper for looking at a few species.
- `apply-visuals.mjs <design.mjs>` rewrites the `visual` blocks of the named species in `species-wave-2.ts` (then run prettier). `designs.example.mjs` is the last design file.
- `silhouette-overlap.py <ids> <dir with silhouettes> <out.json>` scores each new silhouette against every existing roster silhouette (both cropped to their bounding box, scaled into 96x96, intersection over union). 1.00 is identical; 0.90 or more counts as a duplicate. It reads `sil/<id>-iphone-high.png` from `SHEET_DIR`.
- `build-sheet.py` builds `sheet.html` (one page, images embedded). Needs `SHEET_DIR` with `final/` (colour frames, `<id>-iphone-high.png` and `<id>-ipad-high.png`), `silnew/` (new silhouettes, both devices), `sil/` (existing roster silhouettes), `meta.json` (id, name, rarity, element, feeling of each wave-2 form) and `iou.json`. `template.html` and `captions.json` (one sentence per form, only what shows on screen) live beside it. Needs Python with Pillow and numpy.

## Run it

1. `pnpm install`, then `cd apps/client && pnpm exec vite --port 5173 --host 127.0.0.1` and leave it running.
2. Roster silhouettes (about 124 frames): `ALONE=1 SILHOUETTE=1 STUDIO= OUT=$SHEET_DIR/sil DEVICES=iphone node tooling/species-sheet/shoot.mjs` with `IDS` set to the existing species ids.
3. New forms: the same into `silnew` (DEVICES=iphone,ipad), then `ALONE=1 STUDIO=1 OUT=$SHEET_DIR/final DEVICES=iphone,ipad` for the colour frames.
4. `python3 -I silhouette-overlap.py <ids> $SHEET_DIR/silnew $SHEET_DIR/iou.json`, then `SHEET_DIR=... python3 -I build-sheet.py` and publish `sheet.html` as an artifact.

## Gotchas

- Container restarts kill vite and any capture. Check `curl http://127.0.0.1:5173/roster.html`, restart vite (detached with `setsid nohup`), and re-run with `RESUME=1`. A full set of 54 colour frames takes about 20 minutes under software rendering.
- Never `pkill -f` a pattern that appears in your own command line; it kills your shell.
- A blank silhouette frame means the page was caught mid-reload: delete it and re-shoot.
- Silhouette overlap is a screen, not a verdict: round bodies score 0.75 to 0.80 against each other. Judge the outline as well.
- Frames are cropped to the squishy's silhouette plus a margin by `build-sheet.py`; `shoot.mjs` takes a large fixed crop.
- Chain parts allow `step` and `shrink` of at most 1.2; part `size` values at most 1.5; at most 32 part instances per kind (the species test).
