# Third-party assets

Every asset not made for Heartpatch must be **CC0** or clearly licensed for commercial use (CLAUDE.md). Record each one here.

| File       | Source | Author | License | Notes                                                                                           |
| ---------- | ------ | ------ | ------- | ----------------------------------------------------------------------------------------------- |
| `apps/client/src/audio/samples/glint.m4a` | [Starter-Kit-Match-3 `sounds/tile-match.ogg`](https://github.com/KenneyNL/Starter-Kit-Match-3/blob/4ddb3d2a50cbf247c79cafe9e7884d7d8f99c012/sounds/tile-match.ogg) | Kenney (kenney.nl) | CC0 1.0 | Big moments' glassy mallet (#653). Mono AAC 96 kb/s, peak -3 dBFS, 30 ms fade out. |
| `apps/client/src/audio/samples/coin.m4a` | [Starter-Kit-3D-Platformer `sounds/coin.ogg`](https://github.com/KenneyNL/Starter-Kit-3D-Platformer/blob/3fa8a04b1c01ab23db43123d4ce814a34c3fc7f0/sounds/coin.ogg) | Kenney (kenney.nl) | CC0 1.0 | Big moments' sparkle chirp (#653). Same processing. |
| `apps/client/src/audio/samples/knock.m4a` | [Starter-Kit-City-Builder `sounds/placement-a.ogg`](https://github.com/KenneyNL/Starter-Kit-City-Builder/blob/4535092b740b378b700efd9df9e27a631815b84a/sounds/placement-a.ogg) | Kenney (kenney.nl) | CC0 1.0 | The chest latch and the Heart Charm's knock (#653). Same processing. |
| `apps/client/src/audio/samples/thrum.m4a` | [Starter-Kit-City-Builder `sounds/removal-a.ogg`](https://github.com/KenneyNL/Starter-Kit-City-Builder/blob/4535092b740b378b700efd9df9e27a631815b84a/sounds/removal-a.ogg) | Kenney (kenney.nl) | CC0 1.0 | A power door's and a room's low thump (#653). Same processing. |

Music and most sound effects (#25) are synthesised in the browser by `apps/client/src/audio/` (Web Audio), original to this repo. The big moments (#653) layer the four short CC0 hits above, tuned and mixed with the synth at play time (`audio/recorded.ts`). Each repo's README says: "Assets included in this package (2D sprites, 3D models and sound effects) are [CC0 licensed](https://creativecommons.org/publicdomain/zero/1.0/)" (the kits' code is MIT; only their sound files are used). All other art (procedural meshes, `apps/client/public/favicon.svg`) is original to this repo.
