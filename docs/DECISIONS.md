# Heartpatch — Decision Log

> Product and process decisions made with the project owner, with the reasoning, so parallel sessions don't re-open them. The design doc and tech spec hold the resulting rules; this file explains **why**. Add new entries at the bottom.

## 2026-10-02 — Kickoff

### Scope and schedule
- **Phase 1 keeps its full scope.** Nothing is cut or shrunk.
- **The Halloween window is extended for 2026** (to Nov 9, `// TUNE:`) so the launch gets a full Halloween run if work slips past Oct 31. Season windows may overlap (design doc §15).
- **Order:** work the critical path first (#1 → #2 → #3 → #4 → #5 → #7 → #13 → #15 → …). Large standalone issues (#46 cinematic, #45 Boutique, #25 audio) fill gaps in parallel.

### PR workflow
- **Every PR is reviewed by the `reviewer` subagent** (`.claude/agents/reviewer.md`): a senior engineer persona with deep TypeScript and game-development experience. It runs the checks itself and returns APPROVE or REQUEST CHANGES.
- The author fixes or answers each finding with evidence; a **fresh** reviewer instance re-reviews with the prior findings and responses. If the same point is still contested after 3 rounds, escalate to the project owner. *(Superseded by "Usage, models and supervisor handoff", 2026-10-02: 4-round cap, escalate to the coordinator.)*
- **Once the reviewer approves and CI is green, the coordinating agent merges.** The final verdict is posted as a PR comment for the record.

### Parallel sessions and drift
- The coordinating agent starts and coordinates parallel sessions, **2–3 issues at a time**, only after the scaffold (#1) has merged and only for issues that touch separate folders.
- **Shared contracts land on `main` before dependent work splits off:** `game_events` types, the error-code enum, the WebSocket envelope, hex coordinates, data schemas.
- **Drift control:** lint rules and import boundaries enforce standards automatically; the reviewer checks consistency with existing `main` patterns and the style guide; the coordinator merges the latest `main` and re-runs CI before every merge; a drift audit sweeps `main` every ~5 merges or weekly. Drift is fixed with a small follow-up PR **and** a new lint rule or doc update so it can't recur.
- Content issues most at risk of story drift (#10, #24, #43, #46) don't run at the same time.

### Deployment
- **Build towards a workable version before deploying.** Client work is verified with Playwright (WebKit, iPhone/iPad viewports) and PR screenshots. *(Deploy timing superseded by the 2026-10-02 audit entry, decision E; Playwright verification still applies.)*
- When gameplay and visuals are ready to test on a real device (after #6, #7, #9), the coordinator walks the owner step by step through AWS account creation, Lightsail setup and the GoDaddy DNS change, then lands #27. *(Superseded by the 2026-10-02 audit entry, decision E.)*

### Devices and playtesting
- Playtest devices: **iPhone 14+** and **iPads from the last ~4 years**. Default quality tier high; WebGPU primary with WebGL2 fallback. The spec's lower performance floor stays as a safety margin. *("WebGPU primary" superseded by the 2026-10-02 audit entry, decision E: WebGL2 default. Devices and tier still apply.)*
- The owner playtests with their kids. **Gameplay must be easy to pick up** (style guide §3).

### Content
- **The coordinator drafts all content** (squishies, Sprout's lines, clothing, titles, quick messages). Tone: **cozy, cute, playful and funny**; seasonal squishies tie into that season's activities. See `docs/STYLE_GUIDE.md`.
- Content merges after reviewer approval; the owner gets one combined content review before the first deploy.

### Audio
- **CC0 assets for music and SFX, plus procedural synthesis for squishy voices**, at professional quality (tech spec §15). A dev sound gallery lets a human judge by ear; a paid royalty-free music pack is the fallback only if CC0 options fall short.

### Docs conflicts resolved
| Topic | Decision |
|---|---|
| Health endpoints | `/api/v1/health` (liveness) and `/api/v1/ready` (readiness); container health checks use `/health` only; deploy also checks `/ready` once and rolls back if it fails |
| Event table | `game_events`, written in the same transaction as the change; per-map gap-free `seq` via `maps.event_seq` |
| Initial tables | #2 designs the core spine (users, sessions, maps, map_members, tiles, squishies, game_events); feature tables arrive with their issues |
| Care actions | Feed, pet, play. Training = Training Grounds building; grooming returns with squishy dress-up |
| Owner mute | Deferred to Phase 2 with free chat |
| Recovery codes | One active hashed code; a fresh one after each use; plus an operator CLI reset for players with no map owner |
| Hollow Man vs "absence is not punished" | Hearthfires store up to 5 nights of fuel (burn one per nightfall) — teaches planning ahead; squishies at home behind a lit fire are always safe |

## 2026-10-02 — Session reporting

- **Sessions report; the coordinator doesn't poll.** Build sessions report milestones to the coordinator themselves (PR opened, ready to merge, blocked, CI red), as required in `CLAUDE.md` → Workflow and repeated in every session brief. No scheduled check-ins.
- **Why it's in CLAUDE.md:** sessions rightly treat messages relayed from another session as information, not authority, and declined reporting requests sent that way. Reporting therefore lives in the instructions each session starts with.
- **Backstop:** the coordinator subscribes to every PR, so CI results, comments and merges arrive as GitHub events, and it is notified if a session's turn fails. Both are event-driven, not polling.

## 2026-10-02 — Architecture and product audit

An adversarial audit (top game-architect / game-PM persona) reviewed the docs, code and roadmap. The owner approved these changes; the design doc and tech spec carry the rules.

- **A. The multiplayer game never waits on the tutorial.** The server setting `HP_TUTORIAL_REQUIRED` lets new accounts create or join maps before the tutorial exists. The tutorial (#24) no longer depends on the cinematic (#46), wardrobe (#43) or milestones (#44); its final steps arrive once those exist. Issues that bundled client and server work (#5, #17, #22) shed their false dependencies on client rendering, so the server parts can start earlier. *Why:* #24 sat at the end of an 11-issue chain and gated all play.
- **B. Family-safe PvP.** A map-owner **PvP mode**: On / **Gentle (default)** / Off, with a per-defender daily tile-loss cap and reduced rewards for challenging much smaller players. Every home ring is guaranteed Timber, Stone, Emberwood and a farm plot. *Why:* an older sibling could strip a younger one's land, then their fuel, then their squishies.
- **C. The Hollow Man is a planning challenge, not a nightly tax.** Tile defenders stand watch and aren't exposed. Rescue can start from anywhere, and Heartdust from rescues is capped per day. *Why:* holding territory would otherwise cost a squishy every night, and exposure could be farmed.
- **D. Family-only signup.** Account creation requires an operator-issued signup code (`HP_SIGNUP_CODE`). A map owner can reset only members whose maps are all theirs; other resets go to the operator, and resets revoke sessions. *Why:* "invite-only" covered maps, not signups, and owner resets could take over accounts across maps.
- **E. WebGL2 default, earlier device testing.** WebGL2 is the Phase 1 renderer and WebGPU is opt-in. This **supersedes** "WebGPU primary" in the kickoff entry. Deploy (#27) happens **right after #6 merges**, so the test scene reaches real iPhones and iPads within days. This **supersedes** "deploy after #6, #7, #9". No MSAA, and render only on change, to protect memory and battery. *Why:* CI can only exercise WebGL2, and the riskiest unknowns (Safari GPU memory, heat, home-screen app behaviour) must surface early.
- **F. Account-level economy.** Patch Coins, wardrobe, milestones and titles belong to the account, with daily earning caps. Map-play milestone progress counts only on maps with 2+ active members. *Why:* per-map coins feeding an account wardrobe, plus unlimited maps and accounts, made a farm.
- **G. Care without chores.** Diminishing returns after the first few care actions per squishy per day, and a daily cap on coins from care. *Why:* per-squishy cooldowns made care a screen-time contest.
- **Technical fixes (no owner decision needed):** RNG state stays server-side while battles run, and the client gets a public view. Wild spawns are fixed per tile and time window, starting a battle consumes the attempt, and leaving counts as a loss. Outcome maths is cross-engine deterministic, and battles record a content version and turn log. Event consumers track their position in `event_consumers` and process `game_events` in order after commit, and WebSocket sends public views only. Secret species and forms live in server-only data.
- **Not adopted:** lighter review rounds. The owner chose full review rounds; parallelism is already being increased where dependencies allow.

## 2026-10-02 — Session lifecycle

- The coordinator **archives a build session** once its PR is merged, or once its remaining work has been handed to the coordinator (owner-approved). Archived sessions are read-only and can be reopened.

## 2026-10-02 — Battle engine (#11)

_Proposed in PR #55; the project owner confirms on merge._

- **The RNG state lives inside the battle state.** The spec writes the reducer as `(state, action, seed) → newState`; the engine uses the seed once (`startBattle`) and stores the sfc32 state in `BattleState.rng`, so each step is a pure `(state, action) → newState`. A stored battle is its setup (with the seed) plus its action list; `replayBattle` rebuilds it exactly.
- **AI sides pick inside the reducer** with the battle's RNG, so AI-vs-AI battles (offline raids, the balance simulator) replay from the same record.
- **Synergy multiplies damage once, for the attacker** (design doc §6 formula), rather than also scaling stats, so it isn't counted twice.
- **Bit-identical maths on every engine** (owner-approved): outcome maths uses only `+ − × ÷` and `Math.floor/min/max/abs` (correctly rounded IEEE 754, no FMA), never `Math.pow`, `**`, exp, log or trig, and floors to integers before state. So V8 (server) and JavaScriptCore (Safari previews) agree to the bit.
- **Every battle carries a content hash** (owner-approved): a fingerprint of the outcome-affecting data and rules. Steps and `replayBattleRecord` refuse other content, and the stored record keeps the result and resolved log, so battles stay explainable after re-tuning.
- **`rng` and `seed` never leave the server.** Anyone holding them can predict every future roll. Send clients `clientBattleView(state)`, which leaves out the RNG state.

## 2026-10-02 — Usage, models and supervisor handoff

- **Models (owner decision):** build sessions that write code and reviewers on code PRs use the strongest model (Opus). Docs-only reviews, drift audits and simple content/docs work use **Sonnet 5.5**. *Why:* code reviews have caught real bugs every round; the rest is cheaper without losing much.
- **#13 (battles) runs on Fable (owner decision, 2026-10-02).** The #13 build session uses Fable; its code reviewers stay on Opus. *Why:* #13 is the most rule-heavy Phase 1 lane and mistakes there are costly to unwind. Fable currently costs about 2.5× Opus per token, so the supervisor flags #13's cost against a higher bar (about $30, not $20) and reports how it compares with the Opus lanes.
- **Fresh supervisor (owner decision):** when the supervisor's context gets large, a new supervisor session takes over with a compact handoff. *Why:* every wake re-reads the whole context, so a long-running supervisor becomes the biggest cost. The process lives in `docs/COORDINATOR.md` so it survives the handoff.
- **Review loops are capped at 4 rounds** (proposed in PR #63; owner confirms on merge) before the build session reports `blocked` to the supervisor, who escalates to the owner if needed; and the supervisor avoids mid-flight scope changes unless they're blocking contracts.

## 2026-10-02 — Production deploy (#27)

_Proposed in PR #59; the project owner confirms on merge._

- **`TRUST_PROXY=true` trusts exactly one private-network hop** (the direct peer, only if it's a private or loopback address, i.e. Caddy on the Docker network), not every `X-Forwarded-For` entry. *Why:* trusting every hop lets a client pick its own IP and dodge per-IP rate limits. A numeric hop count (`trustProxy: 1`) can't be used: Fastify 5 deliberately treats it as "trust nothing".
- **The deploy pins the server's SSH host key** in a fourth secret, `LIGHTSAIL_KNOWN_HOSTS`, instead of trusting whatever answers on first connect.
- **SSH stays open to all IPs** in the Lightsail firewall, because GitHub-hosted runners deploy from a large, changing IP pool. It's protected by key-only auth, a separate deploy user with one restricted key, and fail2ban.
- **Only `main` deploys**, including manual "Run workflow" runs.

## 2026-10-02 — Maps and invites (#4)

_Proposed in the #4 PR; the project owner confirms on merge._

- **Maps are generated once, for every seat.** A new map is generated for `max_players` (4) and stored in full (terrain, nodes, guardian strength, home slots). Joiners take the next free home slot, so the map never resizes. Design doc §3's smaller 2- and 3-player sizes aren't used yet. *Why:* players join one at a time after creation, and regenerating would move everyone's land.
- **Leaving frees the seat and the land.** A removed (or leaving) member is archived; their tiles go back to neutral and their home slot is free for the next player. A returning player gets a fresh home base. *Why:* otherwise a removed player would hold one of the 4 seats forever.
- **The owner can't leave or be removed.** Ownership transfer isn't in Phase 1.
- **Join requests and invite codes write no game events.** Only the owner sees them; game events are for map state every member sees.
- **Repos take a transaction** (`Database | Transaction`) and services run multi-repo commands through `repo.transaction` (which wraps `withTransaction`); `buildApp` takes `{ db, clock }` (coordinator's drift audit). The per-map "seats" lock is the owner's `map_members` row, so seat changes never lock the busy `maps` row early.
- **Owner resets lock the account.** The reset-scope check (decision D) and the reset run in one transaction holding the member's `users` row, which joining (request and approval) and creating a map also lock, so a reset can't race the member joining or making another map.

## 2026-10-02 — Procedural squishies (#9)

_Proposed in the #9 PR; the project owner confirms on merge._

- **The body and part registry is the species-visual contract.** `BODIES` and `PARTS` (`packages/shared/src/data/visuals.ts`) hold every shape a species can use; `species.visual.body` and `visual.parts` point at their ids and `checkGameData` checks them (known ids, no part twice, one part per slot). Ids are never renamed. A new body or part is a data entry; only a new part `shape` (primitive) also needs a client builder. *Why:* #10 writes the roster against fixed ids, and content shouldn't need engine changes (CLAUDE.md rule 5).
- **Every squishy has eyes.** A species visual must include a part in the `eyes` slot. *Why:* the face is what makes them cute; a faceless blob reads as a rock.
- **Look variation is seeded per squishy, on the client.** `squishyParams(species, instanceId)` derives proportions, colour, placement and breathing from `deriveSeed('squishy', speciesId, instanceId)` with arithmetic only, so every player (V8 or Safari) sees the same squishy. It's cosmetic, so it isn't server-authoritative; stats variance stays server-side.
- **Squash and rim light are GLSL only for now.** They run in a Babylon material plugin on the WebGL2 default. Under the opt-in WebGPU renderer the plugin isn't attached, so squishies render still and without the rim until a WGSL port (tech spec §6).
- **Detail levels:** the map always uses low detail; close-ups use high detail unless the quality governor has dropped to the low tier (`lodFor`).
- **The squishy gallery is a separate dev page** (`/gallery.html`), never in the production build, so it doesn't touch `main.ts`.

## 2026-10-02 — Tutorial framework (#47, server and shared)

_Proposed in the #47 PR; the project owner confirms on merge._

- **The event consumer wake-up is a hook in `appendGameEvent`.** `startJobs` installs it (`setEventWakeup`); it runs pg-boss `send` on the command's own transaction for every consumer that reads that map kind. With no jobs running (tests, ops tools) nothing is enqueued and the periodic catch-up finds the events later. *Why:* the wake-up must commit with the event (tech spec §7), and `appendGameEvent` is the one place every event is written.
- **Consumers are woken per map kind.** Each consumer lists the map kinds it reads (the tutorial reads `tutorial` maps only), so multiplayer commands don't enqueue tutorial jobs.
- **Talk-only steps complete on `tutorial.acknowledged`.** The player's "got it" tap on Sprout's welcome or graduation is an intent the server records as a game event, but only for the current step and only if that step's `completeOn` is `tutorial.acknowledged`; gameplay steps complete on the real module's events. *Why:* steps stay data with one completion path, and the client can't tap past a gameplay step.
- **The step engine writes `tutorial.advanced`** (a system event on the tutorial map) when it moves a player on, so the client hears it over live sync instead of polling. Steps can never complete on it.
- **A run is the player's active membership on a tutorial map.** Replay and skip archive the old membership (decision: archive, don't delete), so late events on an old run change nothing. Finishing keeps the finished Glade's membership, so its last `tutorial.advanced` still reaches the player.
- **Start, replay and skip.** `start` begins the first run or returns the one going; once finished, a new run is an explicit `replay` (from Settings, any time). `skip` needs a first completion (design doc §26). `tutorial_completed_at` is the first completion and replaying never moves it, so rewards are granted once.
- **`tutorialOverrides` is shared data read through `gameplayOverrides(map.kind)`.** Gameplay modules call it instead of branching on the map kind. Rules the design doc fixes (sure capture, the Hollow Man takes nothing) are literals in the schema; timers and opponent levels are tunables.

## 2026-10-02 — Secret species are server-only data

_Proposed in the secret-species Chore PR; the project owner confirms on merge._

- **Secret content lives in `packages/shared/src/data/server/secret-species.ts`.** `ServerGameData` holds `secretSpecies`, `secretMoves` and `secretEvolutions`. Secret species and moves use the public row shapes (visual included), so a species can be sent to a player once they meet it. A row there needn't be `rarity: 'secret'`: a hidden evolution form can be `epic` or `legendary` and still be secret. `checkGameData` refuses `rarity: 'secret'` in the public table. *Why:* the public table ships to every client (CLAUDE.md rule 6).
- **`secretMoves` too.** A move only a secret squishy knows would name it in the public move list. Moves any public species uses stay public.
- **One home for each evolution.** An evolution into a secret form goes only in `secretEvolutions` (`from` a public or secret species, `into` a secret one); `Species.evolutions` only points at public forms. Ids are unique across public and secret rows, and `checkServerGameData` checks every reference against both together. Branch weights and rare conditions join `SecretEvolution` when branching arrives (Phase 2).
- **Server battles use `serverBattleData(GAME_DATA, SERVER_GAME_DATA)`** (`@heartpatch/shared/server`), so the content hash covers secret rows. A client can't recompute that hash from public data, and doesn't need to: the server checks it.

## 2026-10-02 — Installable app (#26)

_Proposed in the #26 PR; the project owner confirms on merge._

- **`vite-plugin-pwa` in injectManifest mode** (tech spec §3): Workbox writes the build's precache list into our own worker (`apps/client/src/pwa/sw.ts`), which owns the caching and update rules below. No Workbox runtime ships to players. Icons, launch screens and the manifest are drawn by `apps/client/tooling/pwa/` at build time (signed distance fields, no third-party art), not kept in `public/`; launch screens aren't precached, because iOS reads them once, at install.
- **The shell version is a content hash, not `APP_VERSION`.** The cache is `heartpatch-shell-<12 hex>`, hashed from every precached URL and Workbox revision. A deploy that only changes the server keeps the phones' cache, so kids don't re-download the 1 MB+ engine on cellular for nothing. Any shell change makes a new cache, and old ones are deleted on activate. index.html is cached as `/`, the URL players open, and redirected responses are never cached (browsers refuse them for page loads).
- **No stale shells.** Page loads are network-first, so every launch or reload gets the newest `index.html` and bundles; the cached shell is only for offline, error or slow (4 s, `// TUNE`) loads. A new worker never swaps code under a running game. It takes over:
  - at launch, if it installed while the app was closed;
  - silently, if the page already runs its version;
  - when the player taps "Update" on "Ooh, a new Heartpatch is ready!";
  - otherwise, automatically when the player returns after 5+ minutes away (`// TUNE`), so an app left in memory for days can't keep running an old shell against a new server.

  Checks run on launch, on return to the app, and every 30 minutes. `/api` and `/ws` are never handled by the worker (CLAUDE.md rule 1).
- **Production builds only.** The dev server never registers the worker (it would serve stale modules); e2e checks it against `vite preview` of a real build.
- **Status bar `default`:** dark status text on the theme colour, readable over the pastel game. `black-translucent` would draw the game under white status text.
- **The Add to Home Screen guide sits under the login card**, so a new player signs up first and then sees it. It shows until "Got it!" is tapped.

## 2026-10-02 — Map rendering (#7)

_Proposed in the #7 PR; the project owner confirms on merge._

- **The map view says which event it's up to date with** (coordinator-approved shared contract change): `MapView.seq`, read with the map, members and tiles in one read-only `repeatable read` snapshot. The client subscribes from it and, on `ws.resync`, refetches and subscribes from the new view's seq. *Why:* without it the client can't follow the documented resync flow; subscribing from 0 replays everything and, past the replay window, gets `ws.resync` on every try.
- **Member changes refetch the map view instead of being applied on the client.** A join, leave or removal changes a whole home ring (and releases land) in ways only the server knows, so the client stops live events, refetches, and follows on from the new seq. Small, self-describing events (settings now, tile events with #13) are applied directly. *Why:* the client never re-implements ownership rules (CLAUDE.md rule 1).
- **Scenes are swapped on the running engine.** Opening a map disposes the current stage and mounts the map's on the same renderer; a GPU-loss rebuild mounts whatever is on screen.
- **The tile panel doesn't show guardians yet.** `PublicTile` has no public guardian field (guardian strength hints at secret spawns, tech spec §8); the panel adds them once one exists.

## 2026-10-02 — Tutorial client (#47)

_Proposed in the #47 client PR; the project owner confirms on merge._

- **The Glade is drawn by the map screen** (coordinator-approved server change): `GET /maps/:id/view` alone accepts the player's active tutorial run; every other maps operation still hides tutorial maps. *Why:* tech spec §7, the tutorial runs on normal map machinery, so one view path.
- **The tutorial layer is DOM and CSS over the canvas.** The dim is one element's box-shadow; four blocker rects around the spotlight swallow taps; no extra render passes. Talk-only steps block everything but Sprout's bubble; a gameplay step whose target can't be found leaves input open, so it can never trap a player.
- **Highlight targets:** DOM targets opt in with `data-tutorial-target="<id>"`; canvas targets are registered by the scene that draws them (`tutorial/highlight-targets.ts`) as their gameplay arrives.
- **It opens by itself** only for a run already going (resume) or when `HP_TUTORIAL_REQUIRED` is on and it isn't done. Otherwise the lobby offers "Meet Sprout", "Later" is always offered, and the lobby is never blocked. Replay lives in a new lobby Settings screen; "Skip it" shows only on a run after a first completion.
- **Progress follows `tutorial.advanced` on the run's own socket**, from the run's start, taking only the advance from the step on screen; if none comes within a few seconds the client asks `GET /tutorial`. While the Glade is drawn that's a second socket next to the map screen's (two of the five per player): the tutorial keeps working when the Glade can't load, and the map screen stays untouched. Feeding it from the map screen's socket is a later tidy-up.
- **The tutorial never traps a player.** "Log out" sits above the tutorial layer, and a step this app doesn't know yet (newer server data) leaves input open with a "Check again" button.
- **Sprout is procedural and seeded per player** (`procedural/sprout/`, `deriveSeed('sprout', userId)`), not a species. It floats still and only hops (a short Babylon animation) when it speaks, so an idle scene stays idle.
- **Update hold** (`pwa/update-hold.ts`): screens that show something once (a new recovery code; the owner's password reset) hold updates, and update-flow never reloads while held; a reload that came due waits until release.

## 2026-10-02 — Battle API and battle UI (#13)

_Proposed in the #13 PR; the project owner confirms on merge._

- **The current engine state is stored, and the record replays to it.** `battles` keeps the seed, setup and action list (the replay record), plus the current `BattleState` with its RNG, and once over the result and resolved log. Each action locks the row, steps the stored state once and saves it; tests check `replayBattle(setup, actions)` equals the stored state. *Why:* resuming after a refresh is one read, and a 50-turn replay on every tap buys nothing.
- **The player is always side `a`; the client sends a `PlayerBattleAction`** (`move`, `swap`, `replace`, `forfeit`) with the view's `turn`, and the server builds the engine's `BattleAction` for side `a`. A client can never name a side or pass a whole turn, and a stale submit is `CONFLICT` rather than the next turn's move. A submit that never reached the server is sent once more with the same `Idempotency-Key` (`lib/idempotency.ts`, `idempotency_keys`), so a flaky connection can't double-apply.
- **`ClientBattleViewSchema` is exactly `clientBattleView(state)`**, and the API parses every view through it on the way out, so `rng` can't leak by accident; `seed` is on the `PlayerBattle` envelope and null until the battle ends. `speciesDefs`/`moveDefs` ride the envelope, next to the view, for species the public tables don't have (a secret squishy the player just met).
- **One active battle per player per map; starting again resumes it.** Leaving the screen keeps the battle; it's there on the next visit. (Design doc §6 "leaving counts as a loss" is for tile battles, which consume an attempt; a wild encounter costs nothing to walk away from and come back to.)
- **A content-hash mismatch ends the battle as `no-contest`** on the next read or action: no winner, no XP, the state kept as it was, `battle.ended` with `reason: 'no-contest'`. Wild battles cost no attempt; tile battles (#15) refund theirs at that point.
- **Dev-only grants** (`HP_DEV_SQUISHY_GRANTS`, refused in production) hand a player a squishy and start a battle against a chosen wild squishy, through the same `startAgainst` spawns will call. The real acquisition rules (wild spawns and capture, the tutorial's starter) are #14's and #24's; nothing here decides them.
- **The battle camera is the map camera.** The arena is a `SceneBuilder` on the shared stage (tech spec §6: one engine, scenes swapped), with the squishies at close-up scale and pan all but locked; a dedicated battle camera can come with polish.

## 2026-10-02 — Keepers (#42)

_Proposed in the #42 PR; the project owner confirms on merge._

- **A Keeper is an account-level `keepers` row** (coordinator-approved shared contract): base, hair colour, eye colour and starter outfit, all ids from shared `KEEPER_DATA` (8 bases, 9 hair colours, 6 eye colours, 6 outfit palettes). `KeeperConfigSchema` checks the shape and the server checks every id against the data (`VALIDATION_FAILED` otherwise). Picking a new base starts from that base's own colours. Changing it is free, any time (design doc §23).
- **Picked after signup, before anything else** (coordinator-approved gate): the client shows the picker right after "I saved it!" and only then hands the player to the tutorial and lobby; the cinematic (#46) slots in after it. On the server, `HP_KEEPER_REQUIRED` (default `true`) makes creating or joining a map need a Keeper, checked before the tutorial gate. Starting the solo tutorial isn't gated: nobody else sees the Glade, and the client never gets there without a Keeper.
- **Other players see it** on `MapMember.keeper` (coordinator-approved), null for a member who never picked (only with the gate off). A change shows on others' maps at their next view fetch; a live `member.updated`-style event is a follow-up.
- **Wardrobe sockets are the contract #43 builds on** (coordinator-approved): `WARDROBE_SLOTS` = hat, hair-accessory, top, bottom, shoes, back, held, costume. Every base has a socket per slot with an anchor (two mirrored ones for shoes; `held` is the right hand) and the size of the body part it sits on. An item is primitive pieces in socket units, so one item fits every base and nothing is made per body type. A costume hides the other items and tucks the hair away. The item shape lives in the client for now (`procedural/keeper/keeper-items.ts`); #43 can move it into shared clothing data.
- **Procedural and seeded by the config**, like squishies: pure params (`keeperParams`, `+ − × ÷` and `Math.sqrt` only) with a pinned hash checked in Node and in the browser, so the same config is the same Keeper on every engine. Hairstyles are one builder per style; bases are data.
- **Drawn like squishies, cheaper:** `KeeperField` shares one mesh per primitive across every Keeper (thin instances: five meshes plus shadows, however many Keepers) and reuses the squishies' squash shader for cheers. Keepers never breathe, so an idle Keeper never wakes the renderer; they hop or wince only on battle log events. Keepers lean back a little so their faces show under the steep map camera.
- **Where they stand now:** the map shows each member's Keeper beside their Heart Seed (low detail, no shadow); battles show the player's Keeper at their squishy's back, nearer the camera and off to the side, clear of the nameplates. Home-base idling and wandering arrives with home base (#18); profile cards and the close-up view's edge-of-frame Keeper come with the screens that show them.

## 2026-10-02 — Wild squishies and capture (#14)

_Proposed in the #14 PR; the project owner confirms on merge._

- **A befriended wild squishy is gone for that player only, for the rest of its spawn window.** Each tile's squishy is fixed per window (tech spec §8) and nothing is stored until someone battles it; the battle row keeps its tile and window, and a captured one is skipped for that player until the next window. Other members can still find theirs. *Why:* per-player is kinder (an older sibling can't empty the map before a younger one wakes up) and needs no shared spawn state.
- **Where to look: your own land and the tiles next to it** (the claiming reach, design doc §11). "Find a squishy" picks the nearest one (own land first, then the edge, in tile order), and the API also takes a chosen tile. `GET /maps/:id/wild` lists which of those tiles have someone this window: tiles only, never a species or a later window (CLAUDE.md rule 6).
- **Capture is a turn choice in the engine** (`{ type: 'capture' }`, the player's whole turn, after swaps and before moves). The chance comes from shared battle rules (`captureChance`: `atFull`% at full energy rising in a straight line to `nearlyOut`% at 1 energy, times a rarity share) and is rolled once with the battle's own RNG, so a capture replays like any other turn. A catch ends the battle (`reason: 'captured'`, the player wins) and the squishy joins the player at its battle level, element and feeling. A miss still costs the turn, and the wild squishy moves. `sure: true` (server-set, from `tutorialOverrides.captureAlwaysSucceeds`) skips the roll. Only wild battles allow it (`CAPTURABLE_BATTLE_KINDS`), and only from an AI side.
- **One Heart Charm per try, in the step's transaction.** The charm (`consumeItems`, #17), the engine step, the new `squishies` row, `species_seen.first_caught_at`, `battle.ended` and `squishy.captured` commit together or not at all (CLAUDE.md rule 7). A refused step gives the charm back.
- **The catalog is per player per map** (`species_seen`): starting a battle records "seen", a capture records "caught", first times kept. The page lists the public roster (unseen ones as "???") plus the secret species the player has met; the server sends a secret row only to someone with a `species_seen` row for it.
- **`squishy.captured` doesn't name the species on the wire**, like `battle.started`: a secret squishy would otherwise reach members who never met it.
- **`spawnWindowId` lives in `apps/server/src/lib/time.ts`**, next to `localDate`: shared code is lint-banned from `Intl`, which time zones need. The block maths (`spawnWindowAt`) is shared. A window's time of day is judged at its middle, so 4-hour windows run night, day, day, day, dusk, night (`SPAWN_RULES.timesOfDay`).
- **Hand-authored maps (no secret seed) spawn from the map id.** Their spawns are predictable, which is fine for a one-player Glade; real maps always have a seed.
