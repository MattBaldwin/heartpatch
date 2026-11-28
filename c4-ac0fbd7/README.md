# C4 captures (#874): the Clockwork Isle map, wind, wires and rails

Branch `issue-874-c4-isle-map-client` @ `ac0fbd7`. Real renders of the dev island page
(`/island.html?tier=high&patch=clockwork&season=christmas…`, C1's `testClockworkIsle()`),
Chromium (SwiftShader) at iPhone 15 (393×852) and iPad Pro 11 (834×1194), DPR 2.
WebKit isn't installed in the lane's container, so these are Chromium frames.

| File | Compare with | Query extras | Draw calls |
|---|---|---|---|
| `c4-far-day-*` | `m1-far-day` | `far=1` | 63 |
| `c4-zoom-day-*` | `m1-zoom-day` | `lines=1&built=1&dist=9` (road loops round the home buildings) | 73 |
| `c4-night-*` | `m1-night-beacon` | `…&night=1&dist=11` | 73 |
| `c4-wire-and-rail-*` | `m2-wire-and-rail-overlay` | `lines=1&dist=7&focus=-5,12` (lit and dark wires, rails) | 67 |
| `c4-wind-*` | `m1-zoom-wind`, `m1-wind-three-strengths` | `lines=1&wind=1&dist=14` | 69 |
| `c4-wind-far-*` | `m1-far-wind` | `wind=1&far=1` | 65 |

Budget: 88 (Clockwork), Wild 82 and Cozy 75 unchanged. Windmills, Sorter, Depot, Bench and
Beacon models are C5's, so the frames show the home's Cozy buildings in the road loops.
