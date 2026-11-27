# #190 PR 2 (#877) at `3a78fae`: iPad framing fix, measured (pr2b)

The fix: the boss camera's slide now keeps the team's lowest body row (`teamFeet`: each friend's front edge on the ground) over the stage band's bottom. At `8b41f85` (pr2-8b41f85) the iPad picker card (top 0.660) covered the near row; `feet 0.660` there was the card edge.

- Build: `190-boss-camera` at `3a78fae`, `?tier=high`, Chromium + SwiftShader, DPR 2, same spec and measure script as pr2-8b41f85 (copies here), plus `CAPTURE_NOCARD=1`.
- **True feet, verified two ways.** (1) Each rest/lean frame has a `-nocard` twin: the same frozen frame with `.battle-sheet`, picker, handle and chips set `visibility: hidden` (layout and the camera's band unchanged). The lowest body-blue row is the same with and without the card, so the card is not capping it. (2) The sidecar's `battle.scene.framing.teamFeet` (new hook field) is 0.654 = band bottom: the camera's conservative front-edge estimate; the drawn silhouette sits a little higher.
- iPad card top: `rects.sheet.top` = 901.5 / 1366 = **0.660**; band bottom 0.654.

## Result

| frames | true feet | card top / band bottom | gap | chip overlap |
|---|---|---|---|---|
| iPad day rest, lean 0/1/2 | 0.639-0.640 | 0.660 / 0.654 | 27-29 css px over the card | 0 |
| iPad night rest, lean 0/1/2 | 0.636-0.638 | 0.660 / 0.654 | 30-33 px | 0 |
| iPhone day rest, lean 0/1/2 | 0.600-0.602 | handle / band 0.610 | 16-17 px over the 64 px handle (was 4-5) | 0 |

iPhone lean slot 1 worst body edge 0.799, rest 0.891 (unchanged from pr2-8b41f85; silhouette with tail beads 0.997 as before). The iPhone team now stands ~12 px higher.

## Missing / caveats

- iPad day: the run stopped at `05c-windup-late` (`never saw`, twice): at 1x under SwiftShader the windup hunts overshoot (early hit at 1465 ms, mid at 2939 ms), so the windup ended before the late target. `05`/`05b` are here but late in the step; **no landing frame**. Skipped per the coordinator: the blocking check is the picker frames.
- iPad night and iPhone day ran with `CAPTURE_BEATS=rest` (picker frames only).

## Table (measure-190-pr2.py)

| frame | size | beat | dist | facing | face | face_gap | face_in_band | band | team | body_l | body_r | body | edge_l | edge_r | edge | feet | feet_to_handle | chip_overlap_px |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ipad-01-rest-day-nocard | 1024x1366 | idle | 30.9 | 0.928 | 0.405-0.473 | 500.8 | True | 0.045-0.654 | 0.534-0.585 / 0.531-0.575 / 0.533-0.583 | -0.805 | 0.937 | 0.937 | -0.822 | 0.961 | 0.961 | 0.639 | 28.6 | [0, 0, 0] |
| ipad-01-rest-day | 1024x1366 | idle | 30.9 | 0.928 | 0.405-0.473 | 500.8 | True | 0.045-0.654 | 0.534-0.585 / 0.531-0.575 / 0.533-0.583 | -0.805 | 0.937 | 0.937 | -0.822 | 0.961 | 0.961 | 0.639 | 28.6 | [0, 0, 0] |
| ipad-02-lean-slot0-day-nocard | 1024x1366 | idle | 30.9 | 0.928 | 0.405-0.473 | 500.8 | True | 0.045-0.654 | 0.534-0.585 / 0.531-0.575 / 0.533-0.583 | -0.805 | 0.937 | 0.937 | -0.822 | 0.961 | 0.961 | 0.639 | 28.6 | [0, 0, 0] |
| ipad-02-lean-slot0-day | 1024x1366 | idle | 30.9 | 0.928 | 0.405-0.473 | 500.8 | True | 0.045-0.654 | 0.534-0.585 / 0.531-0.575 / 0.533-0.583 | -0.805 | 0.937 | 0.937 | -0.822 | 0.961 | 0.961 | 0.639 | 28.6 | [0, 0, 0] |
| ipad-03-lean-slot1-day-nocard | 1024x1366 | idle | 30.9 | 0.990 | 0.392-0.465 | 483.1 | True | 0.045-0.654 | 0.540-0.590 / 0.535-0.578 / 0.530-0.580 | -0.727 | 0.890 | 0.890 | -0.796 | 0.918 | 0.918 | 0.639 | 28.6 | [0, 0, 0] |
| ipad-03-lean-slot1-day | 1024x1366 | idle | 30.9 | 0.990 | 0.392-0.465 | 483.1 | True | 0.045-0.654 | 0.540-0.590 / 0.535-0.578 / 0.530-0.580 | -0.727 | 0.890 | 0.890 | -0.796 | 0.918 | 0.918 | 0.639 | 28.6 | [0, 0, 0] |
| ipad-04-lean-slot2-day-nocard | 1024x1366 | idle | 30.9 | 0.963 | 0.407-0.475 | 504.3 | True | 0.045-0.654 | 0.533-0.584 / 0.535-0.578 / 0.540-0.587 | -0.785 | 0.784 | 0.785 | -0.862 | 0.832 | 0.862 | 0.640 | 27.1 | [0, 0, 0] |
| ipad-04-lean-slot2-day | 1024x1366 | idle | 30.9 | 0.963 | 0.407-0.475 | 504.3 | True | 0.045-0.654 | 0.533-0.584 / 0.535-0.578 / 0.540-0.587 | -0.785 | 0.784 | 0.785 | -0.862 | 0.832 | 0.862 | 0.640 | 27.1 | [0, 0, 0] |
| ipad-05-windup-early-day | 1024x1366 | effect@1465ms | 27.3 | 0.855 | 0.560-0.641 | 713.6 | True | 0.045-0.947 | 0.728-0.789 / 0.729-0.780 / 0.729-0.785 | -1.000 | 0.999 | 1.000 | -1.000 | 0.999 | 1.000 | 0.854 | 135.5 | [0, 0, 0] |
| ipad-05b-windup-mid-day | 1024x1366 | effect@2939ms | 30.3 | 0.970 | 0.565-0.640 | 720.2 | True | 0.045-0.947 | 0.717-0.771 / 0.717-0.762 / 0.715-0.765 | -1.000 | 0.956 | 1.000 | -1.000 | 0.973 | 1.000 | 0.836 | 160.0 | [0, 0, 0] |
| ipad-01-rest-night-nocard | 1024x1366 | idle | 30.7 | 0.887 | 0.400-0.470 | 494.3 | True | 0.045-0.654 | 0.541-0.586 / 0.542-0.583 / 0.532-0.576 | -0.758 | 0.847 | 0.847 | -0.859 | 0.986 | 0.986 | 0.636 | 32.6 | [0, 0, 0] |
| ipad-01-rest-night | 1024x1366 | idle | 30.7 | 0.887 | 0.400-0.470 | 494.3 | True | 0.045-0.654 | 0.541-0.586 / 0.542-0.583 / 0.532-0.576 | -0.758 | 0.847 | 0.847 | -0.859 | 0.986 | 0.986 | 0.636 | 32.6 | [0, 0, 0] |
| ipad-02-lean-slot0-night-nocard | 1024x1366 | idle | 30.7 | 0.887 | 0.400-0.470 | 494.3 | True | 0.045-0.654 | 0.541-0.586 / 0.542-0.583 / 0.532-0.576 | -0.758 | 0.847 | 0.847 | -0.859 | 0.986 | 0.986 | 0.636 | 32.6 | [0, 0, 0] |
| ipad-02-lean-slot0-night | 1024x1366 | idle | 30.7 | 0.887 | 0.400-0.470 | 494.3 | True | 0.045-0.654 | 0.541-0.586 / 0.542-0.583 / 0.532-0.576 | -0.758 | 0.847 | 0.847 | -0.859 | 0.986 | 0.986 | 0.636 | 32.6 | [0, 0, 0] |
| ipad-03-lean-slot1-night-nocard | 1024x1366 | idle | 30.7 | 0.992 | 0.393-0.465 | 484.5 | True | 0.045-0.654 | 0.541-0.587 / 0.542-0.583 / 0.529-0.574 | -0.777 | 0.847 | 0.847 | -0.911 | 0.960 | 0.960 | 0.638 | 30.1 | [0, 0, 0] |
| ipad-03-lean-slot1-night | 1024x1366 | idle | 30.7 | 0.992 | 0.393-0.465 | 484.5 | True | 0.045-0.654 | 0.541-0.587 / 0.542-0.583 / 0.529-0.574 | -0.777 | 0.847 | 0.847 | -0.911 | 0.960 | 0.960 | 0.638 | 30.6 | [0, 0, 0] |
| ipad-04-lean-slot2-night-nocard | 1024x1366 | idle | 30.7 | 0.969 | 0.400-0.470 | 494.0 | True | 0.045-0.654 | 0.544-0.589 / 0.547-0.586 / 0.532-0.576 | -0.895 | 0.784 | 0.895 | -0.976 | 0.967 | 0.976 | 0.638 | 30.1 | [0, 0, 0] |
| ipad-04-lean-slot2-night | 1024x1366 | idle | 30.7 | 0.969 | 0.400-0.470 | 494.0 | True | 0.045-0.654 | 0.544-0.589 / 0.547-0.586 / 0.532-0.576 | -0.895 | 0.784 | 0.895 | -0.976 | 0.967 | 0.976 | 0.638 | 30.1 | [0, 0, 0] |
| iphone-01-rest-day-nocard | 393x852 | idle | 44.2 | 0.989 | 0.437-0.489 | 261.2 | True | 0.142-0.610 | 0.538-0.569 / 0.534-0.562 / 0.531-0.566 | -0.715 | 0.891 | 0.891 | -0.868 | 0.997 | 0.997 | 0.602 | 15.8 | [0, 0, 0] |
| iphone-01-rest-day | 393x852 | idle | 44.2 | 0.989 | 0.437-0.489 | 261.2 | True | 0.142-0.610 | 0.538-0.569 / 0.534-0.562 / 0.531-0.566 | -0.715 | 0.891 | 0.891 | -0.868 | 0.997 | 0.997 | 0.602 | 15.8 | [0, 0, 0] |
| iphone-02-lean-slot0-day-nocard | 393x852 | idle | 44.2 | 0.989 | 0.437-0.489 | 261.2 | True | 0.142-0.610 | 0.538-0.569 / 0.534-0.562 / 0.531-0.566 | -0.715 | 0.891 | 0.891 | -0.868 | 0.997 | 0.997 | 0.602 | 15.8 | [0, 0, 0] |
| iphone-02-lean-slot0-day | 393x852 | idle | 44.2 | 0.989 | 0.437-0.489 | 261.2 | True | 0.142-0.610 | 0.538-0.569 / 0.534-0.562 / 0.531-0.566 | -0.715 | 0.891 | 0.891 | -0.868 | 0.997 | 0.997 | 0.602 | 15.8 | [0, 0, 0] |
| iphone-03-lean-slot1-day-nocard | 393x852 | idle | 44.2 | 0.975 | 0.433-0.486 | 258.2 | True | 0.142-0.610 | 0.532-0.566 / 0.530-0.559 / 0.526-0.563 | -0.817 | 0.799 | 0.817 | -0.939 | 0.997 | 0.997 | 0.600 | 17.3 | [0, 0, 0] |
| iphone-03-lean-slot1-day | 393x852 | idle | 44.2 | 0.975 | 0.433-0.486 | 258.2 | True | 0.142-0.610 | 0.532-0.566 / 0.530-0.559 / 0.526-0.563 | -0.817 | 0.799 | 0.817 | -0.939 | 0.997 | 0.997 | 0.600 | 17.3 | [0, 0, 0] |
| iphone-04-lean-slot2-day-nocard | 393x852 | idle | 44.2 | 0.840 | 0.433-0.486 | 257.9 | True | 0.142-0.610 | 0.533-0.566 / 0.531-0.560 / 0.526-0.563 | -0.868 | 0.707 | 0.868 | -1.000 | 0.916 | 1.000 | 0.601 | 16.3 | [0, 0, 0] |
| iphone-04-lean-slot2-day | 393x852 | idle | 44.2 | 0.840 | 0.433-0.486 | 257.9 | True | 0.142-0.610 | 0.533-0.566 / 0.531-0.560 / 0.526-0.563 | -0.868 | 0.707 | 0.868 | -1.000 | 0.916 | 1.000 | 0.600 | 16.8 | [0, 0, 0] |
