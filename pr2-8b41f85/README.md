# #190 PR 2 (#877) at `8b41f85`: the boss camera, measured

Frames of the boss camera (low hero shot, windup push-in, landing thump, KO pull-back, picker lean `focusShift` 0.12).
Every number comes from `measure-190-pr2.py` (numpy + PIL) over each PNG and its `.json` sidecar (the battle dev hook's
`scene.framing` / `scene.playing`, plus DOM rects taken at shot time). Not eyeballed, except the notes under "Looks wrong".

- **Build**: PR branch `190-boss-camera` at `8b41f85`, quality tier `?tier=high`, Chromium + SwiftShader, DPR 2, dev HUD hidden.
- **iPhone** 393x852 with CDP safe-area insets (top 59 / bottom 34) -> 786x1704 PNGs. **iPad** 1024x1366 (no insets) -> 2048x2732 PNGs.
- **day** = browser zone Asia/Dubai (~13:00 local), **night** = America/Denver (~02:00 local).
- **Fight**: boss-stub.ts's three-squishy stand-in (as `boss-battle.spec.ts`: three Puddlepuffs vs a boss), real app around it.
  The boss is the stub's Puddlepuff, not a real Rakelet. Rounds: 1 = Count to Three windup, 2 = its landing, 3 = the win (boss KO).
- Spec: `zz-capture-190-pr2.spec.ts.txt` (copy to `apps/client/tests/e2e/`, never committed there). Clock is virtual: slowed to 0.12x
  when a step starts, frozen at the target `at` ms, then shot. `at` is what the hook reported at the frozen instant.
- 13 frames per folder x 4 folders = **52 frames**: `iphone-day`, `iphone-night`, `ipad-day`, `ipad-night`.
  Frames: `01-rest` (fight start, picker up, slot 0 picking), `02-lean-slot0`, `03-lean-slot1`, `04-lean-slot2` (picker lean to each friend),
  `05/05b/05c` windup early/mid/late (push-in), `06/06b` landing (thump, then settling), `07` KO push, `08/08b` KO pull-back, `09` after the KO (result framing).
- Missing / caveats: no separate "no-lean" rest (the picker leans to slot 0 from the first frame, so `01` and `02` are the same camera); the frame is shot from the stub,
  not a real boss visit; iPad is 1024x1366 as briefed (earlier folders used 820x1180); `ipad-05-windup-early-night` and `05b` landed on the same instant (identical).

## Columns

`dist` camera distance; `face` boss face box top-bottom (fractions of viewport height), `face_gap` = css px from the HUD strip's bottom to the face top;
`band` the stage band the camera framed into; `team` the three friends' face boxes; `body_l/r/body` = the end friends' **body** edge in normalized viewport x (-1..1)
measured on the PNG after dropping ears and tail beads (morphological opening); `edge` = **silhouette** edge incl. ears and tail beads (clipped = 0.995+);
`feet` lowest body-blue row of the team as a fraction of viewport height (rest frames: sheet up, profile `feetY` 0.62); `feet_to_handle` css px above the sheet handle;
`chip_overlap_px` body-blue pixels inside each team chip's DOM rect (0 = no squishy under the chip).

| frame | size | beat | dist | facing | face | face_gap | face_in_band | band | team | body_l | body_r | body | edge_l | edge_r | edge | feet | feet_to_handle | chip_overlap_px |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| iphone-01-rest-day | 393x852 | idle | 44.4 | 0.997 | 0.446-0.499 | 268.7 | True | 0.142-0.610 | 0.545-0.579 / 0.545-0.579 / 0.543-0.578 | -0.735 | 0.891 | 0.891 | -0.766 | 0.997 | 0.997 | 0.615 | 4.328 | [0, 0, 0] |
| iphone-02-lean-slot0-day | 393x852 | idle | 44.4 | 0.997 | 0.446-0.499 | 268.7 | True | 0.142-0.610 | 0.545-0.579 / 0.545-0.579 / 0.543-0.578 | -0.735 | 0.891 | 0.891 | -0.766 | 0.997 | 0.997 | 0.615 | 4.328 | [0, 0, 0] |
| iphone-03-lean-slot1-day | 393x852 | idle | 44.4 | 0.987 | 0.450-0.502 | 272.2 | True | 0.142-0.610 | 0.542-0.577 / 0.544-0.578 / 0.544-0.579 | -0.786 | 0.799 | 0.799 | -0.975 | 0.982 | 0.982 | 0.616 | 3.828 | [0, 0, 0] |
| iphone-04-lean-slot2-day | 393x852 | idle | 44.4 | 0.970 | 0.448-0.501 | 270.3 | True | 0.142-0.610 | 0.543-0.578 / 0.544-0.579 / 0.544-0.578 | -0.878 | 0.748 | 0.878 | -0.898 | 0.941 | 0.941 | 0.614 | 5.328 | [0, 0, 0] |
| iphone-05-windup-early-day | 393x852 | effect@328ms | 40.8 | -0.638 | - | - | - | 0.142-0.876 | 0.691-0.728 / 0.689-0.727 / 0.687-0.725 | -0.949 | 0.901 | 0.949 | -1.000 | 0.997 | 1.000 | 0.768 | 99.5 | [0, 0, 0] |
| iphone-05b-windup-mid-day | 393x852 | effect@685ms | 36.4 | 0.989 | 0.568-0.633 | 372.8 | True | 0.142-0.876 | 0.699-0.742 / 0.698-0.741 / 0.693-0.737 | -1.000 | 0.992 | 1.000 | -1.000 | 0.997 | 1.000 | 0.791 | 80.0 | [0, 0, 0] |
| iphone-05c-windup-late-day | 393x852 | effect@1207ms | 41.0 | 0.969 | 0.585-0.639 | 387.4 | True | 0.142-0.876 | 0.684-0.724 / 0.686-0.725 / 0.687-0.725 | -0.949 | 0.891 | 0.949 | -1.000 | 0.997 | 1.000 | 0.766 | 101.0 | [0, 0, 0] |
| iphone-06-landing-day | 393x852 | hit@383ms | 38.6 | -0.917 | - | - | - | 0.142-0.876 | 0.699-0.737 / 0.683-0.724 / 0.684-0.725 | -1.000 | 0.992 | 1.000 | -1.000 | 0.997 | 1.000 | 0.785 | 85.0 | [0, 0, 0] |
| iphone-06b-landing-settle-day | 393x852 | hit@814ms | 41.7 | 0.991 | 0.578-0.632 | 381.1 | True | 0.142-0.876 | 0.680-0.717 / 0.685-0.720 / 0.683-0.718 | -0.888 | 0.962 | 0.962 | -1.000 | 0.997 | 1.000 | 0.763 | 103.5 | [0, 0, 0] |
| iphone-07-ko-push-day | 393x852 | tuckered@493ms | 45.2 | 0.047 | - | - | - | 0.142-0.876 | - | -0.858 | 0.799 | 0.858 | -0.880 | 0.997 | 0.997 | 0.750 | 115.0 | [0, 0, 0] |
| iphone-08-ko-pullback-day | 393x852 | tuckered@1596ms | 42.6 | 0.989 | - | - | - | 0.142-0.876 | - | -0.888 | 0.860 | 0.888 | -0.949 | 0.997 | 0.997 | 0.759 | 107.0 | [0, 0, 0] |
| iphone-08b-ko-pullback-late-day | 393x852 | tuckered@3115ms | 43.9 | 0.989 | - | - | - | 0.142-0.876 | - | -0.888 | 0.830 | 0.888 | -0.975 | 0.997 | 0.997 | 0.754 | 112.0 | [0, 0, 0] |
| iphone-09-after-ko-day | 393x852 | idle | 69.5 | 0.988 | - | - | - | 0.198-0.455 | - | - | - | - | 0.260 | 0.372 | 0.372 | 0.508 | 419.5 | [0, 0, 0] |
| iphone-01-rest-night | 393x852 | idle | 44.4 | 0.978 | 0.445-0.499 | 268.3 | True | 0.142-0.610 | 0.549-0.577 / 0.542-0.575 / 0.544-0.573 | -0.654 | 0.870 | 0.870 | -0.916 | 0.997 | 0.997 | 0.608 | 10.3 | [0, 0, 0] |
| iphone-02-lean-slot0-night | 393x852 | idle | 44.4 | 0.978 | 0.445-0.499 | 268.3 | True | 0.142-0.610 | 0.549-0.577 / 0.542-0.575 / 0.544-0.573 | -0.654 | 0.870 | 0.870 | -0.916 | 0.997 | 0.997 | 0.608 | 10.3 | [0, 0, 0] |
| iphone-03-lean-slot1-night | 393x852 | idle | 44.4 | 0.845 | 0.451-0.503 | 273.1 | True | 0.142-0.610 | 0.548-0.576 / 0.545-0.576 / 0.549-0.577 | -0.746 | 0.789 | 0.789 | -1.000 | 0.995 | 1.000 | 0.608 | 10.3 | [0, 0, 0] |
| iphone-04-lean-slot2-night | 393x852 | idle | 44.4 | 0.983 | 0.448-0.501 | 271.0 | True | 0.142-0.610 | 0.546-0.575 / 0.541-0.573 / 0.544-0.573 | -0.186 | 0.728 | 0.728 | -0.896 | 0.936 | 0.936 | 0.607 | 10.8 | [0, 0, 0] |
| iphone-05-windup-early-night | 393x852 | effect@437ms | 38.9 | 0.994 | 0.556-0.620 | 363.0 | True | 0.142-0.876 | 0.695-0.729 / 0.689-0.727 / 0.691-0.724 | -0.939 | 0.941 | 0.941 | -0.980 | 0.997 | 0.997 | 0.767 | 100.5 | [0, 0, 0] |
| iphone-05b-windup-mid-night | 393x852 | effect@659ms | 36.5 | 0.967 | 0.568-0.634 | 373.0 | True | 0.142-0.876 | 0.701-0.738 / 0.694-0.735 / 0.694-0.731 | -0.990 | 0.992 | 0.992 | -1.000 | 0.997 | 1.000 | 0.779 | 90.0 | [0, 0, 0] |
| iphone-05c-windup-late-night | 393x852 | effect@1212ms | 41.2 | 0.938 | 0.582-0.638 | 384.7 | True | 0.142-0.876 | 0.687-0.720 / 0.683-0.719 / 0.689-0.720 | -0.878 | 0.880 | 0.880 | -1.000 | 0.997 | 1.000 | 0.757 | 109.0 | [0, 0, 0] |
| iphone-06-landing-night | 393x852 | hit@654ms | 39.0 | 0.992 | 0.576-0.633 | 379.6 | True | 0.142-0.876 | 0.691-0.725 / 0.683-0.719 / 0.692-0.723 | -0.868 | 0.992 | 0.992 | -1.000 | 0.997 | 1.000 | 0.760 | 106.5 | [0, 0, 0] |
| iphone-06b-landing-settle-night | 393x852 | hit@716ms | 39.6 | 0.991 | 0.583-0.637 | 385.6 | True | 0.142-0.876 | 0.689-0.721 / 0.684-0.719 / 0.691-0.721 | -0.817 | 0.992 | 0.992 | -1.000 | 0.997 | 1.000 | 0.758 | 108.5 | [0, 0, 0] |
| iphone-07-ko-push-night | 393x852 | tuckered@457ms | 45.5 | -0.031 | - | - | - | 0.142-0.876 | - | -0.786 | 0.779 | 0.786 | -0.980 | 0.982 | 0.982 | 0.743 | 121.0 | [0, 0, 0] |
| iphone-08-ko-pullback-night | 393x852 | tuckered@1597ms | 42.7 | 0.989 | - | - | - | 0.142-0.876 | - | -0.827 | 0.850 | 0.850 | -0.919 | 0.997 | 0.997 | 0.754 | 111.5 | [0, 0, 0] |
| iphone-08b-ko-pullback-late-night | 393x852 | tuckered@3049ms | 43.8 | 0.989 | - | - | - | 0.142-0.876 | - | -0.817 | 0.830 | 0.830 | -1.000 | 0.997 | 1.000 | 0.749 | 116.0 | [0, 0, 0] |
| iphone-09-after-ko-night | 393x852 | idle | 69.5 | 0.988 | - | - | - | 0.198-0.455 | - | - | - | - | 0.260 | 0.372 | 0.372 | 0.508 | 419.5 | [0, 0, 0] |
| ipad-01-rest-day | 1024x1366 | idle | 31.0 | 0.952 | 0.475-0.547 | 597.5 | True | 0.045-0.654 | 0.615-0.658 / 0.615-0.658 / 0.615-0.662 | -0.668 | 0.792 | 0.792 | -0.796 | 0.982 | 0.982 | 0.660 | 0.562 | [0, 0, 0] |
| ipad-02-lean-slot0-day | 1024x1366 | idle | 31.0 | 0.952 | 0.475-0.547 | 597.5 | True | 0.045-0.654 | 0.615-0.658 / 0.615-0.658 / 0.615-0.662 | -0.668 | 0.792 | 0.792 | -0.796 | 0.982 | 0.982 | 0.660 | 0.562 | [0, 0, 0] |
| ipad-03-lean-slot1-day | 1024x1366 | idle | 31.0 | 0.968 | 0.487-0.554 | 612.7 | True | 0.045-0.654 | 0.608-0.653 / 0.611-0.655 / 0.618-0.663 | -0.715 | 0.745 | 0.745 | -0.794 | 0.884 | 0.884 | 0.660 | 0.562 | [0, 473, 0] |
| ipad-04-lean-slot2-day | 1024x1366 | idle | 31.0 | 0.989 | 0.472-0.545 | 592.3 | True | 0.045-0.654 | 0.614-0.657 / 0.614-0.657 / 0.612-0.660 | -0.777 | 0.659 | 0.777 | -0.943 | 0.804 | 0.943 | 0.660 | 0.562 | [0, 0, 122] |
| ipad-05-windup-early-day | 1024x1366 | effect@442ms | 27.1 | 0.994 | 0.535-0.621 | 679.0 | True | 0.045-0.947 | 0.729-0.781 / 0.723-0.775 / 0.720-0.777 | -1.000 | 0.999 | 1.000 | -1.000 | 0.999 | 1.000 | 0.860 | 127.5 | [0, 0, 0] |
| ipad-05b-windup-mid-day | 1024x1366 | effect@802ms | 25.5 | 0.870 | 0.548-0.636 | 696.1 | True | 0.045-0.947 | 0.735-0.792 / 0.731-0.788 / 0.726-0.788 | -0.996 | 0.999 | 0.999 | -1.000 | 0.999 | 1.000 | 0.876 | 105.0 | [0, 0, 0] |
| ipad-05c-windup-late-day | 1024x1366 | effect@1260ms | 27.7 | 0.972 | 0.570-0.646 | 726.2 | True | 0.045-0.947 | 0.717-0.771 / 0.714-0.767 / 0.717-0.772 | -0.887 | 0.968 | 0.968 | -0.974 | 0.999 | 0.999 | 0.850 | 140.5 | [0, 0, 0] |
| ipad-06-landing-day | 1024x1366 | hit@1511ms | 27.0 | 0.927 | 0.558-0.637 | 710.4 | True | 0.045-0.947 | 0.721-0.769 / 0.718-0.767 / 0.716-0.770 | -0.992 | 0.999 | 0.999 | -0.998 | 0.999 | 0.999 | 0.842 | 152.0 | [0, 0, 0] |
| ipad-06b-landing-settle-day | 1024x1366 | hit@2814ms | 30.3 | 0.928 | 0.564-0.636 | 718.2 | True | 0.045-0.947 | 0.699-0.743 / 0.705-0.748 / 0.708-0.754 | -0.805 | 0.952 | 0.952 | -0.825 | 0.966 | 0.966 | 0.817 | 186.0 | [0, 0, 0] |
| ipad-07-ko-push-day | 1024x1366 | tuckered@2519ms | 28.7 | 0.991 | - | - | - | 0.045-0.947 | - | -0.875 | 0.999 | 0.999 | -0.940 | 0.999 | 0.999 | 0.836 | 160.0 | [0, 0, 0] |
| ipad-08-ko-pullback-day | 1024x1366 | tuckered@2662ms | 28.8 | 0.991 | - | - | - | 0.045-0.947 | - | -0.859 | 0.952 | 0.952 | -0.937 | 0.970 | 0.970 | 0.837 | 159.0 | [0, 0, 0] |
| ipad-08b-ko-pullback-late-day | 1024x1366 | tuckered@3410ms | 29.5 | 0.991 | - | - | - | 0.045-0.947 | - | -0.852 | 0.979 | 0.979 | -0.913 | 0.999 | 0.999 | 0.832 | 165.0 | [0, 0, 0] |
| ipad-09-after-ko-day | 1024x1366 | idle | 29.8 | 0.991 | - | - | - | 0.081-0.600 | - | -0.801 | 0.952 | 0.952 | -0.858 | 0.977 | 0.977 | 0.681 | 435.5 | [0, 0, 0] |
| ipad-01-rest-night | 1024x1366 | idle | 30.9 | 0.992 | 0.479-0.550 | 602.5 | True | 0.045-0.654 | 0.609-0.659 / 0.618-0.665 / 0.625-0.664 | -0.652 | 0.812 | 0.812 | -0.727 | 0.899 | 0.899 | 0.660 | 0.562 | [0, 0, 0] |
| ipad-02-lean-slot0-night | 1024x1366 | idle | 30.9 | 0.992 | 0.479-0.550 | 602.5 | True | 0.045-0.654 | 0.609-0.659 / 0.618-0.665 / 0.625-0.664 | -0.652 | 0.812 | 0.812 | -0.727 | 0.899 | 0.899 | 0.660 | 0.562 | [0, 0, 0] |
| ipad-03-lean-slot1-night | 1024x1366 | idle | 30.9 | 0.852 | 0.473-0.546 | 593.9 | True | 0.045-0.654 | 0.612-0.661 / 0.611-0.660 / 0.613-0.656 | -0.707 | 0.726 | 0.726 | -0.892 | 0.923 | 0.923 | 0.660 | 0.562 | [0, 479, 0] |
| ipad-04-lean-slot2-night | 1024x1366 | idle | 30.9 | 0.998 | 0.482-0.551 | 606.4 | True | 0.045-0.654 | 0.607-0.657 / 0.610-0.660 / 0.617-0.659 | -0.785 | 0.675 | 0.785 | -0.850 | 0.982 | 0.982 | 0.660 | 0.562 | [0, 0, 17] |
| ipad-05-windup-early-night | 1024x1366 | effect@775ms | 25.5 | 0.962 | 0.554-0.640 | 704.3 | True | 0.045-0.947 | 0.733-0.797 / 0.732-0.795 / 0.734-0.787 | -0.957 | 0.999 | 0.999 | -0.992 | 0.999 | 0.999 | 0.866 | 119.5 | [0, 0, 0] |
| ipad-05b-windup-mid-night | 1024x1366 | effect@775ms | 25.5 | 0.962 | 0.554-0.640 | 704.3 | True | 0.045-0.947 | 0.733-0.797 / 0.732-0.795 / 0.734-0.787 | -0.957 | 0.999 | 0.999 | -0.992 | 0.999 | 0.999 | 0.866 | 119.5 | [0, 0, 0] |
| ipad-05c-windup-late-night | 1024x1366 | effect@1346ms | 27.7 | 0.947 | 0.569-0.645 | 725.2 | True | 0.045-0.947 | 0.716-0.776 / 0.717-0.776 / 0.722-0.771 | -0.961 | 0.987 | 0.987 | -1.000 | 0.999 | 1.000 | 0.842 | 151.5 | [0, 0, 0] |
| ipad-06-landing-night | 1024x1366 | hit@433ms | 27.5 | -0.001 | - | - | - | 0.045-0.947 | 0.747-0.801 / 0.714-0.769 / 0.715-0.762 | -1.000 | 0.964 | 1.000 | -1.000 | 0.999 | 1.000 | 0.861 | 126.5 | [0, 0, 0] |
| ipad-06b-landing-settle-night | 1024x1366 | hit@578ms | 28.1 | 0.999 | 0.545-0.625 | 693.1 | True | 0.045-0.947 | 0.716-0.776 / 0.706-0.761 / 0.709-0.756 | -0.977 | 0.983 | 0.983 | -1.000 | 0.999 | 1.000 | 0.841 | 153.5 | [0, 0, 0] |
| ipad-07-ko-push-night | 1024x1366 | tuckered@549ms | 30.1 | 0.106 | - | - | - | 0.045-0.947 | - | -0.914 | 0.812 | 0.914 | -1.000 | 0.969 | 1.000 | 0.826 | 173.5 | [0, 0, 0] |
| ipad-08-ko-pullback-night | 1024x1366 | tuckered@1746ms | 29.4 | 0.991 | - | - | - | 0.045-0.947 | - | -0.828 | 0.929 | 0.929 | -0.853 | 0.999 | 0.999 | 0.832 | 165.5 | [0, 0, 0] |
| ipad-08b-ko-pullback-late-night | 1024x1366 | tuckered@3320ms | 30.3 | 0.991 | - | - | - | 0.045-0.947 | - | -0.879 | 0.812 | 0.879 | -0.996 | 0.973 | 0.996 | 0.825 | 175.0 | [0, 0, 0] |
| ipad-09-after-ko-night | 1024x1366 | idle | 30.4 | 0.991 | - | - | - | 0.081-0.600 | - | -0.883 | 0.878 | 0.883 | -0.983 | 0.947 | 0.983 | 0.677 | 441.5 | [0, 0, 0] |


## Summary

- **Picker lean (iPhone, day)**: worst body edge 0.891 (rest / lean 0: right friend), 0.799 (lean 1), 0.878 (lean 2) - all <= 0.958 and under the 0.97 margin.
  Silhouette incl. tail beads touches the screen edge (0.997) at rest / lean 0 and 0.982 at lean 1 (right friend's tail); lean 2 is 0.941. Bodies are clear by 5%+ of the width; only tail beads reach the edge.
- **Rest feet**: iPhone team feet at y 0.615 / 0.608 (day / night), profile target 0.62, 4-5 px above the 64 px handle. iPad 0.660.
- **Boss face vs HUD strip**: iPhone rest 268 px under the strip bottom (strip bottom 111 px); windup/landing 363-387 px. iPad 592-726 px. The face is inside the band in every frame where the hook reports one.
- **Camera distance**: iPhone rest 44.4, windup push to 36.4 at mid (rest x 0.82 = the 0.18 push), landing 38.6-39.6 (0.2 push), settle back to 41-42; KO 45.2 -> 42.6 -> 43.9, then 69.5 for the result. iPad 31.0 rest, 25.5 windup, 27.0 landing.
- **Face box during KO**: the hook reports no face box once the boss faints (turned away, `bossFacing` 0.05-0.99).

## Looks wrong (FAIL / notes)

1. **FAIL (beats clip the end friends):** on iPhone, windup mid (`05b`), windup early/late, landing (`06`) and the KO frames put the end friends' bodies **at or past the screen edge** (body edge 0.95-1.00; silhouette 1.000). The push-in (18%) and landing push (20%) are layered on a rest framing whose end friends already sit at ~0.89, so the left and right friend are cut by the screen edges at the beat peaks. The unit test's 0.97 margin only covers rest and the picker lean. iPad is the same (body 0.96-1.00 at windup/landing).
2. **FAIL (iPad, picker up):** the picker is a floating card on iPad and sits **over the team's lower body**: `chip_overlap_px` 473 (chip 1, lean slot 1, day) and 122 / 17 (chip 2, lean slot 2, day / night). Feet and tail of the middle and right friends are behind the card; visible in `ipad-03-lean-slot1-day.png`. Rest feet are at y 0.660 on iPad, below the card top.
3. iPhone: the 64 px sheet handle's chips overlap no squishy in any frame (all `[0, 0, 0]`).
4. Left edge of the screen: the Keeper stands half-clipped at the far left of the rest and lean frames on iPhone (not a friend).
5. No pixelation, boss face under the HUD, team chip row cut off, or fog seam seen. The sun disc sits behind the strip on the day frames.
6. Mask caveat: at night the blue mask is less reliable (`iphone-04-lean-slot2-night` reports body_l -0.186; the picture shows the left friend fully in). Use the PNGs for night.
