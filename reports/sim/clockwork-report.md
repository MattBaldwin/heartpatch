# Clockwork Isle balance (`pnpm sim:clockwork`)

#874 Wave 1, lane C6. 14 days from 2026-12-01, a casual and an engaged kid on one Clockwork Isle homestead, every number read from the data (`BUILDINGS`, `POWER_RULES`, `RAIL_RULES`, `RESEARCH_TREE`, `RESOURCES`, `JOB_RULES`, `GLIMMER_SWAP`). Each kid runs twice: with the research tree as the data has it, and with the owner's Blueprint ruling (supervisor 58, 2026-11-28: tier 1 grants 8). 4 runs in 0.8 s.

## Guards (with the ruling)

| guard | result | |
|---|---|---|
| casual kid builds a Windmill by day 3 | day 1 | ✅ |
| casual kid builds a Sorter by day 7 | day 3 | ✅ |
| Spark Jars never run negative (every run) | least 0 | ✅ |
| casual kid: Parts income ≥ Parts spend over 14 days | 216 in, 51 spent | ✅ |
| engaged kid: Parts income ≥ Parts spend over 14 days | 1580 in, 169 spent | ✅ |
| engaged kid's Beacon by day 10 | day 1 | ✅ |
| engaged kid wraps at most 2 presents a day | most 1 a day | ✅ |

## Summary

| kid | Blueprints | Windmill | Sorter | Beacon | Wrapper | plan | Blueprints granted / spent | Parts in / spent | Spark made / used | presents (most a day) |
|---|---|---|---|---|---|---|---|---|---|---|
| casual | data (6) | 1 | 3 | 4 | — | done | 4 / 3 | 216 / 51 | 624 / 114 | 0 (0) |
| casual | ruling (8) | 1 | 3 | 4 | — | done | 4 / 3 | 216 / 51 | 624 / 114 | 0 (0) |
| engaged | data (6) | 1 | 2 | 1 | 2 | stuck on sorter L2 (short 2 blueprints) | 6 / 6 | 1580 / 149 | 1408 / 300 | 12 (1) |
| engaged | ruling (8) | 1 | 2 | 1 | 2 | done | 8 / 8 | 1580 / 169 | 1408 / 300 | 12 (1) |

## Blueprint balance

Every Wave 1 build that costs Blueprints, each level built once, needs **8**. Tier 1 research grants **6** as the data has it, and **8** with the ruling (one time: research is never repeated).

| build | level | Blueprints |
|---|---|---|
| sorter | 1 | 1 |
| sorter | 2 | 2 |
| research-bench | 2 | 1 |
| rail-depot | 2 | 1 |
| clockwork-beacon | 1 | 2 |
| gift-wrapper | 1 | 1 |

| node | grants (data) | grants (ruling, modelled) |
|---|---|---|
| sorting | 2 | 2 |
| bright-bulbs | 2 | 2 |
| tidy-rails | 1 | 2 |
| wrapping | 1 | 2 |

How C3 splits the extra two is C3's call; the sim's split (`grantsOverride` in `clockwork-config.ts`) only needs the total. Once C3's data says 8, `grantsOverride` empties and both rows read the same.

## Windmill Spark Jars a day

| level | wind 1 | wind 2 | wind 3 |
|---|---|---|---|
| 1 | 36 | 48 | 72 |
| 2 | 54 | 72 | 108 |

A works cycle runs at `JOB_RULES.work.cyclePercent` (200 %) like every works building, so a level-1 Windmill at wind 2 makes 2 an hour, not the 4 the row's comment says.

## Proposed upkeep (Wave 1 sets none)

A day's output at sell price, less what it eats (fed every cycle), at wind 2; upkeep at 15–25 % of it (owner decision 2026-10-22). Proposals only; no data changed.

| works | level | a day | net worth 💛 | upkeep 💛 |
|---|---|---|---|---|
| windmill | 1 | 48.0 spark | 9.6 | 1–2 |
| windmill | 2 | 72.0 spark | 14.4 | 2–4 |
| sorter | 1 | 144.0 treats | 19.2 | 3–5 |
| sorter | 2 | 216.0 treats | 28.8 | 4–7 |
| gift-wrapper | 1 | 1.5 presents | not sold | — (pick by hand) |

## casual kid, day by day (ruling)

| day | bought | Spark | Parts | Blueprints | Greens | Treats | presents |
|---|---|---|---|---|---|---|---|
| 1 | windmill L1 | 0 | 4 | 0 | 8 | 0 | 0 |
| 2 | research-bench L1, research sorting | 44 | 8 | 2 | 24 | 0 | 0 |
| 3 | sorter L1, research bright-bulbs | 70 | 4 | 1 | 8 | 48 | 0 |
| 4 | clockwork-beacon L1 | 110 | 5 | 1 | 8 | 72 | 0 |
| 5 | — | 150 | 21 | 1 | 8 | 96 | 0 |
| 6 | — | 190 | 37 | 1 | 8 | 120 | 0 |
| 7 | — | 230 | 53 | 1 | 8 | 144 | 0 |
| 8 | — | 270 | 69 | 1 | 8 | 168 | 0 |
| 9 | — | 310 | 85 | 1 | 8 | 192 | 0 |
| 10 | — | 350 | 101 | 1 | 8 | 216 | 0 |
| 11 | — | 390 | 117 | 1 | 8 | 240 | 0 |
| 12 | — | 430 | 133 | 1 | 8 | 264 | 0 |
| 13 | — | 470 | 149 | 1 | 8 | 288 | 0 |
| 14 | — | 510 | 165 | 1 | 8 | 312 | 0 |

## engaged kid, day by day (ruling)

| day | bought | Spark | Parts | Blueprints | Greens | Treats | presents |
|---|---|---|---|---|---|---|---|
| 1 | windmill L1, research-bench L1, research bright-bulbs, rail-depot L1, rail to heap 1, research sorting, clockwork-beacon L1 | 17 | 5 | 2 | 32 | 0 | 0 |
| 2 | sorter L1, research wrapping, gift-wrapper L1, rail to heap 2, research tidy-rails, windmill L2, research-bench L2 | 70 | 39 | 3 | 20 | 78 | 0 |
| 3 | rail-depot L2, sorter L2 | 151 | 113 | 0 | 8 | 154 | 1 |
| 4 | — | 238 | 231 | 0 | 8 | 212 | 2 |
| 5 | — | 325 | 349 | 0 | 8 | 270 | 3 |
| 6 | — | 412 | 467 | 0 | 8 | 328 | 4 |
| 7 | — | 499 | 585 | 0 | 8 | 386 | 5 |
| 8 | — | 586 | 703 | 0 | 8 | 444 | 6 |
| 9 | — | 673 | 821 | 0 | 8 | 502 | 7 |
| 10 | — | 760 | 939 | 0 | 8 | 560 | 8 |
| 11 | — | 847 | 1057 | 0 | 8 | 618 | 9 |
| 12 | — | 934 | 1175 | 0 | 8 | 676 | 10 |
| 13 | — | 1021 | 1293 | 0 | 8 | 734 | 11 |
| 14 | — | 1108 | 1411 | 0 | 8 | 792 | 12 |

## What the model leaves out

- build income (Timber, Stone, Greens) is the Cozy patch economy's (the fuel model's spare share on a 4-seat Cozy map), on top of the Scrap Heap gatherers: a Clockwork Isle's own land income is a later lane's
- every build stands on a free homestead next to home; wires and rails are laid at the tile counts the plan gives, each machine powered as soon as its wires are down
- gatherers get no match bonus and the Keeper never gathers Parts by hand; a rail-joined gatherer is always within the rail’s reach of the Depot; the Greens gatherer works owned meadow from day 1
- a missing Glimmer (the Beacon) is swapped for at the trading post (`GLIMMER_SWAP`) the session the rest of the cost is covered; exploring finds none
- no upkeep (Wave 1 has none); nothing is sold, so Heart Coins are not modelled; a run that ends short of its plan is shown, not padded
- one Windmill each; its tile’s wind is the plan’s, all fortnight (Wave 1 has no wind fronts)
- the Sorter always settles before the Gift Wrapper (`SETTLE_ORDER`); the server puts eaters last and keeps row order between two eaters, so the Wrapper may find a few more Treats here than there
