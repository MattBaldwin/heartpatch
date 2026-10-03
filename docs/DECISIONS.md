# Heartpatch — Decision Log

> Product and process decisions made with the project owner, with the reasoning, so parallel sessions don't re-open them. The design doc and tech spec hold the resulting rules; this file explains **why**. Add new entries at the bottom.

## 2026-10-02 — Kickoff

### Scope and schedule
- **Phase 1 keeps its full scope.** Nothing is cut or shrunk.
- **The Halloween window is extended for 2026** (to Nov 9, `// TUNE:`) so the launch gets a full Halloween run if work slips past Oct 31. Season windows may overlap (design doc §15).
- **Order:** work the critical path first (#1 → #2 → #3 → #4 → #5 → #7 → #13 → #15 → …). Large standalone issues (#46 cinematic, #45 Boutique, #25 audio) fill gaps in parallel.

### PR workflow
- **Every PR is reviewed by the `reviewer` subagent** (`.claude/agents/reviewer.md`): a senior engineer persona with deep TypeScript and game-development experience. It runs the checks itself and returns APPROVE or REQUEST CHANGES.
- The author fixes or answers each finding with evidence; a **fresh** reviewer instance re-reviews with the prior findings and responses. If the same point is still contested after 3 rounds, escalate to the project owner. *(Superseded by "Usage, models and supervisor handoff", 2026-10-02: 4-round cap, escalate to the coordinator. Confirmed in "2026-10-03 — Owner decisions": a round caused only by merging `main` doesn't count.)*
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
- **Review loops are capped at 4 rounds** (proposed in PR #63; confirmed 2026-10-03, and a round caused only by merging `main` doesn't count: see "2026-10-03 — Owner decisions") before the build session reports `blocked` to the supervisor, who escalates to the owner if needed; and the supervisor avoids mid-flight scope changes unless they're blocking contracts.

## 2026-10-02 — Production deploy (#27)

_Proposed in PR #59; the project owner confirms on merge._

- **`TRUST_PROXY=true` trusts exactly one private-network hop** (the direct peer, only if it's a private or loopback address, i.e. Caddy on the Docker network), not every `X-Forwarded-For` entry. *Why:* trusting every hop lets a client pick its own IP and dodge per-IP rate limits. A numeric hop count (`trustProxy: 1`) can't be used: Fastify 5 deliberately treats it as "trust nothing".
- **The deploy pins the server's SSH host key** in a fourth secret, `LIGHTSAIL_KNOWN_HOSTS`, instead of trusting whatever answers on first connect.
- **SSH stays open to all IPs** in the Lightsail firewall, because GitHub-hosted runners deploy from a large, changing IP pool. It's protected by key-only auth, a separate deploy user with one restricted key, and fail2ban.
- **Only `main` deploys**, including manual "Run workflow" runs.

## 2026-10-02 — Maps and invites (#4)

_Proposed in the #4 PR; confirmed by the owner on 2026-10-03 (see "2026-10-03 — Owner decisions")._

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
- **The tile panel doesn't show guardians yet** *(replaced 2026-10-03: neutral tiles get a guardian strength hint, see "2026-10-03 — Owner decisions")*. `PublicTile` has no public guardian field (guardian strength hints at secret spawns, tech spec §8); the panel adds them once one exists.

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
- **Dev-only grants** (`HP_DEV_SQUISHY_GRANTS`, refused in production) hand a player a squishy and start a battle against a chosen wild squishy, through the same `startAgainst` spawns will call. The real acquisition rules (wild spawns and capture, the tutorial's starter) are #14's and #24's; nothing here decides them. *(Answered 2026-10-03: a new player picks 1 of 3 starters, see "2026-10-03 — Owner decisions".)*
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

## 2026-10-02 — Resources, gathering and inventory (#17)

_Proposed in the #17 PR; the project owner confirms on merge._

- **The inventory contract is small, transactional and ledgered** (coordinator-set for #17 and #14, following tech spec §4): balances in `inventories (map_id, user_id, item_id, quantity ≥ 0)`, where a missing row is 0, and every change in `resource_ledger` with a reason and the id of what caused it. Other modules move items only with `grantItems(tx, owner, items, reason, refId?)` / `consumeItems(…)` inside their own transaction; `reason` is the shared `ItemChangeReason` union, which later issues extend. `consumeItems` locks the rows in id order and throws `CONFLICT` ("You need 1 more Heart Charm first!") with nothing changed if anything is short. Tests reconcile balances against ledger sums. *Why:* captures, buildings and trades must pay and get paid in the same commit as the change (CLAUDE.md rule 7), and every change needs a reason (tech spec §4).
- **Gathers are `gather_jobs` rows and announce themselves** (coordinator-approved): `gather.started` carries the tile and ready time (never the yield), so every member sees "gathering here" live; `resource.gathered` clears it.
- **A gather's yield is fixed when it starts.** The node's quantity plus any in-season extras is stored on the gather, and a gather started in season finishes after the season ends. *Why:* collecting a little late must never change what a kid gets.
- **Witch Dust is a Halloween bonus on Emberwood and Pumpkin gathers** (`gather.extras`, `// TUNE:`; coordinator-approved), because map generation places no Witch Dust nodes. A Witch Dust node or terrain can replace it later as a data change.
- **The node belongs to the tile's owner.** If a tile changes hands mid-gather, the old owner can't collect it, and the new owner's first gather there marks it `lost`. Only the current owner's gather shows as "gathering here" on the public tile.
- **One craft at a time per player per map**, inputs used up front (`// TUNE:` if kids want a queue). Seasonal recipes only start in season; leftover seasonal items stay as keepsakes (design doc §15).
- **The client counts down on the server's clock.** Every inventory reply carries `now`, so a phone with the wrong time, or a dev server on a Halloween date, shows the right time left.
- **The Bag button sits bottom left above "My patches"** and steps aside while the tile panel is open; the panel's own button gathers and collects. Not on the Tutorial Glade yet (#24 adds the gather step).

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

## 2026-10-02 — Home base and buildings (#18)

_Proposed in the #18 PR; the project owner confirms on merge._

- **Buildings are `buildings` rows on spots of the player's own home tiles** (coordinator-approved shared contract): map, owner, tile, building id and kind, level, spot, and for Hearthfires `fuelled_through` (+ `fuel_updated_at`). Each home tile has 7 spots (the middle and six around it, `spotOffset`); the middle of the Heart Seed's tile and of a node tile is taken by what stands there. One building per spot; `maxPerHome` per building in data (one Hearthfire, one Jack-o'-Lantern, two of each habitat, `// TUNE:`). Only Hearthfires and habitats are buildable now (`HOME_BASE_RULES.buildableKinds`); Training Grounds wait for their XP (#19). Building is instant (no build timer) and upgrades are a follow-up.
- **Fuel is a date, as tech spec §7 says**, not a stored count plus a timestamp: `fuelled_through` is the last map-local night it covers, and "lit" and "nights left" are worked out on read from the map clock (DST included). Adding more than fits fills it and charges only for what went in. *Why:* nothing ticks or decrements, so a nightfall run twice can't burn fuel twice (CLAUDE.md rule 4). Nightfall (#21) asks `protectsNight(fuelledThrough, night)`, and `litSafeTiles` / shared `safeTiles` give the protected tiles.
- **A lit fire protects its whole home base plus its radius, measured from the fire's own tile.** *Why:* design doc §14 says squishies at home behind a lit fire are always safe; measuring from the fire makes where you put it matter for land beyond the home.
- **The Jack-o'-Lantern Hearthfire is its own building** built from #17's crafted item, only in the Halloween window, with a bigger radius (2) in data. One already built keeps working after Halloween (keepsakes, §15; confirmed 2026-10-03, see "2026-10-03 — Owner decisions"). Taking it down gives the carved pumpkin back whole (`refundPercent: 100`); other buildings give back half their cost, rounded down, plus any fuel they hadn't burned.
- **Habitat housing is a nullable `squishies.habitat_building_id`** (coordinator-approved), `ON DELETE SET NULL`, so taking a habitat down moves its squishies out. Only the owner's own active squishies, up to capacity; a squishy in the Hollow keeps its bed. Squishies without a habitat wait by the Heart Seed.
- **A member who leaves loses their buildings** (same transaction as their tiles going neutral), so a returning player gets a fresh home base (#4 decision).
- **Everyone sees fires and habitats:** `PublicTile.buildings` (kind, level, spot, lit, safe radius), kept live by `building.placed/moved/removed/fueled`. Nights left, costs and refunds stay internal. The map draws a soft warm glow over every tile a lit fire keeps safe.
- **The home-base view is its own scene** (tech spec §6): the seven home tiles at about 4× map scale, with the map's tile, prop and Heart Seed meshes, procedural building models (one draw call per look) and the Keeper idling by the Heart Seed (#42's leftover). Squishies don't breathe there; a wander hop is an event every few seconds that draws only while it plays, so an idle home draws nothing.

## 2026-10-02 — Territory (#15)

_Proposed in the #15 PR; the project owner confirms on merge._

- **Tile battles are a battle kind, and the raid rules run in their start transaction** (coordinator-approved contracts: battle kinds `tile` and `rival-tile`, `tile_attacks`, `tile_defenders`, events `tile.attacked`, `tile.captured` and `defenders.changed`, public tile `cooldownUntil` and `defenders`). The battles service builds the battle; the territory module checks the rules under row locks and builds the other side (`startTile` + `prepare`), and settles the attempt and the capture on the battle's own transactions (`TileBattlePort`). A refused start uses nothing. *Why:* the attempt, the battle and the tile must commit together (CLAUDE.md rule 7), and battles stays the one place that runs the engine.
- **`defenders.changed`, not `tile.defenders.changed`:** the event registry names types `noun.verb` (checked by its test).
- **Cooldown counts from the start of any battle for the tile, by anyone, win or lose**, and a no-contest keeps it (only the attempt is refunded). *Why:* design doc §11 "after a battle on it"; lifting it would need another event for a rare server-side case.
- **Leaving is noticed lazily** (CLAUDE.md rule 4): a tile battle with no action for `abandonMinutes` ends as a forfeit (a loss) on the next read, action or start, never by a timer. Starting anything else ends it first, so a player is never stuck behind a battle they walked away from.
- **The daily loss cap counts challenges still going**, under a lock on the defender's member row. *Why:* two siblings challenging the same player at once could otherwise both get under Gentle's one-a-day.
- **A rival tile with nobody on watch is defended by the land's own guardians.** *Why:* a battle needs someone on the other side, and an empty tile being free would make guards a chore rather than a choice.
- **Guardians are fixed per tile per map-local day** (`GUARDIAN_RULES.windowHours: 24`, `// TUNE:`), seeded `deriveSeed(mapSeed, 'guardian', q, r, windowId)`. A retry after the 4 h cooldown meets the same team; tomorrow's may differ.
- **Gentle's 50% applies to capture rewards**, carried as `rewardPercent` on `tile.captured` for found clothing (#43) and milestones (#44). The showdown's own XP isn't scaled: the battle screen shows the engine's XP, and the squishies did the work either way. *(Answered 2026-10-03: Gentle's 50% applies to battle XP too, see "2026-10-03 — Owner decisions".)*
- **Guards stand on your land outside your home base** (home tiles can never be taken, so a guard there would only shelter from the Hollow Man). A squishy on watch still joins its owner's battles until team picking arrives.
- **Territory's tile-panel buttons join #18's `combineTileActions`**, which now also passes each feature the whole map view (territory needs neighbours, owners and the PvP mode).

**Open product questions (for the owner):** whether a new player's shield should drop early when they challenge someone; whether squishies on watch should sit out the owner's own battles. *(Answered 2026-10-03, see "2026-10-03 — Owner decisions": Gentle's 50% halves battle XP too, and a squishy is housed or on watch, not both.)*

## 2026-10-02 — Wardrobe (#43)

_Proposed in the #43 PR; the project owner confirms on merge._

- **One catalog for Keepers and squishies** (`CLOTHING` in shared `data/clothing.ts`, checked by `checkClothingData`): id, name, description, slot, rarity (common to legendary, never secret), optional season, `sources[]`, `tradable`, optional `boutiquePrice` and a visual. Keeper items use the eight `WARDROBE_SLOTS`; squishy accessories use the `squishy` slot and anchor on the crown or the neck. The #42 item shape (primitives in socket units) moved from the client into the catalog, so every item fits every base; a test builds every item on every base. Cosmetic only: the schema has no stats field, and nothing in battles reads clothing.
- **The starter set is everyone's, from the start, and never stored.** Every account owns the `starter` items (one per slot but costume, plus a squishy Tiny Bow): the wardrobe is never empty, there's nothing to backfill for accounts made before #43, and starters are account-bound (`tradable: false`). Everyday items are found all year; Halloween items only in the Halloween window. *Why:* a granted-at-signup set would need the auth module and a backfill, and a kid with nothing to try on bounces off the screen.
- **Owned clothing is one row per piece** (`clothing_owned`: user, item, source, `ref_id`, map, `acquired_at`), so a trade can later move a single piece. A unique `(source, ref_id)` means one piece per gather, capture or rescue, however often the grant is retried.
- **Outfits are `outfits` rows: preset 0 is what's worn, 1–3 the saved presets** (design doc §23 [DEFAULT: 3]). The client sends the whole set to wear; the server checks it (known, a Keeper item, one per slot, owned) and stores it in slot order. A costume hides the other pieces but they stay worn underneath, so taking it off brings them back (#42's rule). Preset names pass the name filter.
- **Others see outfits** (coordinator-approved): `MapMember.keeper` is now a `PublicKeeper` (the config plus `wearing`), and a change writes `outfit.changed` on every map the player is active on, in map id order (the lock order), so members see it live. Wearing the same thing again writes nothing.
- **Found drops are server-side tables** (`data/server/clothing-drops.ts`, CLAUDE.md rule 6): one per source (gather, capture, rescue), a percent chance then a weighted pick among the pieces that can drop here and now (seasonal pieces in season, terrain-bound ones on their terrain, by the map's local date on the game clock, so `HP_DEV_NOW` tests it). `rollFoundDrop(tx, …)` (`modules/wardrobe/drops.ts`) runs in the caller's transaction, after its state writes and before its own event (which stays the last write), and appends `clothing.found` (public: who and what, never the odds). Gathering calls it on collect; Hollow rescues (#21) call it with their own source; tile captures will. Captures can't simply call it inside the battle port: battles lock squishy rows after the port runs, and appending `clothing.found` there would take the `maps` row first (the lock-order rule in `appendGameEvent`). They need the event returned with `tile.captured` instead (a follow-up). `HP_DEV_DROP_CHANCE` (dev and test only) sets every chance, so a find can be tried on a phone.
- **Squishy accessories are stored per squishy** (`squishy_accessories`; one per squishy, owned by its owner) and shown as the additive `OwnedSquishy.accessory`. Owning a piece lets any of your squishies wear it, like a Keeper wears the same hat on every map. Nothing reads them back yet: the squishy close-up draws them and fills `OwnedSquishy.accessory` (the catalog already holds their anchors), and squishy trades clear the row (or re-check ownership on read) so a new owner never wears a piece they don't own.
- **Trying on is optimistic** (tech spec §6): a tap dresses the preview at once, and the outfit goes to the server 0.7 s (`// TUNE`) after the last tap with an `Idempotency-Key`, so flicking through hats is one request and one event. A refused outfit rolls back to the last one the server kept.

## 2026-10-02 — Care, levels and evolution (#19)

_Proposed in the #19 PR; the project owner confirms on merge._

- **Contentment is stored, not ticked** (coordinator-approved columns): `squishies.contentment_at_last_care` and `last_cared_at`; shared `contentmentAt` slides it in a straight line from the stored value to the baseline over `CARE_RULES.hoursFullToBaseline` (24 h, design doc §7) on read. A new squishy started at the baseline (0), so neglect only means no bonus. *(Changed 2026-10-03: new squishies start at contentment 50, see "2026-10-03 — Owner decisions".)*
- **Care is a log** (coordinator-approved, "a small `care_log` table"): one row per action, with the owner's account-local `day` (`users.time_zone`, not the patch's zone). It counts a squishy's actions per day for diminishing returns (the first `fullActionsPerDay` = 3 in full, then `falloffPercents` 50 / 25 / 10 %, the last repeating) and sums an account's Patch Coins from care per day across every patch for the cap (`dailyCoinCap` 10, `coinsPerFullAction` 1, full-value actions only). A care action locks the account row first so the cap can't race.
- **Cooldowns shrink to a 10 s debounce** (decision G replaced per-squishy cooldowns with diminishing returns): the old 4 h feed / 30 min pet and play cooldowns would make care a timetable. A short per-action debounce stays so one stroke or a double tap (#20's gestures) counts once; diminishing returns and the route's rate limit do the anti-spam job.
- **Coins are computed, not paid** (#45 owns Patch Coins and `coin_ledger`): `care_log.coins` and the `squishy.cared` payload carry what each action earned, so #45 can pay them out without re-deriving the rules.
- **XP maths is whole percents** (bit-identical maths): care 100–175 %, habitat 100 / 135 (element or feeling matches) / 175 % (both), care × habitat floored at 100 and capped at 300; granted XP is `floor(base × percent / 100)`. The habitat's tags are matched against the squishy's own element and feeling (its feeling can shift with care later).
- **`squishies.xp` is the total**; the curve is `perLevel × (L−1) + curve × (L−1)²` (20 and 5, `// TUNE:`; level 2 at 25 XP, 10 at 585, 20 at 2,185), up to level 100. A squishy that joined above level 1 (befriended at its battle level, dev grants) counts from its level's XP, so nobody goes down a level and the next level is the usual distance away. Stats grow with level through the existing `statsAtLevel`.
- **One way to grant XP** (coordinator-approved hook): `applyXp(tx, squishyId, baseXp, at)` in `modules/care` (multiplier, level, evolution, no events) and `appendGrowthEvents` (after the caller's own event); battles call both, so `battle.ended.xp` is the XP actually granted.
- **Phase 1 evolution** (design doc §8): at or past an evolution's level, the squishy becomes the single next form, the lowest level first, public `Species.evolutions` before server-only `secretEvolutions`. It takes the new form's element and keeps its own feeling (confirmed 2026-10-03, with a squishy already past its evolution level evolving on its next XP: see "2026-10-03 — Owner decisions"). Each evolution is a `squishy_evolutions` row (so it can be explained later), and `seen_at` drives a one-time celebration.
- **Secrets stay secret:** `squishy.evolved` and `squishy.leveled` carry only who, which squishy and the level on the wire; the care list sends a secret form's row only to its owner once it has happened. Other members see a squishy's mood on `squishy.cared`, never contentment numbers; the owner's sheet shows a hearts meter, and the XP bonus lives in an opt-in info card (style guide §2).
- **The care sheet is a DOM sheet** (`apps/client/src/care/`), opened from home base ("Your squishies") and a friend's catalog card, with Feed / Pet / Play buttons, mood, hearts, level and XP bar. The evolution celebration is a CSS squash-and-stretch with sparkles that plays once per event (nothing redraws while idle); it pops up when the player gets back from a battle or opens home base. #20's close-up view can reuse `care-view.ts` and the API.

## 2026-10-02 — Launch roster (#10)

_Proposed in the #10 PR; the project owner confirms on merge._

- **18 lines, one evolution each:** 14 everyday lines and 4 Halloween lines (Gourdon, Glowboo, Upsybat, Candlekit), base form plus one level-based evolution (design doc §8 Phase 1), 36 public species. An evolution keeps its element, feeling and season, is bigger, has a larger stat total and is one rarity step up (legendary stays legendary).
- **Only base forms spawn wild.** Wild levels are 2–6, so an evolved form there would make no sense. Evolved forms are met as **Juniper's Gap guardians** (levels 14–18), even below their own evolution level: a guardian belongs to the land, it didn't grow up there. Ordinary land is guarded by base forms.
- **Halloween species appear only in `season: 'halloween'` tables** (and carry `season` themselves, so the spawner double-checks). Every terrain also has an everyday table, so there's someone to find all year.
- **"Drawn to" a seasonal activity is approximated by terrain and time of day.** Spawns can't see buildings or what players gather, so Candlekit (Jack-o'-Lantern glow) and Upsybat (Witch Dust) come out at dusk and night where those things are found. A real "near a building" or "after gathering" spawn hook is a follow-up (style guide §4).
- **Plain counters are a tested design goal.** Fuzzbolt, Pebblesnooze, Puddlepuff and Snoozicle are commons that beat a named rarer squishy at least 70% of the time in seeded 1v1 engine battles, and a round-robin keeps every base form's win rate between 25% and 75% (`species.test.ts`). It's a sanity check until the balance simulator lands, not a replacement for it.
- **One launch secret: Heartlet → Heartbloom** (Light + Cozy), a tiny piece of the Heartpatch that never quite scattered (design doc §2). It wanders Juniper's Gap on nights (about 1 in 28 Gap night spawns), and its move Heart Glow is a secret move. *Owner sign-off: approved 2026-10-03, with Heartbloom tuned to about 60–65% sim win rate (see "2026-10-03 — Owner decisions").*
- **The `placeholder-*` secret rows stay for now.** Tests in open lanes still use them, but they spawn and guard in the live tables (Moonpuff is about 4–7% of everyday wild spawns). Moving those tests onto fixture tables and deleting the rows is a follow-up before the Halloween launch.

## 2026-10-02 — Offline defense and the raid log (#16)

_Proposed in the #16 PR; the project owner confirms on merge._

- **The challenger still plays live; the defender is always the server's AI.** In Phase 1 a rival-tile battle is played by the challenger as #15 built it, and the defending side is the engine AI in the defender's stance, whether or not they're online. "Resolves immediately" means nobody waits on the defender; there is no auto-resolve for the challenger. *Why:* the brief's reading of design doc §3 and §6; live PvP rooms are Phase 2.
- **Stance is per map** (`map_members.defense_stance`, default Balanced), like everything else about a player's land, and maps one-to-one onto the engine's `aggressive` / `defensive` / `balanced` policies (`RAID_RULES.stancePolicies`). Guardians keep `guardian`. It is read under the defender's member lock in the start transaction and stored in the battle's setup, so a later change never touches a battle going and replays need no lookup.
- **The raid log is an event consumer on `battle.ended`**, not a write in the battle's transaction. *Why:* the attempt and the tile already commit together; the log only reports them, `battle.ended` carries the end reason (a forfeit) the territory port doesn't get, and battles/territory stay unchanged. A report can lag a few seconds; it is never lost (tech spec §7).
- **One row per finished challenge on a player's land**, outcomes from the defender's side: `held` (won, or the challenger scooted home), `tie`, `lost` (lost the showdown but the land had already moved on), `taken`, `no-contest`. A challenge against land whose guardians stood in (nobody on watch) is still the owner's raid, with no stance.
- **Replays reuse #13's view.** `playerBattleView` (extracted from the battles service) builds both ends from the defender's side; the battle screen's `watch(start, end)` opens the first turn and plays the finished log through its normal playback. A raid from before a re-tune isn't replayable (its stored log stays the truth, tech spec §8).
- **The defender's catalog meets the challenger's squishies** when the raid is logged, so a replay can name a secret species without sending it to someone who never met it (CLAUDE.md rule 6).
- **"Next login" is "next time I open that patch":** the report opens by itself when there's something new, and closing it marks it seen.

## 2026-10-02 — The Hollow Man (#21)

_Proposed in the #21 PR; the project owner confirms on merge._

- **Nightfall is a sweep plus one job per map and night** (coordinator-approved: `hollow_events`, one row per map per night). Every minute (and at boot) a sweep asks which maps' latest 21:00 (map time, DST included) hasn't run, and enqueues `nightfall` keyed `mapId/night`. The night's row is claimed first in the nightfall transaction, so a retry, a duplicate job or a restart takes nothing more. *Why:* one cron per map can't follow time zones and daylight saving, and the row is a stronger guard than job de-duplication.
- **After downtime only the latest missed night runs**, and a map's first night is the first nightfall after its first active member joined (game clock). *Why:* a server outage shouldn't cost a squishy per missed night, and `created_at` columns use the database clock, which a dev clock override doesn't move.
- **Where a squishy spends the night:** its habitat's tile, else its owner's Heart Seed. It's safe inside the tiles lit fires protect that night (anyone's fires, `litSafeTiles` with `protectsNight`), on watch if `isOnWatch` (decision C), else exposed. In Phase 1 habitats are only on home tiles, so "exposed" means "the fire is out" until habitats or noise buildings can sit elsewhere.
- **The pick is seeded per map, night and player** (`deriveSeed(mapSeed, 'hollow', night, userId)`), over exposed squishies in id order, and never revealed. Tutorial maps take nothing (`hollowManCanTake`).
- **Rescues are a `rescue` battle kind** (coordinator-approved) started through `startRescue` and settled by a `hollow` event consumer from `battle.ended`, not inside the battle's transaction: the battles service only gains the start entry point. Shadows (secret `RESCUE_GUARDIANS`) are fixed per squishy per map-local day and sit just under the player's strongest active squishy, so a rescue is a fair fight. They look like Nookling, the year-round public shadow squishy (#10), so a rescue never shows a player a secret species. **If every squishy is in the Hollow, the one being rescued fights** (it helps find the way out), so a rescue is always possible.
- **Heartdust is capped per player per map-local day** (`HOLLOW_RULES.rescue.rewardsPerDay`, `// TUNE:` [DEFAULT: 1]); rescues past it still bring the squishy home. The day is the battle's end (game clock). A rewarded rescue also rolls #43's `rescue` clothing drop (`rollFoundDrop`); capped rescues don't, so the cap covers every rescue reward.
- **Who hears what:** `hollow.nightfall` tells everyone who lost a squishy, never which; `squishy.hollowed` and `squishy.rescued` go only to the owner. The morning report lists the last 3 nights (`reportNights`) per player; which one a device has shown is remembered in that device's `localStorage` (a per-viewer convenience: a new phone may show it once more).
- **Why "seen" differs from the raid log's.** A raid is one row for one defender, so `raids.seen_at` is cheap and exact, and it also feeds the unseen count that opens the report on any device. A Hollow night is one row per map (`hollow_events`, every member's result in `outcomes`) with nowhere per player to put a flag, and showing a night's card twice is harmless, so a device remembers it in `localStorage`. If the Hollow report ever needs to agree across devices, give it a per-player seen row like the raids. The raid sheet is being renamed "Raid report" (Chore PR) so the two read alike.
- **On screen:** at night (21:00–6:00 map time, from the server) the map's sky and sun dim to a lavender dusk, so the fires' warm glow stands out. When night falls live he visits once where the player is looking (a little up-screen), flickers, hesitates and fades in about 4.5 s, the only time the map draws continuously; the report card waits until he's gone. A rescue opens the battle screen ("Shadows from the Hollow want to play!", "Welcome home!").
- **Dev nightfall** (`HP_DEV_SQUISHY_GRANTS`) makes the next night that hasn't come yet fall now; pressing again moves on a night, so fuel runs down as it would.

**Open product questions (for the owner), answered 2026-10-03** (see "2026-10-03 — Owner decisions"): a brand-new player gets a first-night grace of 2 nightfalls (a player who joins at 8:55 PM with a squishy and no fire yet could lose it at 9:00); shadow guardians get a dark lavender, glowing tint on the Nookling shape (they were drawn as their species).

## 2026-10-02 — Lock order (Fix PR)

_Proposed in the lock-order Fix PR; the project owner confirms on merge._

- **One event per consumer transaction.** `runConsumer` applies one event, advances `last_seq` and commits, then takes the next. *Why:* a batch held `maps` from one handler's append while the next handler locked squishies, tiles or raid rows: the reverse of every command's order, so nightfall (squishies, then `maps`) could deadlock with it. Handlers returning their events for one append per batch would also work, but it changes every handler and the helpers they call (`rollFoundDrop` appends its own event); one event per transaction needs no handler change and keeps "a crash only delays, never loses" as it was. The cost is a commit per event, which these volumes don't notice.
- **The lock order is written down** (tech spec §7 "Lock order"), including squishies always in id order. `lockSquishies` (battles), `moveOutAll` and `deleteOwned` (buildings; deleting a habitat moves its residents out through the foreign key) now lock squishies in id order; `releaseTiles` (maps, when a member leaves) and `lockHomeTiles` (buildings) lock tiles in id order, and `releaseTiles` takes the tiles before their defenders, like a capture; and gathering's `collect` locks the tile before the gather, like `start`.
- **Care and capture take a squishy and inventory in opposite orders.** Care locks the squishy, then its cost's inventory rows; a capture try locks the Heart Charm's inventory row, then (when it ends the battle) the team's squishies for XP. Safe today because the item rows differ: care never spends a Heart Charm. **#45 and #84 must not let care spend a Heart Charm** without first moving one of them to the order above.

## 2026-10-02 — Close-up view (#20)

_Proposed in the #20 PR; the project owner confirms on merge._

- **The close-up is its own scene** (tech spec §6), swapped onto the running engine like home base and battles: one squishy in a new `hero` detail level (48 body rings, the high tier only; `heroLodFor` steps down with the governor), face to face. Opened by tapping a squishy at home base, or "Up close" on its care sheet (home base, or the catalog over the map); Back, Escape or a swipe down swoops out and returns there.
- **Depth of field is a blurred snapshot, not a post-process.** On open, the view the player was looking at is drawn once, shrunk to 48 px wide, box-blurred three times on the CPU and drawn behind the squishy as a background layer. *Why:* Babylon's depth-of-field needs a depth pass and wide full-resolution blurs every frame; this costs one tiny texture and one full-screen quad, and about 7 ms once on open (the blur in a desktop container; the GPU readback is on top and needs measuring on device).
- **Gestures are care actions, decided by the server** (CLAUDE.md rule 1): boop and pinch-tickle are play, a stroke is pet, a treat dragged from Feed onto the squishy is feed. The squishy always reacts on the spot; a touch the server would only refuse (its action still in the 10 s debounce on the server's clock, already on its way, or a treat with none in the bag) gets a softer reaction and isn't sent. Feed / Pet / Play buttons stay as the visible twins (style guide §3.3).
- **Gestures go to a touch layer over the canvas,** so the stage's map camera never sees them; the close-up writes the camera pose itself before each render. Hit-testing is an ellipse projected from the camera maths (no GPU readback, so it works in WebKit CI).
- **Idle personality by feeling** (style guide §5) plays every ~6 s while nobody touches it: Joy hops, Cozy snuggles, Brave puffs up, Silly spins, Sleepy nods off, Spooky goes "boo!". Render on demand: every frame during the swoop, a reaction or an idle move; ~30 fps while it only breathes; nothing at all with reduced motion (no swoop, no breathing, no idle moves).
- **Renaming** (coordinator-approved lane): `POST /maps/:mapId/squishies/:squishyId/rename` in `modules/care`, owner only, `Idempotency-Key`, its own rate limit, every nickname through `lib/filter.ts`, and the already-listed `squishy.updated` event (`nickname` public) rather than a new type.
- **An evolution that arrives while the close-up is open is celebrated there** (sparkles, a big bounce, "Yay!" marks it seen); leaving the close-up for the map asks the care sheet to celebrate any other news, as returning from a battle does.

## 2026-10-03 — Owner decisions

_Decided by the project owner on 2026-10-03. They answer the open questions in the entries named below; the design doc carries the resulting rules._

- **First squishy: a pick of 3.** On joining a patch, a new player picks 1 of 3 starters, one per element family. The list is data (Puddlepuff is one). The tutorial (#24) later presents the same choice as meeting their Partner. Answers #14's "real acquisition rules". *Why:* without a squishy a new player can't battle or capture.
- **Wild-battle XP farming: a beaten wild squishy wanders off.** One a player beats without capturing is gone for that player for the rest of its spawn window, like a capture (#14). Others can still find it. *Why:* otherwise it can be re-fought for full XP all window, multiplied up to 3× by care × habitat (#19).
- **Element vs feeling balance: soften the element matrix.** Strong goes from 2× to about 1.5×, weak from 0.5× to about 0.67× (`// TUNE:`), tuned with `pnpm sim`. **Final values (#96):** elements 1.5× / 0.67×, feelings 1.35× / 0.75× (raised from 1.25× / 0.8×). Feeling counters can then blunt an element disadvantage, as design doc §5 says. *Why:* the #12 sim showed a 2× matchup wins 98–100% of equal-stat 1v1s.
- **First-night grace.** The Hollow Man skips a player for their first 2 nightfalls after joining a patch, with a cozy hint to light a fire. Answers #21's open question. *Why:* someone who joins at 8:55 PM with no fire shouldn't lose a squishy at 9:00.
- **Habitat or watch, not both.** A squishy is either housed in a habitat or standing watch. Answers the open question from #18 and #15. *Why:* a squishy that is both gets the habitat's XP bonus and the Hollow Man's protection from one job.
- **Gentle mode halves battle XP too.** Gentle's 50% applies to the showdown's XP as well as capture rewards, and the result card shows the reduced XP. Answers #15's open question. *Why:* the reduction is there to stop farming a much smaller player, and XP was the leftover way to do it.
- **Rescue guardians look shadowy.** A dark lavender, soft-glowing tint on the Nookling shape. Answers #21's open question. *Why:* a rescue should feel like finding the way through the Hollow, and the tint stays cute, not scary.
- **Heartlet and Heartbloom are approved** as the launch secret species: the lore, the names and the Juniper's Gap night spawn. Heartbloom is tuned down to about 60–65% sim win rate after the element change. **Final values (#96):** base stats hp 80, attack 70, defense 80, speed 75; Heart Glow heals 30%; 62.5% in `pnpm sim`. Answers #10's sign-off request. *Why:* the softer matrix changes every win rate, so the secret species gets re-checked, not left a fixed number.
- **The Jack-o'-Lantern keeps protecting after Halloween** (a keepsake, radius 2). Answers #18's open question. *Why:* a built one that stops working in November would feel like losing a gift.
- **The tile panel shows a guardian strength hint** on neutral tiles: how many guardians, and a 3-step difficulty. Never species or levels. Replaces #7's "doesn't show guardians yet". Needs a hint field on `PublicTile`. *Why:* kids can pick a fight they can win without the panel giving away secret spawns (CLAUDE.md rule 6).
- **Wardrobe stays as built** (#43's open questions). The starter set (7 starter clothes, plus the Tiny Bow owned) and shared squishy accessories (own one once, any of your squishies can wear it) stay. Found-clothing odds stay for now (gather 8%, capture 12%, rescue 20%); tune them after Halloween play. *Why:* real play tells us more than guessing.
- **Care starts friendly** (#19's product calls). New squishies start at contentment 50 (`CARE_RULES.startContentment`; "Feeling okay!"), not 0. An evolved squishy takes the new form's element and keeps its own feeling. A squishy already past its evolution level evolves on its next XP. *Why:* a new squishy shouldn't look unhappy before anyone has met it, and an evolution shouldn't wait for a level it has already passed.
- **The #4 map decisions are confirmed:** 4-seat maps, leaving frees the seat and the land, and the owner can't leave in Phase 1.
- **Review cap: at most 4 reviewer rounds per PR.** A round caused only by merging `main` doesn't count. Confirms the cap and the proposal from "Usage, models and supervisor handoff". *Why:* a merge of `main` forces a re-review through no fault of the author, and the cap is there to catch contested findings.

## 2026-10-03 — Quick messages (#23)

_Proposed in the #23 PR; the project owner confirms on merge._

- **Ids only, never text.** Phase 1 chat is the shared `QUICK_MESSAGES` list (14 preset phrases, 8 emoji, 5 squishy stickers). The client sends a message id; the server checks it against the data, stores the id and the sender, and broadcasts `chat.quick`; every client draws the words from shared data. No player text exists, so no filter call is needed (CLAUDE.md rule 9). Ids are stable keys: never rename or remove one.
- **Rate limits stand in for mute** (tech spec §5): per IP, per player (a few messages per 30 s) and per map (`modules/chat/limits.ts`, all `TUNE:`).
- **Retention: the latest `feedLimit` (30) per map,** pruned on every send, rather than a daily `chat-retention` job. *Why:* Phase 1 keeps nothing worth reviewing (only presets), and the feed is all anyone reads. Phase 2's free chat brings the 30-day history for parent review and the job.
- **No chat on tutorial maps** (`FORBIDDEN`); the client never shows the Chat button over the Tutorial Glade.
- **Stickers are public squishies drawn as their vinyl-colour blob** (the care sheet's look), so there are no new image assets and never a secret species.

## 2026-10-03 — Audio (#25)

_Proposed in the #25 PR; the project owner confirms on merge._

- **All sound is synthesised in the browser for now, with no files** (Web Audio oscillators, filters and noise). This narrows the kickoff decision ("CC0 assets for music and SFX, plus procedural voices"): procedural audio matches the procedural art, has no licensing questions, and adds ~11 KB instead of megabytes of `.m4a`. CC0 or licensed recordings can still replace any cue or loop later; they would go in `ASSETS.md` and use the same cue names. `ASSETS.md` lists no audio files.
- **Music loops are notes, rendered once.** `music-score.ts` holds day (C major marimba), night (slow music box) and Halloween (D minor plinks and a wobbly whistle) as note data. The engine renders the wanted loop on an `OfflineAudioContext` (mono, 22.05 kHz, 2–3 MB per loop in memory), folds the ring-out back over the start so it loops seamlessly, levels it to a steady peak, and plays it as a looping buffer: no timers and nothing on the render loop. Loops cross-fade over 2.5 s (`// TUNE`).
- **Which loop:** night on the open map (the Hollow layer's dusk, 21:00–6:00 map time from the server) wins; otherwise Halloween while its season window is on by the **device's** date (`activeSeasons`, cosmetic only), else day. The lobby uses the same rule with night off.
- **iOS:** nothing is made or played before the first tap. The `AudioContext` is created, primed with a silent sample and resumed synchronously inside the first `touchend`/`click`/`keydown`; only then is the engine chunk loaded. Hidden pages suspend the context; coming back, or the next tap after a call or Siri (`interrupted`), resumes it. `navigator.audioSession.type = 'ambient'` where supported, so the silent switch mutes the game and the player's own music keeps playing.
- **Mix:** music, SFX and UI buses into a master gain and a limiter. The Music setting drives the music bus; the Sounds setting drives SFX and UI (one setting is simpler for kids than three). Music is quiet by default and dips under his visit, a new friend, an evolution and a win. Up to 10 voices; repeats within 50 ms are dropped; each play varies pitch ±6% and volume up to 15% (`// TUNE`).
- **Spooky stays soft** (style guide §7): his arrival is a low two-drone hush and a breath of wind while the music dips, never a sting.
- **Settings are per device** (`heartpatch.audio.v1` in `localStorage`, read in try/catch): a slider and an On/Off switch each for Music and Sounds on the lobby's Settings screen. Off keeps the slider's level for switching back on. Music stops entirely (no buffer playing) while off.
- **Screens report moments, the audio module picks the sound.** Battle, close-up and care screens gained one optional callback each (`onStep`, `onTouch`, `onSquish`); `audio/cues.ts` maps them to cues. Every button ticks through one captured document listener, so no screen wires its own.

## 2026-10-03 — Owner rules pass (Fix PR)

_Proposed in the owner-rules Fix PR; the project owner confirms on merge. How the rules in "2026-10-03 — Owner decisions" were built._

- **A beaten wild squishy is gone the same way a befriended one is:** the spawns module skips any tile whose spawn this player beat this window, read from their finished `battles` rows (`result.winner` is the player's side; befriending is a win too). No new table or marker: the battle row already keeps its tile and window (#14), so the rule is idempotent and per player for free. A loss, a tie, a run home or a no contest leaves it there. The result card says "It's tuckered out and toddles away!".
- **Gentle's share scales the battle's base XP before care × habitat,** win or lose (`floor(base × rewardPercent / 100)`, then `applyXp`), carried from `tile_attacks.reward_percent` through the tile-battle port. `battle.ended.xp` stays the XP actually granted.
- **The result card shows granted XP.** `battles.rewards` (one new nullable column) stores what a finished battle granted and the share it paid; `PlayerBattle.rewards` carries it (null while running, after no contest, on a defender's replay, and for older battles, where the card falls back to the engine's base XP). *Why:* the card showed the engine's base XP, which already missed the care and habitat bonus, and couldn't show Gentle's half at all.
- **Housed or on watch, not both, enforced on both commands under the squishy's row lock:** housing locks building then squishy and refuses one on watch; posting locks member, tiles, then the posted squishies in id order (`FOR NO KEY UPDATE`, like housing) and refuses a housed one that isn't already on that tile. Moving out of a habitat or off watch is always allowed.
- **Squishies that were both before the rule count as on watch only** until the player changes one: no habitat bonus (care's XP multiplier skips the habitat while on watch), and the Hollow Man already treated them as on watch. They may keep their post when that tile's guards change. *Why not clear them in the migration:* a hand-written data statement would be lost when migrations are regenerated before merge (tech spec §4), and clearing the watch could leave a squishy newly exposed at nightfall; clearing the habitat would silently move it out. Watch-only changes nothing a player can see except the bonus.
- **First-night grace counts calendar nightfalls from `map_members.joined_at`** (game clock, map time): `firstHollowNight` is `tonightOf(joined) + graceNights`, so joining at 8:55 PM makes that evening the first grace night and joining at 9:00 PM or later starts with the next. It's skipped where #21 skips tutorial maps (the `nightfall` call), per player; the night's outcome still counts their exposed squishies. A rejoining member's new `joined_at` gives a new grace, as they get a fresh home base.
- **The fire hint is a status flag, shown as a small pill:** `HollowStatus.fireHint` is true until the night of the Hollow Man's first visit to me (included) while no Hearthfire of mine is lit for tonight, never on tutorial maps. The client shows "Light a fire before night falls!" beside the Hollow button by day; it takes no taps, so it never blocks the map.

## 2026-10-03 — Shadowy rescue guardians and the guardian hint (polish)

_Proposed in the client-polish Fix PR (owner decisions 7 and 10); the project owner confirms on merge._

- **The guardian hint is worked out on read, from #15's own team** (coordinator-approved, additive `PublicTile.guardianHint: { count, difficulty } | null`). The map view runs the territory module's `tileGuardians` (the pure builder a claim battle also uses, now exported) for each neutral, non-home tile and keeps only how many and a difficulty word: the team's total level against fixed bands in the secret guardian data (`GUARDIAN_RULES.hint`, `// TUNE:`), so every member sees the same hint and a guess about bands says nothing about species. No event: guardians change with the map-local day, and a capture clears the hint on the client. *Why:* rule 4 (timestamps, not ticking), and one builder means the hint can't drift from the fight.
- **Hint copy:** "Guarded by 3 sleepy squishies • tough" (easy, tough, very tough).
- **The shadow look is a per-instance code, not a material.** The squishy field's spare `squishMotion.w` carries normal, shadow, or shadow eyes; the squish shader tints towards dark lavender (keeping the vinyl's shading), adds a soft glowing rim and mixes the eyes towards the glow so they read glassy. Shadows share meshes, the material and draw calls with every other squishy. Real transparency would need a second, blended material and pass, so "translucent" eyes are a colour effect. Under the opt-in WebGPU renderer (no shader plugin) the tint is baked into the instance colour, without the glow. The squishy gallery's `?shadow` shows it.

## 2026-10-03 — Starter pick (Fix PR)

_Proposed in the starter-pick Fix PR; the project owner confirms on merge. How "First squishy: a pick of 3" in "2026-10-03 — Owner decisions" was built._

- **The three starters are Emberbun (Fire), Puddlepuff (Water) and Thistlepip (Leaf)** (shared `STARTERS`). Fire, Water and Leaf go round in a circle on the element matrix (each is strong against one of the others and weak against the other), so no pick is the best one. All three are public, year-round base forms that grow up at level 16–18; `starters.test.ts` checks they're real, never secret, not seasonal, not an evolved form, and three different elements in that circle. *Why not others:* Leaf's only common base form is Gourdon, a Halloween squishy that should stay something you find in October; Thistlepip is the next plain Leaf base form. Emberbun is the common Fire base form.
- **A pick is `POST /maps/:mapId/starter { speciesId }`**, patches only (the Tutorial Glade is NOT_FOUND). In one transaction it row-locks the player's active member row (tech spec §7 "a member row locked to check it"), refuses a second pick (`CONFLICT`), grants a level-1 squishy through battles' `insertSquishy` (contentment starts at `CARE_RULES.startContentment`), records it on `map_members.starter_squishy_id` and marks the species caught in their catalog. Two picks at once run one at a time on the member row lock, so exactly one squishy is granted. Idempotency-Key is supported, so a retry after a lost reply returns the same squishy.
- **No game event.** `squishy.captured` needs a battle id, and nothing another member sees changes (other players never list someone's squishies live), so the pick writes none and takes no `maps` lock. A future "new friend" toast can add an event then.
- **`MapDetail.needsStarter`** (`GET /maps/:mapId`) is true until the player picks. The client asks for `GET /maps/:mapId` when "Visit patch" is tapped and shows "Choose your friend!" before the map. Members from before this change have no marker, so they get a pick on their next visit too (a pre-launch bonus squishy at most).
- **Rejoining gives no new pick.** The marker stays on the archived membership and is kept when it's reactivated, so leaving and coming back can't farm starters. This differs from the first-night grace, which a rejoiner gets again: a returning player gets a fresh home base with no fire, so the Hollow risk is new, but they keep every squishy they had on the patch (leaving doesn't remove squishies), so the reason for a starter, having no squishy, doesn't come back.
- **Tutorial Partner:** the design doc makes the Partner the same 1-of-3 choice, so a player who finished the tutorial is always offered their Partner's species. Nothing records the Partner yet (#24's `grantCompletionRewards` TODO); when #24 does, it must pick from `STARTERS`, and the starter screen can pre-select it then. Getting a copy without picking was not chosen: it needs the Partner stored first, and a second grant path at join (approval's transaction) where one endpoint does today.

## 2026-10-03 — Placeholder species retired (#87)

_Proposed in the #87 PR; the project owner confirms on merge. Closes "The `placeholder-*` secret rows stay for now" in "2026-10-02 — Launch roster (#10)"._

- **Moonpuff → Moonmallow and their two moves are gone** from the secret data, with their spawn and guardian tables. Every terrain already had a launch roster everyday spawn table and guardian table, so nothing needed refilling and no weight changed. Heartlet's odds move from 1 in 28 to **1 in 27** Gap night spawns (1 in 39 to 1 in 38 at Halloween), since the placeholder's weight left the pool. Every other wild squishy gets a little more common in the same way.
- **Tests pick species by what they need, not by name:** a secret line from `secretEvolutions`, a secret base form, a public squishy that grows up before level 40, or a starter. Shared schema checks use a fixture secret line (`fixture-moonpuff` → `fixture-moonmallow`) in `tests/fixtures`. `content.test.ts` fails if a `placeholder-*` or `fixture-*` id ships in the server data again.
- **Leftover rows in local and dev databases get a reset, not a migration or a runtime skip** (coordinator decision). Production has never been deployed, so a `placeholder-*` squishy can only be in a local or dev database: reset it after pulling (`docker compose -f infra/compose/docker-compose.dev.yml down -v && pnpm db:up && pnpm db:migrate && pnpm db:seed`; plain `pnpm db:down` keeps the `db-data` volume, and the rows with it). A leftover squishy still lists (care, home, catalog, Hollow) with no species row, so the client draws a mystery squishy. It can't battle: the engine refuses an unknown species and the start returns 500. *Why:* skipping unknown species in the battle team would quietly hide real data bugs later, and a 500 on a corrupted dev row is acceptable.

## 2026-10-03 — The First Patch (#24)

_Proposed in the #24 PR; the project owner confirms on merge. How design doc §26 and the owner decisions in the #24 brief were built._

- **15 steps, 13 from the design doc** (`data/tutorial/steps.ts`): Sprout's `welcome`, then `plant`, `gather`, `hearthfire`, `first-battle`, `befriend` and `name-partner` (step 5), `care`, `habitat`, `territory`, `defend`, `nightfall`, `evolve`, `wardrobe`, `graduation`. Each completes on the real module's event; only `welcome`, `plant` and `graduation` are taps. Lines are short, two at most per bubble (style guide §2, §6).
- **A Glade friend plays the first battle.** A new player has no squishy, and battles need a team, so a run starts with a level-5 Pebblesnooze (`TUTORIAL_SETUP.helper`, not a starter) and Sprout's little bag (Stone, 3 Heart Charms, Treats; ledger reason `tutorial`). The starter befriended in the Glade is the Partner. *Why:* the design doc puts the battle before the capture, and the owner wants the Partner to come from the capture-and-name step.
- **The Glade's wild squishies are the three starters**, one per tile by `(q − r) mod 3` (neighbouring tiles always differ, so all three sit around home), and one beaten without befriending stays (owner: wander-off is exempt on tutorial maps). So the Partner always passes `isStarterSpecies`, and a kid who tuckers it out can try again.
- **The Partner is stored when the befriend step finishes** (`users.partner_species_id`, the latest run's; app-checked against `STARTERS`, no DB check, so the starter list stays data). No copy is made on new patches (owner): `MapDetail.preselectSpeciesId` makes the starter pick start on it, and any of the three can still be picked. The run's Partner squishy (named, evolved) is the player's first squishy of that species' line on the Glade, so a different starter species befriended earlier, off-step, is never the one named or grown.
- **Evolve: Sprout's glow.** A battle that ends (won or not) during the evolve step gives the Partner exactly the XP to its next form, through care's own `applyXp` in the tutorial consumer's transaction (lock order: `event_consumers`, `users`, squishies, `species_seen`, `maps`). Its `squishy.evolved` finishes the step. *Why:* starters grow up at 16–18, and the design doc wants one battle to do it.
- **The Seedling Scarf** is a `tutorial` item (account-bound, `tradable: false`), granted when the wardrobe step comes up (and again, as a no-op, on finishing). `ref_id` is uuid v5 of the player's id under a fixed namespace, so `(source, ref_id)` is one per account and never collides. The wardrobe step completes on any `outfit.changed` (wear the scarf, or change anything), so a replayer already wearing it is never stuck.
- **First Patch milestone hook:** `users.tutorial_completed_at` (the first completion; replays never move it). #44 reads it; no new event type.
- **Nightfall is scripted.** "Night falls" (`POST /tutorial/nightfall`, only on its step) runs the Hollow's own `runNightfall` on the Glade for the next night that hasn't run; the Hollow Man takes nothing there. **The nightfall sweep skips tutorial maps** (it didn't before: every finished Glade got a night forever, harmless but wasted). Since Phase 1 squishies sleep at home and one fire covers it, "move the squishy inside the light" isn't a beat yet.
- **Defend is posting a guard.** The step completes when the player puts a squishy on watch on their new tile; Sprout says the echo was shooed away. There is no simulated echo raid (a raid needs a real attacker and the raid log), so no stance pick is required; the raid report already offers the style.
- **Lore:** pages and their conditions are server-only (`LORE_PAGES`, `{ id, title, text, trigger: { mapKinds, eventType, where, finder } }`, the tutorial's predicates), found by a `lore` event consumer into `lore_found`, read through `GET /lore`. One page in the Glade (its night), two on patches (claiming old forest; a rescue). The bundle check fails if a page's title or words reach the client. A card shows a newly found page; Settings has the Lorebook.
- **On the client** the Glade gets the real bag, home base, battles, territory and the night (not chat). A gameplay step's bubble tucks into a small chip after "Let's go!", so it never covers battle moves or the home bar; tapping it opens it again. Spotlights only sit on buttons that finish the step from where they are (`TARGET_STAND_INS`), because a spotlight blocks every other tap.
- **Dev step jump** (`POST /tutorial/dev/step`, `HP_DEV_SQUISHY_GRANTS`): moves a run to any step as the engine would, for e2e and phone testing.

