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
| Care actions | Feed, pet, play. Training = Training Grounds building; grooming returns with squishy dress-up *(The Heart Snack joined as a rare fourth action: 3 Heartdust, outside the daily care falloff. See "Building upgrades, a use for Heartdust, and honest Glimmer (Fix PR #193)", 2026-10-06.)* |
| Owner mute | Deferred to Phase 2 with free chat |
| Recovery codes | One active hashed code; a fresh one after each use; plus an operator CLI reset for players with no map owner |
| Hollow Man vs "absence is not punished" | Hearthfires store up to 5 nights of fuel (burn one per nightfall) — teaches planning ahead; squishies at home behind a lit fire are always safe *(Superseded: Hearthfires store 8 nights. See "Night at 7 PM; the Hollow Man grows bolder (#277, PR #285)", 2026-10-08.)* |

## 2026-10-02 — Session reporting

- **Sessions report; the coordinator doesn't poll.** Build sessions report milestones to the coordinator themselves (PR opened, ready to merge, blocked, CI red), as required in `CLAUDE.md` → Workflow and repeated in every session brief. No scheduled check-ins.
- **Why it's in CLAUDE.md:** sessions rightly treat messages relayed from another session as information, not authority, and declined reporting requests sent that way. Reporting therefore lives in the instructions each session starts with.
- **Backstop:** the coordinator subscribes to every PR, so CI results, comments and merges arrive as GitHub events, and it is notified if a session's turn fails. Both are event-driven, not polling.

## 2026-10-02 — Architecture and product audit

An adversarial audit (top game-architect / game-PM persona) reviewed the docs, code and roadmap. The owner approved these changes; the design doc and tech spec carry the rules.

- **A. The multiplayer game never waits on the tutorial.** The server setting `HP_TUTORIAL_REQUIRED` lets new accounts create or join maps before the tutorial exists. The tutorial (#24) no longer depends on the cinematic (#46), wardrobe (#43) or milestones (#44); its final steps arrive once those exist. _(Done: #43, #44 and #24 are built.)_ Issues that bundled client and server work (#5, #17, #22) shed their false dependencies on client rendering, so the server parts can start earlier. *Why:* #24 sat at the end of an 11-issue chain and gated all play.
- **B. Family-safe PvP.** A map-owner **PvP mode**: On / **Gentle (default)** / Off, with a per-defender daily tile-loss cap and reduced rewards for challenging much smaller players. Every home ring is guaranteed Timber, Stone, Emberwood and a farm plot. *Why:* an older sibling could strip a younger one's land, then their fuel, then their squishies.
- **C. The Hollow Man is a planning challenge, not a nightly tax.** Tile defenders stand watch and aren't exposed. *(Superseded: a guard on watch needs a lit fire's reach, or it is exposed at nightfall. See "Hearthfires on captured land (#202, PR #222)", 2026-10-07.)* Rescue can start from anywhere, and Heartdust from rescues is capped per day. *Why:* holding territory would otherwise cost a squishy every night, and exposure could be farmed.
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

- **Models (owner decision):** *(Briefly superseded on 2026-10-05 by Fable builds, then restored that evening; see "Models (owner decision, 2026-10-05 evening)".)* Build sessions that write code and reviewers on code PRs use the strongest model (Opus). Docs-only reviews, drift audits and simple content/docs work use **Sonnet 5.5**. *Why:* code reviews have caught real bugs every round; the rest is cheaper without losing much.
- **#13 (battles) runs on Fable (owner decision, 2026-10-02).** *(Superseded 2026-10-05: every code lane runs on Opus 5.5 with Opus reviewers; see the evening Models entry.)* The #13 build session uses Fable; its code reviewers stay on Opus. *Why:* #13 is the most rule-heavy Phase 1 lane and mistakes there are costly to unwind. Fable currently costs about 2.5× Opus per token, so the supervisor flags #13's cost against a higher bar (about $30, not $20) and reports how it compares with the Opus lanes.
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

- **Maps are generated once, for every seat.** A new map is generated for `max_players` (4) and stored in full (terrain, nodes, guardian strength, home slots). Joiners take the next free home slot, so the map never resizes. Design doc §3's smaller 2- and 3-player sizes aren't used yet. *Why:* players join one at a time after creation, and regenerating would move everyone's land. *(Superseded for new patches: they seat 6 on a radius-16 map; older patches keep 4. See "Six-seat patches and six Keepers (#318; PR #324, #327)", 2026-10-09.)*
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
- **The shell version is a content hash, not `APP_VERSION`.** The cache is `heartpatch-shell-<12 hex>`, hashed from every precached URL and Workbox revision. A deploy that only changes the server keeps the phones' cache, so kids don't re-download the 1 MB+ engine on cellular for nothing. Any shell change makes a new cache, and old ones are deleted on activate. index.html is cached as `/`, the URL players open, and redirected responses are never cached (browsers refuse them for page loads). *(Superseded: every deploy is now a new app shell, because the build number is in the entry bundle. See "The game's version (#198, PR #210)", 2026-10-06.)*
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
- **Procedural and seeded by the config**, like squishies: pure params (`keeperParams`, `+ − × ÷` and `Math.sqrt` only) with a pinned hash checked in Node and in the browser, so the same config is the same Keeper on every engine. Hairstyles are one builder per style; bases are data. *(Hairstyles are data too, and any Keeper can wear any style: superseded by "Keeper hair styles (#176)", 2026-10-06. The 8 bases and 8 hairstyles above are 12 and 12 now.)*
- **Drawn like squishies, cheaper:** `KeeperField` shares one mesh per primitive across every Keeper (thin instances: five meshes plus shadows, however many Keepers) and reuses the squishies' squash shader for cheers. Keepers never breathe, so an idle Keeper never wakes the renderer; they hop or wince only on battle log events. Keepers lean back a little so their faces show under the steep map camera.
- **Where they stand now:** the map shows each member's Keeper beside their Heart Seed (low detail, no shadow); battles show the player's Keeper at their squishy's back, nearer the camera and off to the side, clear of the nameplates. Home-base idling and wandering arrives with home base (#18); profile cards and the close-up view's edge-of-frame Keeper come with the screens that show them.

## 2026-10-02 — Resources, gathering and inventory (#17)

_Proposed in the #17 PR; the project owner confirms on merge._

- **The inventory contract is small, transactional and ledgered** (coordinator-set for #17 and #14, following tech spec §4): balances in `inventories (map_id, user_id, item_id, quantity ≥ 0)`, where a missing row is 0, and every change in `resource_ledger` with a reason and the id of what caused it. Other modules move items only with `grantItems(tx, owner, items, reason, refId?)` / `consumeItems(…)` inside their own transaction; `reason` is the shared `ItemChangeReason` union, which later issues extend. `consumeItems` locks the rows in id order and throws `CONFLICT` ("You need 1 more Heart Charm first!") with nothing changed if anything is short. Tests reconcile balances against ledger sums. *Why:* captures, buildings and trades must pay and get paid in the same commit as the change (CLAUDE.md rule 7), and every change needs a reason (tech spec §4).
- **Gathers are `gather_jobs` rows and announce themselves** (coordinator-approved): `gather.started` carries the tile and ready time (never the yield), so every member sees "gathering here" live; `resource.gathered` clears it.
- **A gather's yield is fixed when it starts.** The node's quantity plus any in-season extras is stored on the gather, and a gather started in season finishes after the season ends. *Why:* collecting a little late must never change what a kid gets.
- **Witch Dust is a Halloween bonus on Emberwood and Pumpkin gathers** (`gather.extras`, `// TUNE:`; coordinator-approved), because map generation places no Witch Dust nodes. A Witch Dust node or terrain can replace it later as a data change.
- **The node belongs to the tile's owner.** If a tile changes hands mid-gather, the old owner can't collect it, and the new owner's first gather there marks it `lost`. *(Updated 2026-10-06: a gather that finished before the capture is banked into the old owner's bag when the new owner gathers there; see "Finished things go straight to the bag (#177)".)* Only the current owner's gather shows as "gathering here" on the public tile.
- **One craft at a time per player per map**, inputs used up front (`// TUNE:` if kids want a queue). Seasonal recipes only start in season; leftover seasonal items stay as keepsakes (design doc §15).
- **The client counts down on the server's clock.** Every inventory reply carries `now`, so a phone with the wrong time, or a dev server on a Halloween date, shows the right time left.
- **The Bag button sits bottom left above "My patches"** and steps aside while the tile panel is open; the panel's own button gathers and collects *(Superseded 2026-10-06: no Collect; see "Finished things go straight to the bag (#177)", 2026-10-06)*. Not on the Tutorial Glade yet (#24 adds the gather step).

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

- **Buildings are `buildings` rows on spots of the player's own home tiles** (coordinator-approved shared contract): map, owner, tile, building id and kind, level, spot, and for Hearthfires `fuelled_through` (+ `fuel_updated_at`). Each home tile has 7 spots (the middle and six around it, `spotOffset`); the middle of the Heart Seed's tile and of a node tile is taken by what stands there. One building per spot; `maxPerHome` per building in data (one Hearthfire, one Jack-o'-Lantern, two of each habitat, `// TUNE:`). Only Hearthfires and habitats are buildable now (`HOME_BASE_RULES.buildableKinds`); Training Grounds wait for their XP (#19). Building is instant (no build timer) and upgrades are a follow-up. *(Superseded in part: no fires stand on home tiles, see "Hearthfires on captured land (#202, PR #222)", 2026-10-07. Training Grounds build only on homesteads, see "Training Grounds move to homesteads (#277, PR #302)", 2026-10-08.)*
- **Fuel is a date, as tech spec §7 says**, not a stored count plus a timestamp: `fuelled_through` is the last map-local night it covers, and "lit" and "nights left" are worked out on read from the map clock (DST included). Adding more than fits fills it and charges only for what went in. *Why:* nothing ticks or decrements, so a nightfall run twice can't burn fuel twice (CLAUDE.md rule 4). Nightfall (#21) asks `protectsNight(fuelledThrough, night)`, and `litSafeTiles` / shared `safeTiles` give the protected tiles.
- **A lit fire protects its whole home base plus its radius, measured from the fire's own tile.** *Why:* design doc §14 says squishies at home behind a lit fire are always safe; measuring from the fire makes where you put it matter for land beyond the home. *(Superseded: home tiles are always safe and fires stand only on captured land. See "Hearthfires on captured land (#202, PR #222)", 2026-10-07.)*
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
- **Found drops are server-side tables** (`data/server/clothing-drops.ts`, CLAUDE.md rule 6): one per source (gather, capture, rescue), a percent chance then a weighted pick among the pieces that can drop here and now (seasonal pieces in season, terrain-bound ones on their terrain, by the map's local date on the game clock, so `HP_DEV_NOW` tests it). `rollFoundDrop(tx, …)` (`modules/wardrobe/drops.ts`) runs in the caller's transaction, after its state writes and before its own event (which stays the last write), and appends `clothing.found` (public: who and what, never the odds). Gathering calls it on collect; Hollow rescues (#21) call it with their own source; tile captures will. Captures can't simply call it inside the battle port: battles lock squishy rows after the port runs, and appending `clothing.found` there would take the `maps` row first (the lock-order rule in `appendGameEvent`). They need the event returned with `tile.captured` instead (a follow-up). *(Done: see "2026-10-03 — Capture drops (#84)".)* `HP_DEV_DROP_CHANCE` (dev and test only) sets every chance, so a find can be tried on a phone.
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
- **Only base forms spawn wild.** Wild levels are 2–6, so an evolved form there would make no sense. Evolved forms are met as **Juniper's Gap guardians** (levels 14–18), even below their own evolution level: a guardian belongs to the land, it didn't grow up there. Ordinary land is guarded by base forms. *(Superseded in part 2026-10-06: base forms still spawn wild, but at levels matched to the Partner (−2 to +1), not 2–6; a player with no Partner still meets 2–6. A befriended one joins at most one level below its first evolution. See "The level curve and wild levels (#182)", 2026-10-06.)* *(Now −2 to +0, see "A wild squishy wanders off; fairer wild levels (#208, PR #211)", 2026-10-06.)*
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

- **Nightfall is a sweep plus one job per map and night** (coordinator-approved: `hollow_events`, one row per map per night). Every minute (and at boot) a sweep asks which maps' latest 21:00 (map time, DST included) hasn't run, and enqueues `nightfall` keyed `mapId/night`. The night's row is claimed first in the nightfall transaction, so a retry, a duplicate job or a restart takes nothing more. *Why:* one cron per map can't follow time zones and daylight saving, and the row is a stronger guard than job de-duplication. *(Superseded: nightfall is 19:00 map time. See "Night at 7 PM; the Hollow Man grows bolder (#277, PR #285)", 2026-10-08.)*
- **After downtime only the latest missed night runs**, and a map's first night is the first nightfall after its first active member joined (game clock). *Why:* a server outage shouldn't cost a squishy per missed night, and `created_at` columns use the database clock, which a dev clock override doesn't move.
- **Where a squishy spends the night:** its habitat's tile, else its owner's Heart Seed. It's safe inside the tiles lit fires protect that night (anyone's fires, `litSafeTiles` with `protectsNight`), on watch if `isOnWatch` (decision C), else exposed. In Phase 1 habitats are only on home tiles, so "exposed" means "the fire is out" until habitats or noise buildings can sit elsewhere.
- **The pick is seeded per map, night and player** (`deriveSeed(mapSeed, 'hollow', night, userId)`), over exposed squishies in id order, and never revealed. Tutorial maps take nothing (`hollowManCanTake`).
- **Rescues are a `rescue` battle kind** (coordinator-approved) started through `startRescue` and settled by a `hollow` event consumer from `battle.ended`, not inside the battle's transaction: the battles service only gains the start entry point. Shadows (secret `RESCUE_GUARDIANS`) are fixed per squishy per map-local day and sit just under the player's strongest active squishy, so a rescue is a fair fight. They look like Nookling, the year-round public shadow squishy (#10), so a rescue never shows a player a secret species. **If every squishy is in the Hollow, the one being rescued fights** (it helps find the way out), so a rescue is always possible.
- **Heartdust is capped per player per map-local day** (`HOLLOW_RULES.rescue.rewardsPerDay`, `// TUNE:` [DEFAULT: 1]); rescues past it still bring the squishy home. The day is the battle's end (game clock). A rewarded rescue also rolls #43's `rescue` clothing drop (`rollFoundDrop`); capped rescues don't, so the cap covers every rescue reward.
- **Who hears what:** `hollow.nightfall` tells everyone who lost a squishy, never which; `squishy.hollowed` and `squishy.rescued` go only to the owner. The morning report lists the last 3 nights (`reportNights`) per player; which one a device has shown is remembered in that device's `localStorage` (a per-viewer convenience: a new phone may show it once more).
- **Why "seen" differs from the raid log's.** A raid is one row for one defender, so `raids.seen_at` is cheap and exact, and it also feeds the unseen count that opens the report on any device. A Hollow night is one row per map (`hollow_events`, every member's result in `outcomes`) with nowhere per player to put a flag, and showing a night's card twice is harmless, so a device remembers it in `localStorage`. If the Hollow report ever needs to agree across devices, give it a per-player seen row like the raids. The raid sheet is being renamed "Raid report" (Chore PR) so the two read alike. *(Done: it is "Challenge report" as of 2026-10-06; see "Words: My Home, patch and land (#181)".)*
- **On screen:** at night (21:00–6:00 map time, from the server) the map's sky and sun dim to a lavender dusk, so the fires' warm glow stands out. When night falls live he visits once where the player is looking (a little up-screen), flickers, hesitates and fades in about 4.5 s, the only time the map draws continuously; the report card waits until he's gone. A rescue opens the battle screen ("Shadows from the Hollow want to play!", "Welcome home!"). *(Night now starts at 19:00. See "Night at 7 PM; the Hollow Man grows bolder (#277, PR #285)", 2026-10-08.)*
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
- **First-night grace.** The Hollow Man skips a player for their first 2 nightfalls after joining a patch, with a cozy hint to light a fire. Answers #21's open question. *Why:* someone who joins at 8:55 PM with no fire shouldn't lose a squishy at 9:00. *(Nightfall is now 7 PM. See "Night at 7 PM; the Hollow Man grows bolder (#277, PR #285)", 2026-10-08.)*
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
- **Which loop:** night on the open map (the Hollow layer's dusk, 21:00–6:00 map time from the server) wins; otherwise Halloween while its season window is on by the **device's** date (`activeSeasons`, cosmetic only), else day. The lobby uses the same rule with night off. *(Night now starts at 19:00. See "Night at 7 PM; the Hollow Man grows bolder (#277, PR #285)", 2026-10-08.)*
- **iOS:** nothing is made or played before the first tap. The `AudioContext` is created, primed with a silent sample and resumed synchronously inside the first `touchend`/`click`/`keydown`; only then is the engine chunk loaded. Hidden pages suspend the context; coming back, or the next tap after a call or Siri (`interrupted`), resumes it. `navigator.audioSession.type = 'ambient'` where supported, so the silent switch mutes the game and the player's own music keeps playing.
- **Mix:** music, SFX and UI buses into a master gain and a limiter. The Music setting drives the music bus; the Sounds setting drives SFX and UI (one setting is simpler for kids than three). Music is quiet by default and dips under his visit, a new friend, an evolution and a win. Up to 10 voices; repeats within 50 ms are dropped; each play varies pitch ±6% and volume up to 15% (`// TUNE`).
- **Spooky stays soft** (style guide §7): his arrival is a low two-drone hush and a breath of wind while the music dips, never a sting.
- **Settings are per device** (`heartpatch.audio.v1` in `localStorage`, read in try/catch): a slider and an On/Off switch each for Music and Sounds on the lobby's Settings screen. Off keeps the slider's level for switching back on. Music stops entirely (no buffer playing) while off.
- **Screens report moments, the audio module picks the sound.** Battle, close-up and care screens gained one optional callback each (`onStep`, `onTouch`, `onSquish`); `audio/cues.ts` maps them to cues. Every button ticks through one captured document listener, so no screen wires its own.

## 2026-10-03 — Owner rules pass (Fix PR)

_Proposed in the owner-rules Fix PR; the project owner confirms on merge. How the rules in "2026-10-03 — Owner decisions" were built._

- **A beaten wild squishy is gone the same way a befriended one is:** the spawns module skips any tile whose spawn this player beat this window, read from their finished `battles` rows (`result.winner` is the player's side; befriending is a win too). No new table or marker: the battle row already keeps its tile and window (#14), so the rule is idempotent and per player for free. A loss, a tie, a run home or a no contest leaves it there. *(Superseded: off the Glade, a loss or a run home makes it wander off too; a tie or a no contest still leaves it. See "A wild squishy wanders off; fairer wild levels (#208, PR #211)", 2026-10-06.)* The result card says "It's tuckered out and toddles away!".
- **Gentle's share scales the battle's base XP before care × habitat,** win or lose (`floor(base × rewardPercent / 100)`, then `applyXp`), carried from `tile_attacks.reward_percent` through the tile-battle port. `battle.ended.xp` stays the XP actually granted.
- **The result card shows granted XP.** `battles.rewards` (one new nullable column) stores what a finished battle granted and the share it paid; `PlayerBattle.rewards` carries it (null while running, after no contest, on a defender's replay, and for older battles, where the card falls back to the engine's base XP). *Why:* the card showed the engine's base XP, which already missed the care and habitat bonus, and couldn't show Gentle's half at all.
- **Housed or on watch, not both, enforced on both commands under the squishy's row lock:** housing locks building then squishy and refuses one on watch; posting locks member, tiles, then the posted squishies in id order (`FOR NO KEY UPDATE`, like housing) and refuses a housed one that isn't already on that tile. Moving out of a habitat or off watch is always allowed.
- **Squishies that were both before the rule count as on watch only** until the player changes one: no habitat bonus (care's XP multiplier skips the habitat while on watch), and the Hollow Man already treated them as on watch. They may keep their post when that tile's guards change. *Why not clear them in the migration:* a hand-written data statement would be lost when migrations are regenerated before merge (tech spec §4), and clearing the watch could leave a squishy newly exposed at nightfall; clearing the habitat would silently move it out. Watch-only changes nothing a player can see except the bonus.
- **First-night grace counts calendar nightfalls from `map_members.joined_at`** (game clock, map time): `firstHollowNight` is `tonightOf(joined) + graceNights`, so joining at 8:55 PM makes that evening the first grace night and joining at 9:00 PM or later starts with the next. It's skipped where #21 skips tutorial maps (the `nightfall` call), per player; the night's outcome still counts their exposed squishies. A rejoining member's new `joined_at` gives a new grace, as they get a fresh home base. *(Nightfall is now 7 PM, so read 6:55 PM and 7:00 PM. See "Night at 7 PM; the Hollow Man grows bolder (#277, PR #285)", 2026-10-08.)*
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
- **Tutorial Partner:** the design doc makes the Partner the same 1-of-3 choice, so a player who finished the tutorial is always offered their Partner's species. #24 stores the Partner (`users.partner_species_id`, set from a starter's `squishy.captured`), and the starter screen pre-selects it. Getting a copy without picking was not chosen: it needs the Partner stored first, and a second grant path at join (approval's transaction) where one endpoint does today.

## 2026-10-03 — Placeholder species retired (#87)

_Proposed in the #87 PR; the project owner confirms on merge. Closes "The `placeholder-*` secret rows stay for now" in "2026-10-02 — Launch roster (#10)"._

- **Moonpuff → Moonmallow and their two moves are gone** from the secret data, with their spawn and guardian tables. Every terrain already had a launch roster everyday spawn table and guardian table, so nothing needed refilling and no weight changed. Heartlet's odds move from 1 in 28 to **1 in 27** Gap night spawns (1 in 39 to 1 in 38 at Halloween), since the placeholder's weight left the pool. Every other wild squishy gets a little more common in the same way.
- **Tests pick species by what they need, not by name:** a secret line from `secretEvolutions`, a secret base form, a public squishy that grows up before level 40, or a starter. Shared schema checks use a fixture secret line (`fixture-moonpuff` → `fixture-moonmallow`) in `tests/fixtures`. `content.test.ts` fails if a `placeholder-*` or `fixture-*` id ships in the server data again.
- **Leftover rows in local and dev databases get a reset, not a migration or a runtime skip** (coordinator decision). Production has never been deployed, so a `placeholder-*` squishy can only be in a local or dev database: reset it after pulling (`docker compose -f infra/compose/docker-compose.dev.yml down -v && pnpm db:up && pnpm db:migrate && pnpm db:seed`; plain `pnpm db:down` keeps the `db-data` volume, and the rows with it). A leftover squishy still lists (care, home, catalog, Hollow) with no species row, so the client draws a mystery squishy. It can't battle: the engine refuses an unknown species and the start returns 500. *Why:* skipping unknown species in the battle team would quietly hide real data bugs later, and a 500 on a corrupted dev row is acceptable.

## 2026-10-03 — Capture drops (#84)

_Proposed in the #84 PR; the project owner confirms on merge. Closes the capture follow-up in "2026-10-02 — Wardrobe (#43)"._

- **Battles rolls a capture's find, not the territory port and not a consumer.** The port's `ended` returns `drop` (the tile and Gentle's share) with `tile.captured`; battles' `finish` calls `rollFoundDrop` (`source: 'capture'`, `refId` = the battle id) after the squishy locks and its own state writes, so `clothing.found` is the transaction's first event and `maps` stays last (tech spec §7). Events read `clothing.found`, `battle.ended`, …, `tile.captured`. *Why not a `tile.captured` consumer:* the find commits with the capture that earned it (a retry can't lose or double it), and the player's live toast arrives with the result rather than a few seconds later.
- **Gentle scales the chance** by `rewardPercent` (`floor(chance × percent / 100)`, `HP_DEV_DROP_CHANCE` included), as "Territory (#15)" carries it on `tile.captured` "for found clothing". A loss, a forfeit, a won showdown that takes no tile and a no-contest find nothing.
- **One piece per capture:** the battle locks before it finishes, and `clothing_owned`'s unique `(source, ref_id)` refuses a second grant for the same battle.

## 2026-10-03 — The First Patch (#24)

_Proposed in the #24 PR; confirmed by the owner on 2026-10-04 (see "2026-10-04 — Owner decisions"). How design doc §26 and the owner decisions in the #24 brief were built._

- **15 steps, 13 from the design doc** (`data/tutorial/steps.ts`): Sprout's `welcome`, then `plant`, `gather`, `hearthfire`, `first-battle`, `befriend` and `name-partner` (step 5), `care`, `habitat`, `territory`, `defend`, `nightfall`, `evolve`, `wardrobe`, `graduation`. Each completes on the real module's event; only `welcome`, `plant` and `graduation` are taps. Lines are short, two at most per bubble (style guide §2, §6).
- **A Glade friend plays the first battle.** A new player has no squishy, and battles need a team, so a run starts with a level-5 Pebblesnooze (`TUTORIAL_SETUP.helper`, not a starter) and Sprout's little bag (Stone, 3 Heart Charms, Treats; ledger reason `tutorial`). The starter befriended in the Glade is the Partner. *Why:* the design doc puts the battle before the capture, and the owner wants the Partner to come from the capture-and-name step.
- **The Glade's wild squishies are the three starters**, one per tile by `(q − r) mod 3` (neighbouring tiles always differ, so all three sit around home), and one beaten without befriending stays (owner: wander-off is exempt on tutorial maps). So the Partner always passes `isStarterSpecies`, and a kid who tuckers it out can try again.
- **The Partner is stored when the befriend step finishes** (`users.partner_species_id`, the latest run's; app-checked against `STARTERS`, no DB check, so the starter list stays data). No copy is made on new patches (owner): `MapDetail.preselectSpeciesId` makes the starter pick start on it, and any of the three can still be picked. The run's Partner squishy (named, evolved) is the player's first squishy of that species' line on the Glade, so a different starter species befriended earlier, off-step, is never the one named or grown.
- **Evolve: Sprout's glow.** A battle that ends (won or not) during the evolve step gives the Partner exactly the XP to its next form, through care's own `applyXp` in the tutorial consumer's transaction (lock order: `event_consumers`, `users`, squishies, `species_seen`, `maps`). Its `squishy.evolved` finishes the step. *Why:* starters grow up at 16–18, and the design doc wants one battle to do it.
- **The Seedling Scarf** is a `tutorial` item (account-bound, `tradable: false`), granted when the wardrobe step comes up (and again, as a no-op, on finishing). `ref_id` is uuid v5 of the player's id under a fixed namespace, so `(source, ref_id)` is one per account and never collides. The wardrobe step completes on any `outfit.changed` (wear the scarf, or change anything), so a replayer already wearing it is never stuck.
- **First Patch milestone hook:** `users.tutorial_completed_at` (the first completion; replays never move it). #44 reads it; no new event type.
- **Nightfall is scripted.** "Night falls" (`POST /tutorial/nightfall`, only on its step) runs the Hollow's own `runNightfall` on the Glade for the next night that hasn't run; the Hollow Man takes nothing there. **The nightfall sweep skips tutorial maps** (it didn't before: every finished Glade got a night forever, harmless but wasted). Since Phase 1 squishies sleep at home and one fire covers it, "move the squishy inside the light" isn't a beat yet.
- **Defend is posting a guard.** The step completes when the player puts a squishy on watch on their new tile; Sprout says the echo was shooed away. There is no simulated echo raid (a raid needs a real attacker and the raid log), so no stance pick is required; the raid report already offers the style.
- **Lore:** pages and their conditions are server-only (`LORE_PAGES`, `{ id, title, text, trigger: { mapKinds, eventType, where, finder } }`, the tutorial's predicates), found by a `lore` event consumer into `lore_found`, read through `GET /lore`. One page in the Glade (its night), two on patches (claiming old forest; a rescue). *(Superseded: the Lorebook has 12 pages in four chapters. See "The Lorebook (#307; PR #312, #315)", 2026-10-09.)* The bundle check fails if a page's title or words reach the client. A card shows a newly found page; Settings has the Lorebook.
- **On the client** the Glade gets the real bag, home base, battles, territory and the night (not chat). A gameplay step's bubble tucks into a small chip after "Let's go!", so it never covers battle moves or the home bar; tapping it opens it again. Spotlights only sit on buttons that finish the step from where they are (`TARGET_STAND_INS`), because a spotlight blocks every other tap.
- **Dev step jump** (`POST /tutorial/dev/step`, `HP_DEV_SQUISHY_GRANTS`): moves a run to any step as the engine would, for e2e and phone testing.

## 2026-10-03 — Patch Coins and the Boutique (#45)

_Proposed in the #45 PR; confirmed by the owner on 2026-10-04 (see "2026-10-04 — Owner decisions")._

- **Coins and the shop are the account's, not a patch's.** Issue #45 says "per player per map" and "per map time zone", but decision F, design doc §3 and §23 and tech spec §4 make Patch Coins account-level, and the Wardrobe (where the Boutique opens) has no patch. So the balance is per account, earning is capped per account day (`users.time_zone`), and the racks change at the account's midnight. `coin_ledger.map_id` still records where a coin was earned. *Why:* per-patch coins feeding an account wardrobe were the farm decision F closed.
- **A cached balance in its own row** (`coin_balances`, one per account) beside the append-only `coin_ledger`, changed in the same transaction and reconciled in tests. Its row lock serialises an account's credits and purchases, so an overspend check is one locked read. It isn't a `users` column: care takes `users` early (step 4) but battles finish under the battle and squishy locks, and taking `users` there would invert the order with the tutorial consumer (`users` → squishies). A sum over the ledger has no row to lock, so two purchases could both see enough.
- **Lock order:** `coin_balances` is tech spec §7 step 12, after squishies, inventory and `species_seen`, before `maps`. A purchase takes only that row. Four lock-order tests hold a lock from each side for care and a battle's finish, and fail with 40P01 if a credit moves to the wrong side (checked by moving it).
- **Exactly once:** `(source, ref_id)` is unique. A battle pays `battle` and `capture` against its own id. Care pays once per care action, against its `care_log` row, not one "account-day" key: care's daily cap already lives in `care_log.coins`, a per-day key would need one payout row rewritten all day (the ledger is append-only) or a late payout (the coin would arrive tomorrow). One row per paying action keeps it append-only, in the care transaction, and still once.
- **Earning** (`COIN_RULES`, `// TUNE:`): a win pays 2 (wild) or 3 (a tile or a rival's tile), a befriended squishy or a claimed tile pays 5, capped at 20 and 15 a day per account. Gentle's `rewardPercent` scales a tile battle's win and capture coins (`floor`), like its XP and finds. A rescue pays no coins: its Heartdust and find are already its capped reward. Care pays what `care_log.coins` says (1 per full action, 10 a day). Milestones (#44) call `creditCoins` with no cap. A busy day earns about 40. Tutorial maps pay like any patch (a first taste); the caps cover replays. *(Confirmed 2026-10-04.)*
- **The racks are worked out on read**, never stored: shared `boutiqueStock(catalog, { seed, date, seasons })` picks `dailySlots` (6) everyday pieces and `seasonalSlots` (4) of each season's that's on, each rack from its own child seed of the player's id and date. So there's no `boutique_stock` table and no `boutique-rotate` job (CLAUDE.md rule 4). The seed is the player's id, not a secret: knowing tomorrow's rack only lets a kid save up. A purchase rechecks the rack after taking the balance lock, so one that waits past midnight checks the new day.
- **What's sold, and for how much:** found everyday and Halloween pieces get the `boutique` source and a price by rarity (common 15, uncommon 30, rare 60, epic 100; `// TUNE:`). Legendary pieces and the future milestone pieces (Cozy Apron, Squishy Net, design doc §24) stay found-only. *(One exception: the Marigold Calavera costume sells at 320. See "Ten special Halloween costumes (#261, PR #265)", 2026-10-08.)* `checkBoutiqueData` checks prices are in range, a rarer piece never costs less, and there's enough to fill a rack. Halloween pieces sell only in the Halloween window, by the account's date.
- **A purchase writes no game event.** Events are per map and the shop has none; `clothing.found` is for finds. Others see a new piece when it's worn (`outfit.changed`). The piece is a `clothing_owned` row with `source: 'boutique'` and the purchase's id as `ref_id`, matching its ledger row.
- **On the client** the Boutique takes the Wardrobe's bottom card and the Keeper stays above it: tapping a piece tries it on (preview only, nothing sent), then asks "Get Witch Hat for 30 Patch Coins?" or says "Not enough Patch Coins yet!" with how to earn more. The patch list shows the balance. No real-money words, prompts or links anywhere.

## 2026-10-03 — Keeper milestones (#44)

_Proposed in the #44 PR; confirmed by the owner on 2026-10-04 (see "2026-10-04 — Owner decisions")._

- **A track is one counter with tiers on it** (`MILESTONE_TRACKS`, shared data; `SECRET_MILESTONES`, server-only): Territory ("Explorer"), Collector, Evolution, Caretaker, Defender, Rescuer and Halloween, plus The First Patch, and four secrets. Each tier gives a title, Patch Coins and sometimes a signature piece. Progress counts from game events through declarative sources (`{ eventType, where, player, distinct?, scaleBy? }`, the tutorial's predicates), so a new track is data. `checkMilestoneData` refuses a secret track in the public table (or the other way round), a reward piece that isn't an account-bound `milestone` item, and fields an event doesn't have.
- **Decision F applies to every event track, not just territory and defenses.** Progress counts only on patches with `minMembers` (2, `// TUNE:`) active members who had joined by the event, never on the Tutorial Glade. *Why:* anything on a solo patch can be farmed by a second account, and one rule is easier to trust than a list of which play is "map play". The First Patch reads the account instead.
- **Gentle scales the contribution, not the reward.** Progress is stored in hundredths of a step (`MILESTONE_UNIT`), and a `tile.captured` adds `rewardPercent` of a tile, so a Gentle capture of a much smaller player counts half. *Why:* "Territory (#15)" carries `rewardPercent` for milestones; scaling a tier's prize instead would make the same title pay differently depending on who you claimed from.
- **Exactly once:** the runner applies each event once, and a tier's `milestone_rewards` row is unique per `(user, milestone, tier)`. Its id is uuid v5 of the three, and it's the `ref_id` of the tier's coins (`creditCoins`, source `milestone`, no daily cap) and its piece (`clothing_owned`, source `milestone`), so every path that tries (a redelivered event, `GET /milestones`, the boot backfill) grants nothing after the first.
- **The First Patch** is granted when the Glade's last `tutorial.advanced` is consumed, on a finisher's next counted event, on `GET /milestones`, and by a boot backfill for accounts that finished earlier. No event and no login hook: the boot backfill covers everyone at once and login stays in the auth module.
- **Collector counts kinds befriended with a Heart Charm** (`squishy.captured`, distinct species), so a starter pick (no event) never counts. The tiers are 3 / 8 / 14, not the design doc's example 10 / 25 / 50: Phase 1 has about 19 kinds you can befriend.
- **Caretaker counts full-value care only** (`squishy.cared` with `full`), so 2,000 is months of daily care rather than an afternoon of tapping (decision G).
- **New signature pieces.** The design doc's example rewards include the Cozy Apron and Squishy Net, but they are already found (and tradable) pieces that "stay found-only" ("Patch Coins and the Boutique (#45)"). Milestones give 12 new account-bound pieces (`sources: ['milestone']`, `tradable: false`) instead; the Halloween track's top tier is the Harvest Moon Costume, that season's legendary costume. Secret milestones give titles and coins only: a piece would sit in the public catalog and give the secret away.
- **Titles:** the titles you own are the tiers you earned (no separate set), and the one you wear is `keepers.title_id` (nullable, additive). Other members see it on `MapMember.title` (additive), on the patch's member list, from their next view fetch.
- **Time zones.** Seasonal tracks (Halloween) judge the date in the patch's time zone; the Boutique uses the account's. *(Answered 2026-10-04: keep the patch's zone, see "2026-10-04 — Owner decisions".)*
- **Member count.** The `minMembers` check counts members with `status = 'active'` and `joined_at <= happened`. There is no `left_at` column, so it judges who is active when the event is consumed, not when it happened: a member who leaves before a late event is consumed (a replay or the first catch-up) stops counting for it. *(Answered 2026-10-04: keep it, a known edge case, see "2026-10-04 — Owner decisions".)*
- **No `milestone.earned` event.** Milestones are account-level and events are per map, and a secret's name must not reach other members. The client checks `GET /milestones` for `news` shortly after the player's own play arrives live (and after a battle closes), shows a celebration card, and marks it seen on the server so no other device shows it again.

## 2026-10-04 — The opening cinematic (#46)

_Proposed in the #46 PR; confirmed by the owner on 2026-10-04 (see "2026-10-04 — Owner decisions")._

- **The script is data, the drawing is the game's own.** `GREAT_SCATTER` (`packages/shared/src/data/cinematics`) holds the seven shots of design doc §25: duration, camera keyframes, captions, audio cues, the mood (colour drain, night, the Heartpatch's glow), actors with their paths and squish moves, and the world as hex regions. `checkCinematic` checks it: public species, real Keeper bases, keys in order inside their shot, captions of at most 12 words that stay up long enough to read (1.2 s plus 0.4 s a word, `// TUNE:`) with no avoided words, and the whole thing under 120 s. The client (`src/cinematics/`) evaluates the timeline with pure functions of time (monotone cubic easing, so holds stay still and arcs peak on their key) and draws it on the shared stage with the procedural squishies, Keepers, Hearthfires, Heart Seeds, map terrain and the Hollow Man. No video, no new files: about 111 s in a lazy chunk.
- **The colour drain is two image-processing uniforms.** Saturation (ColorCurves) and a dusky vignette from the edges, switched on neutral when the scene is built, so nothing recompiles mid-shot and there's no extra pass; the sky (the clear colour) drains by hand. The Heart Seeds' shatter is one thin-instanced mesh of glowing stretched seeds on gentle arcs, a pure function of time, not a particle system.
- **Spooky stays soft** (style guide §5): he fades in at the trees' edge, flickers twice, never comes close or speaks, glides towards the glow (never the camera) and fades as it breaks. The music drops out under him; his sound is the existing low hush. The shatter is a glassy shimmer, never a crash. The taken squishies turn shadowy and drift into the trees, and the next shot's words point at bringing them home.
- **Viewed flag on the account:** `users.cinematic_seen_at` (one additive migration), `GET /cinematic` and `POST /cinematic/seen`. Marking is idempotent (`coalesce`, the first time stays). It's set when the story ends **watched or skipped**, including the first-view long press: otherwise a kid who held to skip would get it again at every login.
- **Flow:** Keeper pick → story (first time only) → tutorial and lobby. The game never waits on it (decision A): if the server can't say whether it was seen, the renderer can't start, or the chunk can't load, it goes straight on. Settings → "Watch the story" plays it again, with a Skip button.
- **Skipping:** a tap moves the captions on; holding anywhere for 1.2 s skips (the "Hold to skip" chip shows a filling ring, style guide §3 "no hidden essentials"); Skip is a button once it has been seen (and always on a replay from Settings); on a keyboard, Space/Enter advance and Escape skips, even the first time, since a keyboard has no long press. "Log out" stays above it.
- **Reduced motion** (`prefers-reduced-motion`): the camera holds each shot's settled framing instead of travelling, flicker keys are dropped (no flashes), squishies don't breathe, and the title doesn't rise. Dissolves stay: they're slow fades, not flashes.
- **Music and sound:** a new `wonder` loop (F major music box) for shots 1–3 and 7, silence under the Hollow Man, the night loop for the land today; new cues `bloom`, `shatter`, `seed-land` and `title`, all synthesised (DECISIONS "Audio (#25)"). `GameAudio.setScore` lets the story pick the music and hands it back after.
- **e2e:** every spec's signup marks the story seen through the API (`skipCinematic` in `players.ts`) before the Keeper pick; `cinematic.spec.ts` is the only one that watches it.

## 2026-10-04 — Owner decisions

The project owner's answers to the questions left open by #24, #44, #45 and #46.

- **The tutorial is required at launch and for the playtest.** Production sets `HP_TUTORIAL_REQUIRED=true` (`infra/compose/.env.prod.example`): a new account finishes "The First Patch" before creating or joining a patch. Design doc §26 already lets a player skip only after a first completion. Decision A still holds: the flag is an env setting, so the operator can turn it off with a restart if the tutorial misbehaves, and "Later" and "Log out" never trap a player. Local dev and e2e keep the code default (`false`). *Why:* the tutorial is built, and the playtest should run the real first-time flow (Keeper, story, Sprout, starter pick, invite).
- **Tutorial play pays Patch Coins like any patch.** Battles, captures and care in the Glade pay as they do elsewhere, under the same per-account daily caps, so replaying the Glade earns no more than playing alone. *Why:* a new player reaches the Boutique step with a few coins, and the caps already close the farm.
- **The Halloween milestone track keeps the patch's time zone.** Whether Halloween is on for a milestone event is judged by the patch's local date, as spawns, recipes and buildings are. *Why:* if a Halloween squishy appears in a patch, catching it always counts; the account's zone could refuse credit for a catch the patch offered, near the window's edges.
- **The milestone member count stays as built.** It counts members who are active when the event is consumed and joined by the event (no `left_at`). Known edge case: after a restart with a backlog, a member who leaves before the backlog is consumed stops counting for those events. Revisit if `map_members` gains a `left_at` for another reason. *Why:* it needs a restart and a leave within seconds, costs at most a progress tick or two, and a core-table migration isn't worth it before the playtest.
- **The #24, #44, #45 and #46 entries above are confirmed as recorded**, including the 15-step tutorial with the Glade friend and scripted evolve and nightfall, the Boutique's prices and racks, the milestone tracks, tiers and signature pieces, and the cinematic. Their numbers stay `// TUNE:` data for after the playtest.

## 2026-10-04 — Playtest fixes: gathering, growing up, care

_From the owner's first playtest (gather "did nothing", the starter never evolved, care wasn't explained). The tuning target is the coordinator's; the rest is proposed in the `Fix:` PR._

- **A starter grows up after about 12–15 wild wins at 1× care.** Battle XP goes from 4 to **20 per opponent level** (minimum 5 → 20; `data/battle.ts` `xp`, `// TUNE:`), so a wild win (levels 2–6) pays about 120 XP. The XP curve and the evolution levels stay as they are, so every later or rarer evolution keeps its ratio: from level 1 at 1×, starters at 16 take ~12 wins, Thistlepip and uncommons at 18 ~15, rares at 22 ~22, epics at 26 ~31, legendaries at 30 ~40. `growth-pace.test.ts` pins it. *Why data, not the curve:* the curve is recorded above and its numbers are in tests and docs; battle XP is one tuning row. *(Superseded 2026-10-06: the XP curve did change and wild levels now follow the Partner, so a starter grows up after about 22–29 Partner-matched wild wins at 1× care. The 20 XP per opponent level stands. See "The level curve and wild levels (#182)", 2026-10-06.)* *(Now 23–30, see "A wild squishy wanders off; fairer wild levels (#208, PR #211)", 2026-10-06.)*
- **"About 5–6 wins with full care" can't hold alongside 12–15 at 1×.** XP is linear in the care × habitat multiplier. Care alone tops out at 1.75× (design doc §7), which gives 7 wins for Emberbun and Puddlepuff and 9 for Thistlepip; a new starter's 137% gives 9 / 11. The 3× cap gives 4 / 5, but needs full care *and* a habitat matching both element and feeling, which only Emberbun has today (Ember Den); Thistlepip's best (Cozy Meadow, 2.36×) gives 7, and Puddlepuff has no matching habitat. We kept 12–15 at 1× as the primary target. Revisit with the habitats list if Puddlepuff and Thistlepip should reach the cap too.
- **Guardian fights pay more too.** Battle XP scales with opponents' levels, so a strength-5 guardian fight (~48 levels) now pays ~1,440 base XP. `pnpm sim` (battle balance) is unaffected: 0 flagged.
- **The map draws home nodes.** Each home base's Timber, Stone, Emberwood and farm plot stand in their tile's middle on the map (as on the Home view), so "tap the tree tile" has a tree. The map registers the tutorial's `resource-node` locator (the player's Timber node).
- **The spotlight follows the game.** The tutorial overlay lays out again when the game's DOM changes (a panel opens, a countdown becomes Collect) and when the scene draws a frame (a camera pan), and touches no DOM when nothing moved. The gather step walks Gather → the countdown → Collect (or the Bag's Collect) *(Superseded 2026-10-06: Gather → the countdown → the pop-up; see "Finished things go straight to the bag (#177)", 2026-10-06)*. The first-battle and evolve steps spotlight "Find a squishy"; the care step spotlights Feed / Pet / Play rather than "Up close".
- **Gathering always shows.** A persistent chip under the map's name says "Gathering 🪵 Timber… ready in 14:05", then "🪵 Timber is ready! Tap to collect" (it opens the Bag). *(Superseded: the chip has no Collect any more; see "Finished things go straight to the bag (#177)", 2026-10-06.)*
- **Care explains itself.** The care sheet's "Growing up" is open by default and starts with why care matters (happy squishies learn more from battles and grow up faster; happiness fades over about a day); the level line says when a squishy grows up ("Level 7 · grows up at Level 16") on the care sheet and the close-up.

## 2026-10-04 — The opening story's "Your part", a scarier Hollow Man, and starter Heart Charms

_Proposed in the story-and-charms Fix PR, from the owner's playtest notes and decisions of 2026-10-04; the project owner confirms on merge. The #46 entry above stays as the record of what #46 built; where they differ, this entry wins._

- **"Your part" (shot 8, about 24 s) before the title (shot 9).** The story now also teaches the player's role in four beats with soft dissolves: plant the seed and light the Hearthfire; claim land round home, grey tile by grey tile turning colourful; care (a boop, hearts, the squishy glows); and befriend a wild squishy with a Heart Charm (a toss, three wobbles, a happy bounce). Shot 7 is trimmed to the seed landing ("Now it's your turn!"). The story runs about 132 s. *Why:* the playtest showed the backstory but not what a new Keeper does.
- **The cap is 150 s** (`CINEMATIC_MAX_SECONDS`, coordinator decision). Hold-to-skip, tap-to-advance and Skip are unchanged.
- **The cinematic schema grew a little (additive, optional and defaulted, no migration; coordinator-approved 2026-10-04).** Actor kinds `heart-charm`, `hearts` (a puff rising from a spot) and `joy` (a squishy's glow as a warm light); an actor key `reach` (only the Hollow Man; `checkCinematic` refuses it on anyone else); per shot, `claims` (world tiles that keep their colour from a time, checked to be real tiles and claimed once) and `shakes` (camera shakes of at most 2 s and 0.3 units). *Why:* tile-by-tile colour, his reach and the toss are story data like everything else (CLAUDE.md rule 5), not engine code keyed to a shot.
- **Claimed land is a twin tile drawn outside the drain.** The world's tile stays grey under the mood's colour drain; a copy on top uses the story's "hope" image processing (as the Heart Seeds already do) and pops up from its middle at its claim time. One thin-instanced mesh per ground ever claimed. The colour comes back to the whole world behind the dissolve into "care".
- **Spooky-tense, not spooky-soft (owner decision; style guide §5 updated).** The Hollow Man is taller and thinner, darker, with a ragged cloak and long arms (both arms are thin instances of one mesh, so he's three draw calls, not two). In shot 5 he glides to the Heartpatch and reaches; the joy drifts out of every squishy into his hands as little lights; his eyes flare; a low rumbling `hollow-sting` rises; the Heartpatch shatters with a 0.7 s camera shake; and a `cold-wind` blows the lights and the squishies away. His eyes keep their colour through the drain. Hard limits held: no gore, no jump-scares, he never rushes at the camera or speaks. The map's nightly visit uses the same mesh with his arms down and no flare.
- **Reduced motion:** no shake, no flicker (flash keys are dropped, as before), and his eyes never flare. Claimed tiles still turn colourful (a colour change isn't motion), but appear without the pop.
- **Starter Heart Charms (owner decision).** The account's very first starter pick on a patch also puts `STARTERS.firstPickGift` (3 Heart Charms) in that patch's bag, in the pick's transaction, through `grantItems` (the tutorial bag's path) with the new ledger reason `starter`, pointing at the new squishy. "First" is read from the pick markers themselves: no other membership of the account (archived ones too) has a starter. So a second patch, a joined patch, a rejoin, a retry (Idempotency-Key replays the same reply; a fresh pick is `CONFLICT`) and racing picks grant nothing more. The pick now locks the account's `users` row before its member row, the order joining and leaving already use, so first picks on two patches run one at a time; for an owner the member row is the seats row, so an owner's pick takes the seats lock first, then `users`, as approve does; `lock-order.test.ts` checks both sides. The reply gains `gift`, and the starter screen shows "Sprout tucked 3 Heart Charms in your Bag!" before the map. No migration: `resource_ledger.reason` is plain text. *Why not a `users` marker:* it needs a migration, and the markers already say whether an account has picked; maps are never deleted by the game.
- **Tutorial graduates get them too.** Sprout's little bag (3 Heart Charms) belongs to the Glade's own inventory and nothing in the Glade carries over (#24), so a graduate also reaches their first patch with none. *Why:* the data says they'd otherwise arrive empty-handed, and one rule is simpler.
- **Accounts that picked a starter before this shipped get nothing.** Their first pick has happened; the gift is for day one.

## 2026-10-04 — Squishy jobs (Fix PR)

_Proposed in the squishy-jobs Fix PR (owner decisions of 2026-10-04: one job at a time, pick your team, workers add gathers, show the trade-offs); the project owner confirms on merge._

- **One job, stored where it already lived.** The team slot and a gatherer's work are new nullable columns on `squishies` (`team_slot`, `work_tile_id`, `work_since`, `work_started_at`; a check keeps team and work apart, a partial unique index keeps one squishy per slot). Guards stay in `tile_defenders` and beds in `habitat_building_id`. The job is read from them (shared `jobOf`; a watch post wins a stale row). *Why:* existing guards and housed squishies are already jobs with nothing to migrate, so nothing changes for current players, and a hand-written backfill would be lost when migrations are regenerated before merge (tech spec §4, the reason "Owner rules pass" gave too). Every command that changes a job locks the squishy, as housing and posting already do.
- **A new job replaces the old one; swapping is free unless it's in the Hollow.** The job board's Team / Gather / Rest and the team picker take a squishy off its watch post or work tile. Posting a guard takes it off the team or its tile. Housing a gatherer stops its work; a team member keeps its bed (the team is who comes along to battles, not where it sleeps). Becoming a gatherer moves a squishy out of its habitat (housed or working, not both, like "housed or on watch"). Posting a housed squishy as a guard is still refused as before ("Move it out first"): unifying that with the gatherer's move-out is a small follow-up if the owner wants it.
- **Taken off its tile, a gatherer's finished cycles go in the bag; the part-done one is let go.** Same when the Hollow Man takes it at nightfall (its day's work counts). *Why:* "collected or kept, keep it fair": banking at once needs no extra column, and the cycle that hadn't finished was never earned.
- **Speed is a list of whole-percent modifiers** (`workSpeedModifiers`, combined by `combinePercents`, each floored, never below 100): today just the match, so a timed food boost (a later session) joins as data (coordinator, 2026-10-04).
- **Banking locks items in item-id order.** A collect, or banking several gatherers at once (nightfall), locks every inventory row it will grant per owner in item-id order before any grant (`lockGrantRows`), as `consumeItems` does; per-squishy grants alone would lock in squishy order and could deadlock with a building's cost.
- **Work is timestamps and a cap.** Finished cycles are worked out from `work_since` on read or collect, up to `JOB_RULES.work.maxStoredCycles` (4, `// TUNE:`); a full gatherer stops, and starts again from the collect *(2026-10-06: from the next settle; see "Finished things go straight to the bag (#177)", 2026-10-06)*, so idle time past the cap is never paid. A cycle is the source's gather time × `cyclePercent` (200, `// TUNE:`) ÷ speed: 100 / 135 (element, or a seasonal species for Pumpkins, matches) / 175 (and the feeling) percent, the habitat match's whole-percent maths. Each cycle pays what was in season when it finished (Witch Dust with Emberwood and Pumpkins around Halloween), so collecting late changes nothing. A gatherer left on a Pumpkin field after Halloween finds nothing, and the job board says so on its row.
- **What a gatherer works:** a gatherable node on any of my tiles (home nodes too), or land outside my home base whose terrain has a yield (`JOB_RULES.terrainYields`: less than a node). One gatherer per tile per player, checked under the player's member lock. The Keeper's own gather can run on the same node: the worker is an extra pair of paws, not a replacement.
- **Land that changes hands stops the work** (`squishyAtWork`: the owner still holds the tile and no capture of it ended after the squishy started), and what wasn't collected is lost, as with a Keeper's gather (#17) *(updated 2026-10-06: what finished before the capture is still banked and only unfinished work is lost; see "Finished things go straight to the bag (#177)")*. Captures and leaving need no change: the work is just no longer "at work", even on land won back later.
- **Battles read the team at their start only** (`listTeam`): the picked team in slot order, active ones only; with nobody picked (or all in the Hollow), the strongest resting squishies, never guards or gatherers. Replaces "A squishy on watch still joins its owner's battles until team picking arrives" (#15) on patches. **On the Tutorial Glade the old team rule stays** (`listTeam`'s `guardsToo`): its Glade friend stands watch in the `defend` step and still fights beside the Partner in the `evolve` battle, and the job board, team picker and their buttons don't open there, so the tutorial runs exactly as before. Rescues keep their `soloTeam`, which now also steps in when every squishy that isn't in the Hollow is guarding or gathering (the one being rescued helps, so a rescue is always possible).
- **Night risk reuses the exposure rule:** a gatherer sleeps on its work tile (`sleepsAt`), so outside every lit fire's safe tiles it's exposed. Guards stay sheltered by being on watch (design doc §14, decision C), so "at risk the same way as guards" in the brief reads as "the same rule every squishy follows". The job board shows each spot's firelight before assigning.
- **Routes are POST commands**, like the rest of the API (`POST /maps/:mapId/squishies/:squishyId/job`, `POST /maps/:mapId/team`), not the brief's PUT: the client's API helper only speaks GET and POST, and tech spec §5 says commands. Events are `squishy.assigned`, `team.picked` and `work.collected` (the registry's `noun.verb` names; `squishy.job.changed` would fail its test). Members see only `squishy.assigned`'s whose and where (`from` / `to` work tiles), never which squishy or job: squishy ids link to `squishy.leveled`, so naming them would show a rival which squishies guard or gather where. `team.picked` goes only to its player. Ledger reason `work`, ref the squishy.
- **Client:** the job board and team picker are self-contained sheets in `apps/client/src/squishies/jobs/` (`openJobBoard(mapId)`, `openTeamPicker(mapId)`) for the trays to open. Temporary entry points, to be moved: home's "🧺 Jobs & team" button, "⚔️ Team" and "🧺 Jobs" (`mountTeamButton`; now rows in the My Heartpatch tray, #122), and the tile panel's "🧺 A squishy is gathering here" line and "Send a gatherer" button. The map shows a 🧺 badge over every tile with a gatherer: a DOM overlay (`gatherer-badges.ts`, a map layer) placed with `tileScreenRectOf`, the map scene's one tile projection (#117's `resource-node` locator, exported in its own commit; coordinator-approved), kept live from `PublicTile.workers` and `squishy.assigned`. *("My Heartpatch" is now "My Home" and "Raid report" is "Challenge report", 2026-10-06; see "Words: My Home, patch and land (#181)".)*

## 2026-10-05 — Terrain visual pass

_Proposed in the terrain visual pass PR (owner playtest: "the terrain … could use a bit more excitement and variety")._

- **Every terrain is dressed, from data.** `TERRAIN_DRESSING` (`apps/client/src/map/map-config.ts`) lists each terrain's props with weights, scale ranges, colour tints and a per-tile count; mountains always lead with a peak, reeds and docks sit at the rim facing out. Meadows (flowers, grass, mushrooms, bushes) and lakes (lily pads, reeds, stones, a dock) are no longer bare. Placement is hash-seeded per tile (`dressTile`), so every device draws the same patch, and a terrain this client doesn't know gets the meadow's. `TerrainLook.prop` and `propsPerTile` stay as they were for the cinematic and battle arenas.
- **Small per-tile wobble.** Each tile's colour (±5% brightness, a touch warmer or cooler) and height (±0.012–0.025) vary a little by hash, so neighbours don't look stamped out; water stays level. It's per-instance data on the same one-mesh-per-terrain draw.
- **Wild land is drawn muted; owned land in full colour.** Tiles nobody owns (and their props) keep half their saturation, a little darker and washed towards a soft grey-lilac (`MUTED`), which matches Sprout's "See the grey land?" and the story ("bring the color back, one patch at a time"). Claiming a tile brings its colour back live. Juniper's Gap always stays in colour (it's where every squishy was born), and the island under the tiles is muted part way so it doesn't outline grey tiles in bright green. Enough colour stays that terrains still read apart.
- **Ambient life runs on the GPU from one time uniform.** A terrain material plugin (`terrain-plugin.ts`, GLSL like the squish plugin) sways grass, flowers, reeds and trees by vertex height, bobs and glints the lakes (lily pads ride the same wave), and drifts the motes: pollen and falling leaves by day, fireflies at night, sparkles over Juniper's Gap, and in Halloween bats and fog wisps. No per-object `onBeforeRender`; each mote kind and each prop kind is one thin-instanced draw call. Under WebGPU (opt-in) the plugin isn't attached: props stand still in full colour, motes aren't drawn, and tiles are still muted (that part is CPU-side).
- **Ambient life keeps the frame budget.** While it's live the map asks for a frame about every 33 ms (the close-up's breathing pace), so on a 60 or 120 Hz display the governor doesn't sample those frames (at iOS Low Power Mode's 30 Hz every frame is drawn and sampled, as with the close-up's breathing). The low quality tier turns it off; medium draws half the motes. Reduced motion holds everything still, shows no drifting motes, and the map draws nothing on its own again. If most frames in a window of 10 arrive further apart than 55 ms, after the first 2 s (the device can't keep up, GPU or main thread alike), ambient life switches off for that visit. A majority, not an average, so one hitch never switches it off, and a software renderer at a second a frame (CI) is caught within a few frames; time spent with the page hidden doesn't count. iOS Low Power Mode's 30 fps cap stays under that line.
- **Halloween dressing follows the map's local date** (shared `activeSeasons`, as spawns and milestones do; the music reads the device's date): about 40% of pumpkins become glowing jack-o'-lanterns (brighter at night), a few bats circle the woods and peaks, fog wisps drift over low land, and the backdrop under the island glows orange into purple at night. Off outside the window. The season is read when the map is built.
- **A soft backdrop under the island** replaces the flat clear colour near it: a warm glow fading out, with a ring of slow clouds, lavender at night. It fades to the clear colour at its rim, so the Hollow Man's night sky still shows beyond it.
- **Cost:** a typical 4-player patch goes from 29 to 49 draw calls (52 in Halloween), the Glade from 32 to 49 (in Halloween), all instanced. Small parts use few segments (`sphereSegments`), so about twice the props draw about a fifth more triangles (about 570k to 675k on the 4-player test map; a unit test holds it under 720k). The client's shared chunk grows by about 9 KB gzipped.
- **Battery and heat, knowingly.** The map no longer sits idle while it's open: it draws about 30 frames a second while ambient life is live (tech spec §6 "Memory and heat" chose render on demand). The judge only catches devices that can't keep up, not ones that run warm; the low tier and reduced motion bring back the idle map. Revisit after the playtest if devices run hot.
- **Jack-o'-lanterns glow on wild land too.** Muting changes a prop's colour, not its glow: a lit lantern glows wherever it is.

## 2026-10-05 — Recipe book and unlocks (Fix PR)

_The owner's decisions of 2026-10-05, proposed in the "immersive controls" `Fix:` PR with the side trays below._

- **The recipe book has one page per thing you can make:** every craft recipe (`recipe:<id>`) and every building you can put up today (`building:<id>`, kinds in `buildableKinds`; its ingredients are the level-1 cost). Pages come from the data (`recipeBookPages`, `packages/shared/src/recipe-book`), so new content gets a page with no code change. *Why:* kids discover what to make through what they find, instead of facing the whole list on day one.
- **A page opens the first time the account has collected every ingredient it needs, on any patch.** "Collected" means the account has ever received a positive amount of it, for any reason (gathers, crafts, capture drops, rescues, Sprout's bag, take-down refunds, dev grants). It's derived from `resource_ledger` (the distinct `item_id`s of positive rows on the account's maps, through `map_members`), so there's no new table or migration. Spending everything never seals a page again. A building made from a crafted item (the Jack-o'-Lantern Hearthfire) opens once that item has been collected, by the same rule.
- **Always open:** the Heart Charm, the Hearthfire and both habitats (`RECIPE_BOOK.alwaysOpen`), because the tutorial and a first session make them. The tutorial crafts nothing (Sprout's bag holds the Heart Charms), so nothing else needs opening.
- **A sealed page can't be made.** Starting a craft or placing a building whose page is sealed is `FORBIDDEN` ("That recipe page is still sealed! Collect everything it needs first.", and the same for a building page), checked in the command's transaction before anything is spent. The check only reads the ledger and takes no row locks, so the lock order (tech spec §7) is unchanged. Moving, removing and fuelling buildings aren't gated, and seasonal pages still follow the season rules.
- **Sealed pages show a short public hint** (`RECIPE_BOOK.sealedHints`: at most 20 words, no avoided words, checked by `checkRecipeBook`). Hints and `whereToFind` use only public gather, terrain, map and season data, never spawn tables or anything under `data/server` (CLAUDE.md rule 6). `GET /recipe-book` returns the open page keys; the client draws the pages from shared data.
- **The client draws it as a little book** (`apps/client/src/recipes`): a cover, a contents page, one page per recipe on a phone and two-page spreads on a tablet held sideways, turned by a swipe or Next/Back (a crossfade with reduced motion). Each page keeps have/need per ingredient ("0/1"), "Where to find it" from `whereToFind` (terrains, the home ring, gather bonuses, recipes), "Find on map" (the player's nearest tile with that node, or one whose gathers bring it as a bonus), and "Make it" through the bag's own `POST /crafts` or "Build it" (opens Home). Ribbon tabs jump to Make, Build and each season; a bookmark shows only what can be made now; search covers open pages only, so sealed ones stay a secret. *"New page!":* which pages the player has looked at is kept on the device per account (`localStorage`), not on the server: there's no existing "seen" table that fits, and a page saying "New!" once more on another device costs nothing. The first look counts every open page as seen, so the starter pages aren't "new".

## 2026-10-05 — Side trays, the Keeper menu and the tile chip (Fix PR)

_The owner's playtest note of 2026-10-04 ("visually very cluttered… slide-out trays") and the approved mockup; proposed in the "immersive controls" `Fix:` PR._

- **The world stays full-screen; the map's controls live in two side trays** (`apps/client/src/ui/trays`). "Adventure" on the left: Find a squishy and the Catalog, Claim land, the raid report and defense style, the Hollow (and, from the squishy-jobs work, the team). "My Heartpatch" on the right: Home, the Recipe book, the Bag, the "light a fire" nudge (and squishies' jobs). Each tray has a big labelled handle at thumb height (64×94 pt); one tray opens at a time, the open tray carries its handle so the same tap shuts it, and tapping the world, Escape or an entry inside shuts it. Trays slide on `transform` only (no layout per frame, no WebGL); with reduced motion they fade in place. A pure reducer (`tray-state.ts`) holds the rules and is unit-tested. *("My Heartpatch" is now "My Home" and "Raid report" is "Challenge report", 2026-10-06; see "Words: My Home, patch and land (#181)".)*
- **Features keep their own buttons and mount them into a tray** (an additive `entryRoot` option on the bag, home, raids, the Hollow and chat, `buttonRoot` on the lobby), so each feature still owns its logic and test ids. The battle lane builds Find a squishy and the Catalog, so `main.ts` moves that box into the Adventure tray until the battle screen takes an `entryRoot` too.
- **News is a glowing badge on a handle, not a banner.** Anything in a tray marked `data-tray-alert` counts towards its handle's badge, and a short line peeks out beside the handle for a few seconds when it's new (a raid report, a friend in the Hollow, a new recipe page, the fire nudge). The raid report no longer opens by itself over the map. The Hollow's morning report still does: it's the design doc's morning summary, with a rescue button.
- **The corner holds the rest.** "My patches" in the top-left corner; Chat and a round Keeper button in the top right. Over the map the "Hi, name! / Log out" chip folds into that Keeper menu (Wardrobe, Settings, Log out). It stays above Sprout's layer, so "Log out" is always two taps away, even mid-tutorial.
- **A tapped tile shows a compact chip** at the bottom: its name, whose it is, its guardians, and the 1–3 actions features put there (Gather or Collect, Go home, Claim or Challenge, Pick guards; *Collect superseded 2026-10-06, see "Finished things go straight to the bag (#177)", 2026-10-06*); what the land is like folds behind an (i) button.
- **Sprout's first-time hint** points at both handles once per account, on a patch (the Glade has Sprout already); opening a tray or "Got it!" answers it.
- **"Find on map"** selects the tile and glides the camera there (`MapCamera.panTo`, a 0.6 s ease-out; a jump with reduced motion; a finger takes over at once).
- **The tutorial follows the controls.** A button in a shut tray isn't spotlighted (it's hidden, not gone); its tray's handle stands in, so Sprout points at the handle first and then at the button inside. Sprout's lines say where things are now ("Open Adventure on the left, tap Find a squishy…").

## 2026-10-05 — Test flakes and job-queue contention (Fix PR)

_Stabilizing `main`: three reliability defects fixed at the root._

- **Event-consumer and nightfall queues use pg-boss's `short` policy, not `stately`.** Both de-duplicate on the `singletonKey` (one queued job per map, or per map and night); only `stately` also forbids a second *active* job per key, with a unique index. pg-boss's fetch skips keys it cached as active (refreshed once a minute), so a wake-up for a map whose job was already running was fetched by an idle worker, tripped that index, and Postgres logged `duplicate key value violates unique constraint "job_common_i3"` on every poll until the job ended (the CI Postgres log was full of them for `event-consumer.tutorial`). Nothing needed the one-active guarantee: `runConsumer` serializes a (consumer, map) pair on the `event_consumers` row lock, and nightfall claims its `hollow_events` row first thing. A wake-up during a run is now a job of its own that takes its turn, which is what keeps it from being lost. pg-boss never changes a queue's policy once created, so `ensureQueue` (`jobs/queues.ts`) drops and recreates a queue whose policy differs; every queue's pending jobs are rebuilt at boot (the catch-up, the sweep), so that's safe.
- **The dev test hook is installed before the first drawn frame.** The stage marks the canvas `data-ready` on its first `scene.render()`, and specs wait for that before reading `window.__heartpatch`. The hook was installed after the dynamic import of the dev overlay, so under CI load the frame could win and `camera()` read as "not ready" (smoke.spec, one run in five groups). The hook now goes in right after `boot()` resolves, before any further `await`; the first frame is a task away at that point, so `data-ready` implies the hook.
- **Auth route tests hash nothing.** Argon2 is swapped for a cheap stand-in (`tests/fake-secrets.ts`, via `vi.mock` of `secrets.ts`) in `auth.test.ts` and in the new `auth-rate-limit.test.ts`, which also fakes the window clock (`vi.useFakeTimers` on `Date` only) so the rate-limit tests count attempts and move the window themselves: 30 full-cost Argon2 checks under a parallel `pnpm test` was what timed out, and the recovery test (eight hashes under a 5 s default timeout) was next in line. The real hashing is pinned in `secrets.test.ts` (Argon2id prefix, round trip, wrong secret, a stored value that isn't a hash, the dummy check).

## 2026-10-05 — Bug bash: screens (Fix PR)

_Fixes from the bug bash of 2026-10-05, "screens" lane (#130, #131, #135, #144, #145, #146, #156, #157, #158, #160)._

- **The patch list says who's waiting (#144).** `MapSummary` (`GET /maps`) carries `pendingRequests`, the join requests waiting on the owner, counted in the same query; it's 0 on a row the player doesn't own. The lobby shows "1 wants to join!" on the row. *Why:* the request was only visible inside the patch's detail, so owners never noticed it.
- **A joiner's lobby asks again every 5 s while a request waits (#145)** (`WAITING_POLL_MS`), only while the patch list is on screen and the page is visible. *Why:* the joiner isn't on the patch's live channel until they're a member, so nothing can push "yes" to them; a reload-free lobby was the ask.
- **A reload or log-in lands on the last patch visited (#160),** kept per account on the device (`localStorage`), unless a tutorial run opens the Glade by itself. The server still decides whether the patch opens; a patch the player left or was removed from is forgotten.
- **The Add to Home Screen guide is a card in the patch list (#135),** not a layer of its own, so it never sits under the sign-in card or over Sprout.
- **Home base tiles are a warm sand up close (#131),** not the map's cream: alone and big under the sun, cream tone-mapped to white and bloomed, and the white "glowing spots" vanished into it. The spots are pink rings with a soft fill.

## 2026-10-05 — Bug bash: rules polish (Fix PR)

_The bug-bash issues #134, #147, #150, #151, #152 and #153, worked in the "rules-polish" lane._

- **A rival's shielded land says why it can't be challenged, on the client, from public facts.** `MapMember.joinedAt` and `TERRITORY_RULES.newPlayerShieldHours` are already public, so the tile chip's reducer (`territory-action.ts`, `shieldUntil`) works out the same shield the server checks and shows the server's own line ("This Keeper is new here. Their land is safe for now. Try wild land!") instead of a Challenge button that would be refused. Land that isn't next to yours says "Too far away! Try land next to yours." The server still decides every rule (CLAUDE.md rule 1): the client only stops offering what it knows will be refused. *Why:* a tile with no action and no reason is a dead end (style guide §3).
- **A grace night with squishies in the dark is reported** (#134). `MorningReport` gains `exposed` (additive, already stored per night in `hollow_events.outcomes`): a night where nobody was taken but some of mine were out in the dark shows "He came by, but took nobody this time. Light a fire before night falls!" The two grace nights taught nothing before: the report card only told nights with a taken or a sheltered squishy. A night where none of mine were there still says nothing. The rest of #134 (whether he ever takes a player's last squishy, and how a Lv1–2 starter's rescue can be won) is an owner call, asked through the coordinator.
- **Sheets that can grow keep their way out in reach.** The catalog's card fills the screen and only its grid scrolls, with a round × in the header beside the bottom Close (#150). The Boutique's rows are declared as `.wardrobe-card.boutique-card`, so they win over the wardrobe's six rows whichever stylesheet loads last (the footer was being laid out in a zero-height row and drawn over the last rack, #151). The part of #151 about map buttons over the Wardrobe doesn't reproduce on `main` since the side trays (#122): they hide with the map.
- **A row of chips that scrolls sideways fades at the edge with more behind it** (`scroll-edges.ts`, `data-scroll-more`, #152), so a cut-off tab reads as "slide me". Wrapping the nine tabs and six filters would take the item list's room on a phone.
- **Care buttons are rounded tiles with the cost on its own line** ("🍪 Feed" over "3 Treats", `CareButton.sub`), using the shared padding tokens, and the care sheet's blob has the species' face (eyes, mouth, cheeks and tummy from `visual.parts`, `squishyFace`) so it reads as the squishy (#153). The close-up view still draws the real one.

## 2026-10-05 — Owner decision: the last friend, and "easy" guardians (#134, #162)

_The owner's answer, through the coordinator, to the bug bash's P1: a Lv1 starter has 12 energy, so a counter-matchup guardian takes it out in one move at any level, the Lv1 Nookling shadow beats a Lv1–2 Silly starter every time, and a player whose only squishy was taken had nothing left to play with._

- **The Hollow Man never takes a player's last active squishy** (`mayTakeFrom`, `packages/shared/src/hollow`; design doc §14 "…but never your last friend"). Active means not already in the Hollow, wherever it sleeps: a second friend safe at home or on watch is company enough for him to take the one in the dark. The night still counts the dark, so the report says he came by and took nobody, and asks for a fire. *Why:* a rescue a fresh squishy can't win is a dead end; with a friend left, the player can befriend, battle and grow before rescuing. "If every squishy is in the Hollow, the one being rescued fights" stays as a safety net (nothing else takes squishies yet).
- **Strength-1 guardians are level 1–2, and "easy" means strength 1 only** (`GUARDIAN_RULES`: `levels {1, 2}`, `hint.easyUpTo: 3`, both `// TUNE:`). The old band (total level up to 6) called a Lv4 Mossmuffin "easy" next to a Lv1 Puddlepuff. In a counter-matchup a lone squishy still loses at any level by design (the matrices), so "easy" is honest about levels, not matchups.
- **Follow-up after Halloween (option C):** raise `BATTLE_RULES.stats.hpFlat` (10 → about 20) so a level-1 squishy has about 22 energy and every battle runs a hit longer, then re-run `pnpm sim` and re-pin `growth-pace.test.ts`. Not now: it re-tunes every fight in the game.

## 2026-10-05 — Owner decision: mild potty words stay out of names (#155)

_The owner's answer, through the coordinator: "Mr Poop Butt" was accepted as a Partner's name and showed on every screen._

- **Player-chosen names (usernames, nicknames, outfit names) refuse mild potty words** (`POTTY_WORDS` in `apps/server/src/lib/filter.ts`, `// TUNE:`): poop, butt, fart, booger, puke, barf, pee, crap, dumb, stupid, loser and the like (the English profanity set already holds the ruder ones). Checked like the rest of the name filter: NFKC, leetspeak and look-alikes through obscenity's transformers, and again with separators squashed, so "B_u_t_t" counts. Everyday words that hold one are whitelisted or bounded ("Butterfly", "Button", "Saturday", "Scrappy", "Peekaboo", "Dumbo" stay fine). The answer is its own reason (`potty`) with a kid-friendly line: "Let's keep names sweet, not stinky! Try another one."
- **Messages don't get the list.** Phase 1 chat is preset ids, so no free text exists; if it ever does, a potty word in a sentence is a different question from one on a name tag. The server stays the only filter (CLAUDE.md rule 9).

## 2026-10-05 — Single taps and collect (Fix PR)

The owner's playtest of latest `main` in a desktop browser: "I had to double click on everything" and "collect didn't work". Reproduced with real mouse clicks at 1440×900, 1280×800 and 800×900, and with held presses (down, 120 ms, up) in iPhone and iPad emulation. No click was ever lost: every control fired on one click, and no pressed node was replaced under the pointer. The first click was *consumed by UI state* instead:

- **A tap sticks to the button it landed on** (`ui/sticky-taps.ts`, installed in `main.ts`). Browsers send `click` to the common ancestor of where a finger pressed and where it lifted, and iOS drops the tap when the two nodes differ; so a finger that lands on a tray entry still sliding in, or a chip still popping up, and lifts a moment later after the control moved out from under it, got nothing. Now a press that is still a tap at the lift (within the map tap's 10 px and 400 ms) clicks the button it pressed when the lift fell outside it, once (the browser's own click on that button in the same instant is swallowed); a lift inside it, a drag and a long press are left to the browser (so with a mouse, a press on one button released just outside it now clicks that button too, as a tap does). Why not `pointer-events: none` while a tray slides: the early press would land on the scrim or the map and shut the tray or pick a tile, the owner's symptom again. Why not acting on pointerdown: every scroll that starts on a sheet row would become a tap. `taps.spec.ts` presses a Bag entry, moves its tray under the resting finger as a slide does, and expects exactly one Bag.
- **The chip collects on one tap.** *(Superseded 2026-10-06: there is no Collect step; finished gathers land in the bag by themselves, see "Finished things go straight to the bag (#177)".)* "🪵 Timber is ready! Tap to collect" used to open the Bag, where a second Collect tap was needed (the 2026-10-04 entry "it opens the Bag" is superseded). Now the tap collects and the chip shows "Yay! +5 🪵 Timber" for a moment (`CHIP_REVEAL_MS`, `// TUNE:`), then moves on. While it still counts down, a tap opens the Bag as before. *Rule:* a control's label says what one tap does.
- **Bag and Home vanished while a tile was selected** ("steps aside while the tile panel is open", 2026-10-04 and #17): a click where they were landed on the map, which selected another tile or deselected, so they needed two or more clicks in the game's most common state. On an iPhone (390×844) the tile panel also covered Team / Jobs / Catalog / "Find a squishy" (#137, #159), and the Chat / Hollow / Report rail sat on the panel's text (#138) and overflowed the top in landscape (#136). The side trays (#122) replaced all of those; re-checked on top of #122 at 390×844, 844×390, 1180×820 and 1440×900: every control hit-tests to itself, and nothing sits under the tile chip's ×.
- **The job board asks the server once a countdown ends** (#149): what's ready is the server's sum, so when a gatherer's "Next in" reaches zero the board refetches its view and redraws ("+5 🪵 Timber ready!" and Collect; *superseded 2026-10-06: it now reads "on its way to your bag!" and settles first, see "Finished things go straight to the bag (#177)", 2026-10-06*), instead of counting on until it's reopened. Spot labels read "🪵 Timber spot" / "🍪 Treats on Meadow", not "(spot)".
- **A gatherer's 🧺 badge stays on screen** (#161): its x is kept inside the window by half its width, so a tile at the edge still shows it.
- **A crawling renderer drops to the cheapest tier at one pixel per CSS pixel** (`engine/quality/governor.ts`, `crawl`). The render-quality governor ignored every frame longer than `maxFrameMs` (250 ms) as a pause (a hidden tab, a debugger), so on a renderer where every frame is that slow (CI's software WebGL at an iPad's size and 2x pixel ratio drew one frame in ~2 s at `high · 2.00x`) no frame-rate window ever closed and nothing ever changed; each state change then drew the two settle frames, freezing the page for 4–5 s, which is how the iPad WebKit CI lane lost taps (the gather chip's tap and the tile sweep in `taps.spec`) and the job board's view took 5 s to redraw locally. Now `crawlFrames` (3, TUNE) consecutive frames over `crawlFrameMs` (1 s, TUNE) count as the renderer's own speed: quality goes straight to `low` at one render pixel per CSS pixel (the tiers' sharper floors given up; never pixelated), and the usual raises bring it back when frames are fast again. A lone long gap, or long frames that are not pause-long (a shader compile), still change nothing, and `visibilitychange` and `pageshow` reset the run, so a hidden tab, an iOS app switch or a device asleep and back can't add up to a step-down. Measured in Chromium on the iPad project: a frame went from ~2.0 s to ~0.85 s.
- **Held-press e2e.** `tests/e2e/touch.ts` (`realTap`: down, hold, up, browser hit-tested at both ends) and `taps.spec.ts` run on both device projects: every sheet and button over the map, gather then collect from the panel and from the chip, a gatherer's collect, a battle action. Playwright's `tap()` lands and lifts in one instant and would hide a control rebuilt or moved under a resting finger.
- **`POST /maps/:mapId/dev/gathers/ready`** (dev/test only, `HP_DEV_SQUISHY_GRANTS`, like jobs' `dev/work/ready`): my gathers on the map finish now, each keeping its length. Nothing before it could exercise a tile Collect end to end.
- **`ipad-chromium` and `desktop-chromium` Playwright projects** beside `iphone-chromium`, so `PW_CHROMIUM_EXECUTABLE` runs both device sizes and a laptop window (the owner's playtests) locally too.

## 2026-10-05 — Battle presentation rebuild (Fix PR)

_The owner's decision of 2026-10-05 on the battle look mockups: build the blend of Lantern Hour's stage, Saturday Morning Smackdown's hits and the Storybook Diorama's HUD. The battle overhaul PR (#121) keeps its non-visual parts here; its visuals were rejected and are rebuilt. Details proposed in the battle rebuild `Fix:` PR._

- **The server says where a battle happens** (kept from #121). When a battle starts, the battles service stores `battles.terrain` (a terrain id) and `battles.time_of_day` (`day`, `dusk` or `night`), migration 0022, both nullable and additive; `PlayerBattle` gains `terrain` and `timeOfDay`. A tile battle uses the tile fought over (`TileOpponent.tile`), a wild battle its spawn tile, and a battle with no tile (the dev route, a rescue) the player's Heart Seed, else `MAP_GEN.homeTerrain`. `night` is the map's night (`isNightAt`), `dusk` the two hours before nightfall (`DUSK_MINUTES`, `// TUNE:`). Older battles show on the home terrain by day. *Why stored:* a refresh, a resume or a raid replay always shows the same place, with no extra query on read.
- **Lantern Hour's stage.** The arena is a diorama of the terrain from the map's own looks and props (`TERRAIN_LOOKS`, `buildProp`; no forked props), under a vertex-coloured dome with the sun's glow on the key light's side, vinyl clouds, far hills and linear fog for depth, on a mottled disc that darkens to its rim. A warm golden key light travels from behind the other side towards the camera (the stage's sun re-aimed), with a violet fill, so faces stay lit and shadows fall long towards the player; the fighters cast into a 1024² PCF shadow map (none on the low tier) and stand on contact shadows stretched along the key. Dusk and night keep the warm key (a lantern's) with a cooler sky, stars and fireflies; day has pollen. Each terrain's composition and each time of day's mood are data (`arena-config.ts`), the layout is pure and seeded from the battle id, and a terrain the client doesn't know draws the meadow.
- **Saturday Morning Smackdown's hits.** Squash and stretch at 1.5× (`CHOREO.exaggeration`), a 120 ms hit-stop scaled by the hit's strength (both fighters hold the contact pose: the attacker braced, the target squashed flat), a white flash, the element's burst with hot cores and halos that bloom, big cartoon stars, small speed lines round the hit, a knockback with a twirl on a super hit, a light camera push-in and shake, and a dutch roll and sky rays only on a super hit. Comic callouts ("Super cozy!") pop under the pill. Misses overshoot while the other side hops aside; hexes cast a bolt, boosts an aura; tuckered-out squishies stagger, twirl and flop over with dizzy stars; swaps hop out and drop in; a Heart Charm is thrown from the Keeper, draws the squishy in to hover over it, wobbles, and opens on a friend (hearts) or wiggles free.
- **Every element has its own signature** (`ELEMENT_FX`, data): fire's embers rise; water's drops arc and splash with a ground ring; leaves whirl and flutter down; frost's glassy shards fall slowly with a twinkle; sparks zap about; stone's chunky chips fall heavily with dust; shadow's violet wisps swirl; light's stars rise and twinkle. A test holds the eight apart.
- **Every feeling shows in the stance and the wind-up** (`FEELING_TRAITS`, style guide §5): Joy hops, Cozy sways, Brave puffs up and stomps, Silly wiggles and spins into its dash, Sleepy nods off and jolts awake, Spooky hovers. Both fighters stand three-quarter to the camera, faces showing, the player's near left and the other side further right.
- **The Storybook Diorama's HUD.** Cream pills in the top corners, each over its own squishy (name or nickname, level, energy, element and feeling badges, a status chip), a round × between them for "Back to patch", and a bottom sheet of at most 35% of the height for the caption, the moves (2×2), Heart Charm, Swap and Run away. The pills sit under the account chip, which stays reachable mid-battle. The sheet's share is reserved even while only the caption shows, so the fight never jumps; the camera fits both fighters into the band between the pills and the sheet (`BattleHud.safe`), so nothing covers them on any screen from 320 px up (#142). Every control pads with the shared tokens, so text never touches an edge.
- **The camera owns the battle.** A fixed low rig (pitch 11°, swung 14° to the player's side, fov 0.74) sits back far enough that both fighters, where they stand and where a step moves them, fit the safe region, with a vertical lens shift (one projection-matrix entry, no extra pass) that keeps the horizon level and the fight above the sheet. It leans a little towards whoever a step is about and relaxes after a beat. A full-screen shield under the HUD's controls takes every touch, drag, pinch and wheel on the fight, so the map camera's gestures on the canvas never reach it (`battle-ui.spec.ts` drags across the fight and checks the camera stays put).
- **Reduced motion** (`prefers-reduced-motion`): no shake, flash, hit-stop, push-in, roll or twirls; no idle bob or breathing; dashes become a short lunge; effects stay, thinner, with no speed lines or rays; the motes hold still; the callout shows without its pop.
- **Performance** (CLAUDE.md rule 8): every mesh and material is made when the scene is built (both benches are prewarmed, so a swap makes no meshes mid-turn); a turn moves transform nodes, writes preallocated instance buffers and flips pooled effect meshes on and off; the camera director and the pools allocate nothing per frame. The stage is about 20 draw calls (sky, sun, clouds, hills, ground and its wall, one per prop kind, prop shadows, water or stars, motes), the fighters and the Keeper about 10, effects 0 between hits and up to 9 while bursts live; a settled frame draws about 42 on a phone and the heaviest moment (a super hit's rays and lines) about 50, measured on the capture script; the shadow pass adds one pass while the scene draws. Render on demand stays: every frame while a step plays, about 30 fps while the fighters only breathe and bob, nothing with reduced motion.
- **The battle clock** (`battle-clock.ts`): every timer and pose reads one clock, so dev builds can run a battle slower (`?battle-slowmo=8`) or step it by hand (`?battle-clock=manual`, `window.__heartpatch.battleDev()`), which is how the capture script (`apps/client/tooling/battle-shots/shoot.mjs`) takes frame-exact shots from the real game; `?battle-arena=forest/dusk` overrides the picture in dev. Production ignores all three.
- **Nicknames on the pills (#141).** The battle view carries no nickname (a shared contract), so the screen reads the player's own from `GET /maps/:mapId/care` when a battle opens and shows it on their pill, the Swap button and the XP lines; species names until it arrives, and for the other side.
- **The Heart Charm button (#143, kept from #121)** always shows in a wild battle with the bag's count, dimmed at 0 with a craft hint from the real recipe; a tap with none re-checks the bag, then explains or goes ahead. A won wild battle without a capture ends with a nudge to use one.
- **The Team and Jobs row (#132)** follows the map whose HUD is on screen, told by the map screen (`onHudChange`), not read from the scene, so it's back after every battle. **The result card (#133)** is sized by its gutters, never the card's own 100%. **Double taps on the tile chip's × (#137)** stay harmless: nothing sits under it since the trays, and a spec double-taps it.

## 2026-10-05 — Sprout waits its turn (bug-bash tutorial lane, Fix PR)

_Proposed in the bug-bash tutorial PR (#127, #128, #129, #139, #140, #154, #163); the project owner confirms on merge._

- **A sheet is any visible `role="dialog"` that isn't a note** (`aria-modal="false"`, like the install guide): the tile chip, the care and home sheets, the Bag, the Hollow's report, lore and milestone cards, a battle's result. Nothing has to know about the tutorial to be waited for (`tutorial/sheets.ts`). A sheet under another sheet (home under care) is in nobody's way.
- **Sprout waits behind any sheet that isn't the step's own target.** While one is open the tutorial layer gates nothing (no blockers, no spotlight), so a tap meant for the sheet never lands on Sprout and no sheet can be stuck under the gate (#127, #128). The bubble shrinks to a small glowing orb at the screen's edge, placed clear of every button and card (`placeOrb`, #139); it glows while Sprout has something unread, opens again by itself when the sheet closes, and a tap on it peeks sooner. A spotlight on a sheet's own buttons (the care sheet's Pet, the tile chip's Gather) still gates that sheet on purpose.
- **Guides, not gates, for steps that take more than one tap** (#140): `TARGET_GUIDES` lights and points at the next thing to tap (for the fire: Add fuel, else Build, else Home, else the My Heartpatch handle) with the gate `guide`, which blocks nothing. Hard stand-ins (`TARGET_STAND_INS`) stay for buttons that finish the step from where they are. *("My Heartpatch" is now "My Home" and "Raid report" is "Challenge report", 2026-10-06; see "Words: My Home, patch and land (#181)".)*
- **One card at a time, in this order:** a battle, then a found lore page, then a milestone party, then the Hollow's morning report, then Sprout. Each waits on what's visible (`busy` / `otherReportOpen`, re-checked after its fetch) and tells the next in line when it closes (`onChange`), so nothing can deadlock. The tutorial run's end closes a care sheet left on the Glade, and the party waits while the lobby shows a form (`lobby.formOpen`), so The First Patch comes after "Make a patch" is filled in, never over it.
- **The API client reads empty replies out** (`apiCall` with `schema: null`): a Response left unread is cancelled when collected, which Chromium logs as `net::ERR_ABORTED` on every acknowledge (#163).

## 2026-10-05 — Stabilization process and deploy (supervisor 5)

_Owner decisions and process changes from the bug-bash stabilization day. Recorded by the coordinator._

### Process
- **Fable (`claude-fable-5-1`) does all build and fix work, and reviews code PRs** (owner decision). It supersedes the 2026-10-02 "Models" decision for code work (Opus) and the #13 exception. Docs-only reviews, drift audits and simple docs work stay on Sonnet 5.5. COORDINATOR.md §6 is updated to match. *(Reversed the same evening; see "Models (owner decision, 2026-10-05 evening)".)*
- **Lanes no longer edit this file.** Every pair of open PRs conflicted on its last lines, and each conflict cost a merge of main plus a full CI run. A lane writes its decisions under `## Decisions` in its PR body; the coordinator appends them here after the merge, in the next Docs PR.
- **A failure that isn't the PR's doesn't block its merge:** a check that is red on main too, or a test the PR doesn't touch that fails across several PRs while a named fix lane owns it. The verdict comment says so.
- **The lean review:** with the account at its 7-day usage warning, the post-stabilization review runs as three read-only reviewers (story and orphans; look and feel, including art direction and a contact sheet of every species; longevity, with the balance sim) feeding one ranked report. The art bible follows it (owner decision).
- **The owner approved the battle rebuild's captures as they are** (#170, https://claude.ai/artifact/WKLmkmkNxsdft5WJr2wj8d).

### Deploy on the new AWS experience
- **The project is called `heartpatch`** (the owner created it for the game; an earlier project is unused), Region us-east-2, CLI profile `heartpatch`. `aws login` gives the owner an `AccountFullAccessRole` session for 12 hours, renewable without the browser for 90 days.
- **Lightsail limits on a new project:** the instance quota started at 0 on the first project, and the `heartpatch` project refuses the 2 GB plan. The server is the **1 GB plan** (`micro_3_0`, $7/month) with the setup's 2 GB of swap (owner decision). Moving to 2 GB later: snapshot, create a 2 GB instance from it, move the static IP across; no DNS change. Ask AWS support to allow the `small` plan first.
- **The server is created through the API, not the console:** `create-instances` with a first-boot script that runs `infra/scripts/server-setup.sh` unchanged with the deploy key's public half, then writes `/opt/heartpatch/.env` with a database password generated on the server, a static IP, firewall rules for 22/80/443 on IPv4 and IPv6, and automatic snapshots at 10:00 UTC. The server's SSH host key for `LIGHTSAIL_KNOWN_HOSTS` comes from `get-instance-access-details`, not from a first connection. *Why:* cloud sessions can't open SSH connections, and reading the key from the API is a stronger trust anchor than trust-on-first-use.
- **DNS:** GoDaddy `play` A → the static IP and AAAA → its IPv6 address. Deploys still go over SSH from GitHub Actions; no AWS credentials live in GitHub or on the server.
- **The first-boot script didn't run.** cloud-init logged `Failed to run module scripts_user` 15 seconds after boot, so no `deploy` user existed and the first deploys got `Permission denied (publickey)`. The owner ran `server-setup.sh` and the `.env` step by hand from Lightsail's browser SSH, after which Deploy #93 went green on a10f5d4 (its log shows health and ready 200, and `/api/v1/health` OK through Caddy). Until the cause is known, set a new server up by hand (DEPLOY.md steps 3 and 6), not through user data.
- **GitHub runner outages are infra, not ours:** "The job was not acquired by Runner of type hosted" cancelled the deploy job twice on 2026-10-05 with no other load. The repo is public, so Actions minutes are free; re-run the failed jobs.

### Models (owner decision, 2026-10-05 evening)
- **Back to the original split:** Opus 5.5 (`claude-opus-5-5`) builds code and reviews code PRs; Sonnet 5.5 writes docs and reviews docs-only PRs and drift audits. **Fable (`claude-fable-5-1`) is used only when the owner explicitly asks**, for a periodic end-to-end review of the whole solution. It reverses the morning's "Fable does all build and fix work". *Why:* the owner wants Fable's cost spent on occasional whole-solution reviews, not on every lane.

## 2026-10-05 — taps.spec gather/collect on slow WebKit (Fix PR #173)

_Proposed in #173; recorded by the coordinator after merge._

`taps.spec.ts` "gathers and collects" failed on two PR branches' iPhone WebKit lanes at the counting-down chip's tap: the Bag stayed shut. Root cause, from WebKit's source (`EventHandler.cpp`, `targetNodeForClickEvent`): WebKit pairs a pointer's release with the very node its press hit-tested, which on a label is its **Text node**, and fires no `click` when that node is gone by the release (no common ancestor). The chip's once-a-second tick rewrote its words with `textContent`, which replaces the Text node, so any press straddling a tick lost its click; CI's software renderer (0.85–2 s a frame) stretches the 120 ms hold past the next tick on busier branches. Chromium pairs clicks by element and is immune; a finger on iOS is unaffected (its synthetic press and release are dispatched together), a trackpad or mouse on an iPad, or Safari on a Mac, is not.

- **Countdown words are one Text node rewritten in place** (`inventory-screen.ts`, `Countdown.text.data`), never replaced, so the node under a resting pointer survives the tick. Rule for any tappable with live text: rewrite the Text node's `data`; `textContent` on the element swaps it.
- **The spec presses through a tick** (`touch.ts` `realTapThrough`): a press that holds until the chip's words change under the pointer (the game's own signal, no sleep), then lifts, must open the Bag. Deterministic in WebKit before and after the fix; the held taps (down, ~120 ms, up) stay as they were.
- **`HP_E2E_CPU_THROTTLE=<n>`** (`players.ts`) slows the page's CPU n× through CDP in Chromium only, a local stand-in for CI's WebKit for `--repeat-each` runs; 4× matched CI's pace on this spec (1.7 min on `ipad-chromium`), 6× blew the iPad test's budget.

## 2026-10-05 — Tutorial naming after a refused name (Fix PR #175)

_Proposed in #175; recorded by the coordinator after merge._

- **On the tutorial's naming step, Try again re-sends only after `OFFLINE`, `INTERNAL` or `RATE_LIMITED`** (the map resync's retryable set). Any other refusal, such as the text filter's `VALIDATION_FAILED`, returns to the name box with the old name selected, so a kid can never get stuck re-sending a name the server will always refuse.

## 2026-10-06 — Keeper hair styles (#176)

_Owner request from playtest feedback ("There is only one boy option and several girl options"); proposed in #176, recorded by the coordinator after merge. No issue._

- **Any Keeper can wear any hair style** (owner decision). Hairstyles are shared data (`KEEPER_HAIRSTYLES` in `data/keepers.ts`, checked by `KeeperHairstyleSchema` in `checkKeeperData`), not one client builder per style. It replaces #42's "Hairstyles are one builder per style". Adding a style is a data entry with no renderer code (CLAUDE.md rule 5). *Why:* nothing is labelled boy or girl, and the row just lists the styles.
- **Hairstyle ids are stored in `keepers` rows:** add freely, never rename or remove one.
- **The roster is 12 bases and 12 styles** (was 8 and 8). Four new short styles (Crew Cut, Side Part, Messy Mop, Short Curls) and four new Keepers whose own style is one of them (Rowan, Basil, Acorn, Juniper). The Keeper row alternates short and long styles, and Pip stays first so a new player still starts on Pip. *Name clash:* the base "Juniper" (owner-approved) shares its name with Juniper's Gap in the lore.
- **The saved style is optional** (coordinator-approved shared contract). `KeeperConfig.hairstyle` absent means the base's own style. `keepers.hairstyle` is a nullable text column (migration 0023). The server stores the base's own style as null, and saving without a style clears an earlier pick. An unknown id is refused with "We don't know that hair style. Pick another one!". `MapMember.keeper` carries the field, so other players see your style.
- **Old Keepers draw exactly as before:** the style joins the random seed only when it differs from the base's own, so the pinned golden hash is unchanged.
- **The picker has five rows:** Keeper, Hair style, Hair (colour), Eyes, Outfit. Picking a Keeper puts back its own style; picking a style keeps the Keeper and its colours. Under 740 px tall the spacing is tighter so all five fit; choices stay at least 44 px.
- **Known gap:** `KeeperResponseSchema` is strict, so a page left open from before the deploy can't parse `GET /keeper` once that account saves a style, and shows "We couldn't find your Keeper" until it reloads. The window is short (network-first reloads); loosening response parsing could be a later change.

## 2026-10-06 — Finished things go straight to the bag (#177)

_Owner decision of 2026-10-06, relayed by the coordinator: the Collect step is gone everywhere. Proposed in #177, recorded by the coordinator after merge. It replaces the "Collect strip" plan for the playtest bug where Make it said "You're already making something! Collect it first." with no Collect on the Recipe Book screen._

- **Finished crafts, Keeper gathers and gatherer cycles settle into the bag by themselves,** on `POST /maps/:mapId/settle` (`modules/settle`), not on a GET. The client calls it when a map opens, when the Bag or job board opens, when the app returns to the front, when a command is refused with `CONFLICT`, and at the server's `nextAt`. No server loop (CLAUDE.md rule 4). One transaction (rule 7), the same ledger rows and events a Collect wrote (`craft` / `gather` / `work`; `item.crafted`, `resource.gathered`, `work.collected`), so milestones, recipe-book unlocks, the tutorial and found-clothing rolls keep counting. Idempotent: a repeat settle, or two phones at once, banks each thing once (the member lock serialises settles).
- **Response contract:** `SettleResponse` = `InventoryResponse` + `landed: { kind: 'craft' | 'gather' | 'work', items }[]` + `nextAt: string | null` (`packages/shared/src/schemas/inventory.ts`). No event payload or error code changed.
- **The gatherer cap stays** (`JOB_RULES.work.maxStoredCycles`): a gatherer pauses after that many unbanked cycles until the next settle, then starts again, so a long absence pays no more than before. *Why:* the design review flags the economy as already generous.
- **Land changing hands:** finished work and gathers are banked, judged by the first capture of the tile after the work started (`tile_attacks.ended_at`, one SQL spelling: `firstCaptureSince`). Unfinished work is lost. A previous owner's finished gather is banked when the new owner gathers there. It updates the 2026-10-04 "what wasn't collected is lost" lines (Squishy jobs, and #17's lost gathers).
- **Starting a craft or a gather banks a finished one first;** the pot is busy only while something is still cooking ("Your pot is still cooking! It pops into your bag when it's ready.").
- **Lock order** (tech spec §7): member row, then work and gather tiles, `gather_jobs`, the craft, squishies, every inventory row in item-id order (`lockGrantRows`), grants, clothing rolls, other events. No inventory row is locked after `maps`.
- **The client shows no Collect anywhere:** Bag rows, the tile panel, the chip (it counts down, says "ready!" for a moment, then goes; a tap opens the Bag), the recipe book strip and the job board. A pop-up ("🪵 +5 Timber, 🍪 +3 Treats!") shows what landed. Clothing finds keep the wardrobe's own "You found …" card. The Recipe Book's Make it is disabled only while something is cooking, with a countdown strip; its countdown is one Text node rewritten via `.data` (#173's rule).
- **Old collect routes stay** (`…/gathers/:id/collect`, `…/crafts/:id/collect`, `…/work/collect`) for installed apps on the old bundle, sharing the new banking helpers (`bankGather`, `bankCraft`). A later chore can retire them.
- **New dev route** `POST /maps/:mapId/dev/crafts/ready` (dev and test only, `HP_DEV_SQUISHY_GRANTS`), like the gathers and work routes, so e2e never waits. The tech spec's "admin endpoint to set the game clock" was never built.
- **Known follow-ups (non-blocking):** a settle sent just before Make it or Gather can return after the command and show the older bag until the next sync (fix: a state version bumped by command replies); an older settle failing after a newer one succeeded can show a stale error line; several clothing rolls in one settle can deadlock narrowly with a battle finish granting the same item (Postgres aborts one side).

## 2026-10-06 — Sprout's chip and the side trays (Fix PR #178)

_Playtest bug (owner, iPhone): on the "Give them a home" step, Sprout's tucked chip stayed on top of the open Adventure tray and took taps meant for its rows. Proposed in #178, recorded by the coordinator after merge._

- **Side trays are sheets.** An open tray carries `role="dialog"` (`ui/trays/trays.ts`), so "Sprout waits behind any sheet" (2026-10-05) holds for it: when the tray isn't on the step's way the layer gates nothing and Sprout shrinks to the orb at a free edge. *Why:* the trays were plain `<section>`s with no role, so an open tray never counted as a sheet.
- **The tucked chip never covers a sheet the step is using.** If it would overlap the card of a sheet that holds the step's target (a route tray, the care sheet), it docks into Sprout's orb clear of that sheet, its controls and the spotlight hole (`dockChip`); the spotlight or guide carries on, and a tap on the orb opens the bubble.
- **A target that `aria-controls` a sheet owns it.** A tray's handle stands in as the target while the tray slides in (280 ms), so `foreignSheets` treats the tray it controls as the step's own and Sprout never ducks away mid-slide. *Why:* without the rule Sprout flickered into the held orb and the spotlight dropped for the whole slide.
- **Follow-up:** the habitat step has no highlight target or guide, so My Heartpatch counts as foreign there and Sprout shows the orb while it's open. A guide (`home-open` → `tray-handle-heartpatch`) in `TARGET_GUIDES` would be a small follow-up if wanted. *("My Heartpatch" is now "My Home" and "Raid report" is "Challenge report", 2026-10-06; see "Words: My Home, patch and land (#181)".)*

## 2026-10-06 — The wardrobe leads back (Fix PR #179)

_Playtest bug (owner, iPhone): "When clicking on your account and going to outfit, there is no way to exit back to the main game." Proposed in #179, recorded by the coordinator after merge._

- **Done goes back where the wardrobe was opened** (`ui/wardrobe/wardrobe-return.ts`, pure and unit-tested). From a patch it returns to that patch (its map, or the home base, close-up or battle that put the map away); from the lobby, to the lobby; from the tutorial step, to the Glade while that run still has it open (a run put away or finished meanwhile goes to the lobby). Opening Settings from the Keeper menu and then the Wardrobe lands Done on the patch list, the same place Settings' own Back goes. A battle left for the wardrobe resumes when its map comes back; logging out with the wardrobe open closes it without reopening a map. *Why:* Done always went to the lobby outside a tutorial run and took players out of their patch.
- **The card is at least 420 px tall on short portrait phones** (`min(max(55vh, 420px), 520px, calc(100% - 96px))`, `// TUNE:`) and always leaves the top 96 px for the Keeper; the Boutique and Milestones cards share the rule. *Why:* at 393×659 the clothes list was 33 px tall, and 4 px at 320×568.
- **Header:** "Wardrobe" and Done share the first row, Done at the top right; Milestones, Boutique and Turn around slide sideways on a row below with the same fade-at-the-edge hint as the tabs.
- **Follow-ups, not regressions:** on a landscape phone (844×390, 667×375) the clothes list is still zero rows (on `main` too); a landscape media query could hide the outfits row or let the card's rows scroll. On a 320×568 phone the space above the card for the Keeper drops to about 152 px, about the same as the picker's; tune the preview camera if the Keeper looks clipped on an SE-size phone.
- **Recipe-book e2e (test only):** "a finished craft lands by itself" no longer races its own 30 s craft. It records every text the landed pop-up shows (`window.__landedToasts`, a MutationObserver installed before Make it) and asserts the treats arrived and "+3 Treats" was shown, instead of racing the pop-up's 3.2 s life. The "pot is busy" checks between Make it and the dev call could still hit the 30 s on a very slow runner; worth an issue if that shard flakes.

## 2026-10-06 — Words: My Home, patch and land (#181)

_Owner decision of 2026-10-06 (design review Q4). Proposed in #181, recorded by the coordinator after merge. Text only: no layout, logic or step-order changes._

- **Glossary (style guide §9):** **Heartpatch** is kept for the lore and the game title. A **patch** is a shared map. **Land** is the tiles a player owns. **Home** is the home base, and the tray is **My Home** (handle label "Home"). It was "My Heartpatch". Identifiers and test ids (the `heartpatch` tray side, `tray-handle-heartpatch`) keep their names.
- **A challenge on your tiles is "Someone challenged your land!"** and its sheet is the **Challenge report** (was "Raid report"). "Patch" stays for the shared map ("Make a patch", "Your patches", "joined your patch"). Older entries that say "My Heartpatch" or "Raid report" carry a short note; nothing was rewritten.
- **Sprout names the Hollow Man before anyone says "he".** The nightfall and evolve lines introduce him, and a test enforces the order.
- **One Glimmer icon: 💎** everywhere (✨ stays for Play, Light and the fallback icon).
- **Spelling:** player-facing text uses US spelling ("color", "favorite", "practice", "gray"); "Keeper" is capitalized. The Halloween top milestone tier is titled "Moonlit Pumpkin"; its id `harvest-moon` is kept because stored titles reference it.
- **Open, not decided:** the tray's inner button is still "Home" (so "Open My Home, then Home" repeats the word); the reward costume is still "Harvest Moon Costume", which Thanksgiving may want; the befriend toast "joined your patch!" stays for now ("joined your team" is an option).

## 2026-10-06 — The level curve and wild levels (#182)

_Owner decisions of 2026-10-06 (design review Q1 and Q2), plus the owner's later choices that day on the follow-ups. Proposed in #182, recorded by the coordinator after merge._

- **Q1, power curve: keep level 100, with a steeper curve, and scale wild squishies to the Partner.** The owner chose this over the recommended "cap at level 30". Stored XP and levels are kept; **no level ever goes down** (`addXp` takes the larger of the stored and the computed level).
  - **The curve:** `xpCurve.curve` goes 5 → 20, with `knees` at 16 (`steep: 500`) and 30 (`steep: 1500`), as data. The curve below 16 steepens too, because a win pays about 30 × L base XP at Partner-matched levels and the owner's goal is evolution on day 3–5 with a long tail after it. A casual kid evolves on day 4 (day 2 for an engaged one); a casual Partner is near level 24 on day 14 and 29 on day 30.
  - **Wild levels follow the Partner:** server-only `SPAWN_RULES.partnerOffset` −2 to +1, floored at the old minimum and capped at `maxLevel`. "Partner" means the starter picked on the patch (`map_members.starter_squishy_id`); with none, levels stay 2–6. Which species is on a tile never depends on who looks. *(Now −2 to +0, see "A wild squishy wanders off; fairer wild levels (#208, PR #211)", 2026-10-06.)*
  - **Follow-up (a): befriended squishies join at most one level below their first evolution** (`GROWTH_RULES.befriendBelowEvolution: 1`), so a kid can't befriend a level-41 base form that evolves on its next battle. The fight stays at full level.
  - **Follow-up (b): a daily battle-XP falloff.** Each squishy earns full battle XP for its first 7 wins of the map-local day, then 10% (`battleXpFalloff`). 7 is the most that leaves the casual kid unchanged. It reads existing `battles` rows (no migration) and lives in `GROWTH_RULES`, so the battle content hash is unchanged.
  - **Known misses, owner calls:** an engaged kid still evolves on day 2 and is Gap-ready on day 4 (the Gap is about team strength, not XP). Fixing that would need guardians to follow the attacker's Partner or team, or a daily befriend limit. Neither is done.
  - **`pnpm sim:progression`** is the model behind these numbers (`reports/sim/progression-report.md`). It leaves out care above one multiplier, gathering, the Hollow Man and challenges between the two kids.
- **Q2, map fill: both.** `attemptsPerDay` goes 10 → 5 (done in #182, design doc §11). **Land regrowth or fading tiles will be built before launch** (lane queued). With 5 attempts, two kids fill a 4-seat map (441 neutral tiles, what new patches use) on day 45 and a 2-seat map on day 26.
- **Pace pins this replaces:** "Playtest fixes" (2026-10-04) said a starter grows up after about 12–15 wild wins. Now it takes about 22–29 Partner-matched wins at 1× care, and rarer evolutions at 16 / 18 / 22 / 26 / 30 take 22 / 29 / 62 / 114 / 178 wins (`growth-pace.test.ts`). The "Launch roster (#10)" line "Only base forms spawn wild, levels 2–6" is superseded in part (note on both entries). *(Now 23–30 wins, see "A wild squishy wanders off; fairer wild levels (#208, PR #211)", 2026-10-06.)*
- **`partnerLevel` is not `users.partner_species_id`.** The tutorial's Partner is unchanged, and the Tutorial Glade keeps its own wild squishies.
- **Possible follow-ups (not done):** an `(map_id, player_user_id, ended_at)` index for the falloff's wins-today count; storing the falloff share in `rewards`; a result-card note for the falloff, like Gentle's.

## 2026-10-06 — Owner design-review answers

_The owner's answers to "Questions for the owner" (a Claude artifact: https://claude.ai/artifact/CBbJkMKBbGwpho7pNaqo1v) from the 2026-10-05 design review, given 2026-10-06 and recorded by the docs lane. Q1 and Q2 are in "The level curve and wild levels (#182)" and Q4 in "Words: My Home, patch and land (#181)"._

- **Q3: ship building upgrades and sinks.** Building upgrades and resource sinks ship (lane in progress).
- **Q5, squishy art: a full roster redesign.** The first mockup was rejected as "too similar and too babyish"; the second was approved the same day. The rule from mockup 2:
  - **Base forms are baby-cute.**
  - **Evolutions grow up and look slightly fierce** ("you can be both fierce and cute at the same time").
  - **Squishies come in real body plans:** legs, arms, tails, spikes, wings.
  - **Kid-safe throughout:** no gore, no scary red eyes.
  - This replaces the earlier "cute, never fierce" idea. The vinyl-toy look (design doc §19) stays.
- **Q6, the end of Halloween:** a **guaranteed in-season pumpkin node in every home ring**, and a **mini Thanksgiving by Nov 10** (Magic Fallen Leaves and one species). Both were chosen over extending Halloween's window again.

## 2026-10-06 — Issues filed for later phases

_Filed from the design review on 2026-10-06; each is a lane to design before it is built._

- **#183:** the world map.
- **#184:** community buildings and fences.
- **#185:** farming.
- **#186:** the endgame against the Hollow Man.
- **#187:** battle feel.
- **#188:** capture odds.
- **#189:** hollowed land.
- **#190:** mini-bosses.

## 2026-10-06 — Building upgrades, a use for Heartdust, and honest Glimmer (Fix PR #193)

_Proposed in PR #193; recorded by the coordinator after merge._

- **Training Grounds are built now (owner).** Level 1 has room for 2 and gives 5 XP an hour; level 2 has room for 3 and gives 8. At most 24 hours of XP waits (`JOB_RULES.training.maxHours`, `// TUNE:`). It's plain XP: no care multiplier, not a battle win, so `battleXpFalloff` doesn't apply. It lands at each settle and whenever training stops. A trainee never battles. A trainee keeps its habitat bed and sleeps at home. *(Reversed: a trainee leaves its bed, and Training Grounds build only on homesteads. See "Training Grounds move to homesteads (#277, PR #302)", 2026-10-08.)*
- **Mountain land yields slow Glimmer instead of Stone** (owner): 1 per 90 minutes (`// TUNE:`). One yield per terrain still holds. *(Superseded: mountains yield Ice. See "Water, Greens and Ice, and the nesting economy (#238, PR #249)", 2026-10-07.)*
- **The Heart Snack is a rare fourth care action.** It costs 3 Heartdust and gives +25 contentment (`// TUNE:`). It sits outside the daily care falloff and earns no coins (new optional `CareAction.outsideDailyCare`). It shows on the care sheet once there's any Heartdust.
- **Shared-contract additions** (coordinator-scoped): events `building.upgraded` and `squishy.trained`; `squishy.assigned.job` gains `training`; ledger reason `upgrade`; `SettleResponse.trained`, `JobsView.trainingGrounds`, `SetJobRequest { job: 'training' }` and the `HomeSquishy` and `JobSquishy` training fields; `BuildableKind` gains `training-grounds`; migration 0024 on `squishies`.
- **The crafted Jack-o'-Lantern is named apart from the fire built from it** ("Jack-o'-Lantern" and "Jack-o'-Lantern Hearthfire"; the id is unchanged). Its build row opens the recipe book, not the Bag, because the home screen can't open the Bag. This differs from the approved mockup.
- **Every building level has its own model** (footprint ×1 / 1.08 / 1.15, height ×1 / 1.3 / 1.6), and home buildings draw at scale 1.5. The home camera stays at 58° (owner). Fewer, bigger spots per tile stays a #184 question.

## 2026-10-06 — Art bible and the squishy roster redesign (Chore PR #192)

_Follows the owner's Q5 answer ("Owner design-review answers", 2026-10-06). Proposed in PR #192; recorded by the coordinator after merge._

- **Squishy art follows `docs/ART_BIBLE.md`** (owner-approved mockups 1–3). Babies are cute and evolutions grow up. Body plans come from shared building blocks, and `checkGameData` enforces the `artRules` table.
- **Squishies ignore scene fog.** Mood comes from the sky, land and props, never from washing out a squishy's colours.
- **Rarity tiers are shader codes, not materials:** sparkle for epic; sparkle plus an iridescent rim for legendary and secret; glow for Light (whole body) and Fire (flames). They cost no extra draw calls.
- **The draw-call guard counts body kinds.** The gallery's ceiling comes from the registry, so draw calls never grow with the number of squishies.
- **Each line declares a `pose` and an `attackPart`** for the battle-feel lane (#187).

## 2026-10-06 — Land fades or regrows when nobody tends it (Fix PR #194)

_Follows the owner's Q2 answer in "The level curve and wild levels (#182)". Proposed in PR #194; recorded by the coordinator after merge._

- **New event `tile.rewilded`** (additive): `{ userId, night, tiles[{q,r,terrain}], returnedSquishyIds }`. Its public view drops `returnedSquishyIds`. It isn't `tile.went-wild` because `WsEventTypeSchema` doesn't allow hyphens.
- **Additive shared schemas:** `TerritoryRules.tending`, `LandTending*` and `DevAgeLandRequestSchema`.
- **One Visit tap tends all of a player's land.** Tending tile by tile made casual kids lose 150+ tiles in the sim.
- **Only the owner sees their land fading.** Rivals see a tile only once it has gone wild.
- **`firstCaptureSince` also counts land going wild** as land changing hands.
- **No data backfill:** rows are filled lazily at the first nightfall, with the same effect.

## 2026-10-06 — Family signup codes (#195, PR #206)

_Proposed in PR #206; recorded by the coordinator after merge._

- **Family codes are 12 characters** from the invite alphabet; patch invites stay 8, so one field tells them apart by length. *Why:* there's no second field, and 12 characters (~59 bits) keep a stored hash from being a quick offline guess.
- **Family codes are stored as SHA-256, not Argon2.** Sign-up has no username to find the row by, so it looks the code up by hash. The per-IP signup rate limit holds back online guessing, and codes last 14 days.
- **A join request filed at sign-up waits for the Keeper and tutorial gates at approval** (409 "still getting ready"), the same gates joining has.
- **Family codes belong to the owner, not to a patch.** The same list shows on every patch they own. Ended codes stay listed for 28 days (`// TUNE:`); at most 20 show.
- **`HP_SIGNUP_CODE` stays required in production for this release.** The release after can make it optional in `config.ts`, then drop the bootstrap check and the env var from `.env.prod.example`, `deploy.sh` and DEPLOY.md, once the operator has made family codes with `ops/signup-code.js`.

## 2026-10-06 — A pumpkin patch at every home, and a mini Thanksgiving (Fix PR #200)

_Follows the owner's Q6 answer ("Owner design-review answers", 2026-10-06). Proposed in PR #200; recorded by the coordinator after merge._

- **Seasonal nodes live in `homeRingNodes`, which goes from 4 to 6.** A node's season comes from its resource's own `season`, so the map-gen schema doesn't change. The ring is now full, and buildings use spots 1–6 on ring tiles (owner-approved).
- **New maps from the same seed now differ** (the generator's draws changed); the pinned map-gen hash was updated on purpose. Stored patches keep their tiles (owner-approved).
- **Older patches are topped up lazily on read,** once, deterministically from the map seed (owner-approved). A building in the way moves to a side spot on its own tile so every home gets its seasonal nodes (coordinator). A node waits only when every bare ring tile is full; that's logged once, with a counter.
- **Seasonal home nodes hide out of season,** and their spot stays reserved, so kids see an empty middle they can't build on until the season returns.
- **The Tutorial Glade's ring check skips seasonal resources** (the Glade has no seasons).
- **The leaf pile is made of maple and oak leaf shapes,** with loose leaves around it (owner's mockup note).

## 2026-10-06 — The game's version (#198, PR #210)

_Proposed in PR #210; recorded by the coordinator after merge._

- **Version scheme (owner):** before the full production launch everything is pre-v1, shown as `v0.<build> · <short sha> · <UTC build date>`. `<build>` is `git rev-list --count HEAD` on a full-history checkout: monotonic, no tags or manual bumps, and the same commit always gets the same number.
- **`v1.0` comes only when the owner publishes the full production game.** It's a one-line change to `APP_MAJOR`. After v1 the scheme becomes `v1.<minor>.<build>` (not built yet).
- **Every deploy is now a new app shell.** This partly supersedes "Installable app (#26)": "A deploy that only changes the server keeps the phones' cache". The build number is in the entry bundle, so installed apps see "Ooh, a new Heartpatch is ready!" after every deploy, a rebuild of the same commit included. Phones re-download `index.html` and the ~640 KB entry chunk, never the 1.2 MB engine chunk.
- **"Update ready" from the server needs a later build, not just a different one,** so a rolled-back server never offers an "update".
- **`HealthResponse.build` and `commit` default to null when missing,** so mixed versions during a deploy never break the reply.

## 2026-10-06 — A wild squishy wanders off; fairer wild levels (#208, PR #211)

_Owner decisions of 2026-10-06, relayed by the coordinator. Proposed in PR #211; recorded by the coordinator after merge._

- **A wild squishy the player lost to or ran from wanders off for that player** for the rest of its spawn window, like a beaten or befriended one. A tie or a no contest still leaves it. The Tutorial Glade keeps its befriend-only rule. *Why:* a spawn the kid can't beat soft-locked "Find a squishy" for 4 hours, and counting a run home stops scooting from keeping one around. It supersedes the 2026-10-03 sentence "A loss, a tie, a run home or a no contest leaves it there."
- **The result card says "It wandered off. Try another one nearby!"** after a wild loss or run home off the Glade. On the Glade the card never says a squishy left; a win there says "Everyone had a great time."
- **Wild levels roll −2 to +0 of the Partner's level** (was −2 to +1). *Why:* the target is a lone, un-grown Partner beating an ordinary wild squishy about 75% of the time; the sim gives 75% / 71% / 82% / 94% at L5 / 10 / 16 / 20. A starter now grows up after 23–30 wins at 1× care (was 22–29).
- **Wild levels keep following the Partner,** not the strongest teammate or the team's average, so picking a weaker team can't buy easier spawns.
- **No rarity level discount.** The owner chose one, then dropped it the same day: with −2 to +0 it made rarer squishies easier than ordinary ones. They're meant to be a step harder. The optional `SpawnRulesSchema.rarityLevelDiscount` field stays as a tested, unshipped knob.
- **Formulas stay as they are.** If a later target needs a gentler level step, `stats.levelDivisor` is the lever.

## 2026-10-06 — When daily tries come back (#201, PR #213)

_Proposed in PR #213; recorded by the coordinator after merge._

- **Relative times only, never clock times.** The patch's midnight isn't every player's, so "in 3h 20m" is right everywhere.
- **Countdowns round up to the minute,** then say "less than a minute", so they never say something is back before it is.
- **The team view shows the full-XP note for any squishy past its full wins today,** bench included, because a bench squishy can swap in.
- **The result card's note uses the device clock;** `PlayerBattle` carries no server time, and the note is coarse enough.

## 2026-10-07 — Hearthfires on captured land (#202, PR #222)

_Owner decisions of 2026-10-07. Proposed in PR #222; recorded by the coordinator after merge._

- **No fires on home tiles.** Home tiles are always safe. Hearthfires stand only on captured land, in a tile's middle, one per tile. Existing home fires were packed up at boot with a full refund and a one-time morning note.
- **Typed spots (#204):** `slot: centre | ring | edge`. Spot 0 is the centre, spots 1–6 the ring. Hearthfires are `centre`; habitats and Training Grounds are `ring`. A seasonal node counts as a centre occupant. The data leaves room for a lamp post as a second centre light.
- **Fuel:** up to 5 nights per fire, as before, spent lowest-first one night at a time. *(Raised to 8 nights by #285.)*
- **Refunds:** a fire on land you lose gives back what taking it down would: half the build and upgrades, plus all unburned fuel. A Jack-o'-Lantern always gives back its pumpkin. Only the home fires packed at boot gave back everything.
- **Outer fires don't move;** take one down and build it again.
- **Guards on watch need a lit fire's reach.** It supersedes "guards are safe on watch". A guard on a tile no lit fire reaches is exposed at nightfall; a guard on a home tile is always safe. A guard taken to the Hollow leaves the watch in the same transaction, and its tile falls back to its land's guardians. The tile panel warns about it, and the "light a fire" nudge counts guards.
- **`fireHint`** shows only while one of the player's gatherers or guards would spend the night on dark land.
- **Tutorial:** step `hearthfire` stays as a talk step; the new `land-fire` step comes after `territory`.
- **Map scale** for fires on land is 0.75. The tile panel caps its height and scrolls.
- **Migration 0027 is additive:** `lost_fire_refund` jsonb on `tile_attacks` and `tile_tending`, and the `packed_home_fires` table. There's no fire-per-tile unique index, because old homes could hold two fires and the migrate step would fail before the boot pass packed them up. The `(tile_id, spot)` key plus centre-only fires already allows one per tile.

## 2026-10-07 — A clear way back (#212, PR #217)

_Proposed in PR #217; recorded by the coordinator after merge._

- **No back pill over an open patch.** Looking around from a patch returns to it, and the patch already has its corner button.

## 2026-10-07 — Battle potions (#214, PR #219)

_Owner decisions of 2026-10-07, relayed by the coordinator. Proposed in PR #219; recorded by the coordinator after merge._

- **Boosts are +40%; Hearty Soup heals 40%** (all `// TUNE:`).
- **Recipes:** Brave Brew is 2 Treats + 2 Stone (not a Pumpkin, which only grows at Halloween), Cozy Cocoa 2 Treats + 2 Timber, Hearty Soup 2 Treats + 1 Emberwood; 2 minutes each.
- **Turn order:** swaps, potions, Heart Charms, moves.
- **Boosts stay on the squishy that drank,** through swaps. The shield waits on that squishy until a hit lands; a miss doesn't use it. A shielded hit still costs at least 1 energy. A new shield replaces the old.
- **One of each potion per side per battle** (`BATTLE_RULES.items.usesEach`). Hearty Soup at full energy is allowed: it heals nothing but still shields.
- **The content hash changed,** so a battle still going at deploy ended as "No contest!".
- **Action row (option A):** line 1 is Use Heart Charm, a compact 🧪 N button and one Swap that opens a "Who comes out?" picker; Run away is on line 2. Swapping is now two taps.
- **Lock order:** a potion's inventory row is locked before a tile battle's tile and the team's squishies, the same exception the Heart Charm has (tech spec §7).
- **AI sides never drink in Phase 1.** A future boss can, through data.

## 2026-10-07 — What's new (#220, PR #223)

_Proposed in PR #223; recorded by the coordinator after merge._

- **An entry's build number comes from git:** the commit that added the file. An entry never needs editing after merge.
- **A new device doesn't pop up.** It remembers its build quietly; only later updates pop.
- **No pop without a new entry.** A deploy with no player-visible change moves the seen build on quietly.
- **Backfilled entries show under #223's version,** because their files arrived with it.

## 2026-10-07 — Build menu, guardian feelings and the evolving meter (#207, #216, #205; PR #232, #226, #233)

_Proposed in each PR; recorded by the coordinator after merge._

- **Building effect chips come from building data** through a shared helper (`buildingEffects`) and are worded on the client, so new buildings get chips with no engine or menu code (#207).
- **The land fire card shows the description and chips** in place of its own radius line, as the build menu does (owner, #207).
- **Guardian hints carry feelings** (owner-approved contract change): each guardian's feeling in team order, or the species' own when the guardian has none. Never species, levels or elements (#216).
- **A squishy's joining level is stored** (`squishies.joined_level`, migration 0028), backfilled from `squishy.captured` events, else the level at migration (owner). A row without one pins it on its first XP (#205).
- **The evolving meter starts** at the later of the joining level and the level its form evolved into. There's no meter when a secret form comes next or on a top form. A public form with no public evolution says "Fully evolved! 🌟"; a secret form shows only its level (#205).
- **The results card reads the meter from the battle's stored rewards;** `battle.ended` is unchanged. A battle that evolves a squishy shows no meter; the celebration takes over (#205).

## 2026-10-07 — Account self-service without email (#197, PR #237)

_Proposed in PR #237; recorded by the coordinator after merge._

- **Helpers are grown-ups:** 18 or older by `users.birth_year`, checked on the candidate list, on saying yes and on each reset (owner).
- **Helpers are picked from a server-built list** (`invited_by` plus active patch-mates on multiplayer patches), never typed. No endpoint says whether a username exists.
- **Caps:** 2 helpers per player and 10 players per helper, unanswered asks included. 3 helper resets per helper in a rolling 24 hours.
- **A helper reset mirrors an owner reset** (sessions revoked, one-time password, new recovery code). Both sides agreeing replaces the "every map is this owner's" scope check. Helper resets are logged in `account_helper_resets`; `game_events` stays map-scoped.
- **A "no" is quiet:** the ask just disappears, and the player may ask again (rate-limited, no cool-down).
- **"Not you?" forgets every remembered name on the device,** after a confirm.
- **A new recovery code keeps sessions.** A wrong password there is a 400 (`VALIDATION_FAILED`), not a 401, because the player is still logged in.
- **Every recovery code rotation locks `users` before `recovery_codes`** (tech spec §7).

## 2026-10-07 — Rarity on info screens (#240, PR #243)

_Owner-approved mockup, 2026-10-07. Proposed in PR #243; recorded by the coordinator after merge._

- **The rarity chip sits under the name** on the close-up and the care sheet. Met Catalog cards get it; unmet "???" cards don't. Team picker and home rows get only the dot, with the word for VoiceOver.
- **Rarity colours and words live in `apps/client/src/ui/rarity/`,** shared by squishies, the wardrobe and the Boutique. Secret is `#d9468b` with a glow.
- **The chip's word stays in ink** (`#4a3150`); the rarity colour is the dot and outline, because the paler colours are hard to read as text.

## 2026-10-07 — Operator admin console (#196, PR #239)

_The owner approved the `/admin` mockup as it stands. Proposed in PR #239; recorded by the coordinator after merge._

- **Admin sessions and TOTP run on real time, never `HP_DEV_NOW`.** Game data in the console uses the game clock.
- **The TOTP secret is stored readable in `admin_totp`,** because it must be read to check codes. It never leaves the server over HTTP and is never logged.
- **Admin actions on join requests and invite codes run as the patch's owner,** so the maps module's rules, events and lock order apply unchanged. The audit row records the admin.
- **Admin routes gate in `preValidation`, not `preHandler`,** so a non-admin always gets 403, never 400, and learns nothing about a route's shape.
- **Admin sessions last at most 8 hours,** on top of the 30-minute idle limit (`ADMIN_MAX_HOURS`, `// TUNE:`).
- **"Find a username" widens the parent's dates by 14 hours each side** to cover any time zone, and shows at most 10 matches.

## 2026-10-07 — Side trays on a phone held sideways (#136, PR #235)

_Proposed in PR #235; recorded by the coordinator after merge._

- **On short, wide screens the side trays widen to 600 px with two columns** (under 520 px tall and at least 640 px wide). Upright phones and iPads keep the one-column tray.

## 2026-10-07 — Recipe book and Bag say what things do (#241, PR #248)

_The owner approved the mockup and screenshots. Proposed in PR #248; recorded by the coordinator after merge._

- **Battle chips say "oomph", not "attack",** using the battle screen's `STAT_WORDS` ("attack" is on the style guide's avoided list). The shield chip reads "Next bump 75% softer".
- **Gathered items say what makes them,** from recipe outputs ("🥣 Made from Pumpkins"), so new recipes show up with no code change.
- **The Bag card has no "See its recipe" button;** the approved v2 mockup drops it.

## 2026-10-07 — Water, Greens and Ice, and the nesting economy (#238, PR #249)

_Owner and coordinator decisions of 2026-10-07. Proposed in PR #249; recorded by the coordinator after merge._

- **`TerrainSchema.extraNodes` and an extra-node pass,** with today's mapgen output byte-identical and pinned by a golden test. No migration; nodes top up on read.
- **`RecipeSchema.fasterWith`:** 3 Water freeze into 1 Ice in 30 minutes, 15 with a Frost squishy.
- **The nesting economy (owner):** a terrain's base yield is its primary resource (meadow Greens, forest Timber, old forest Emberwood, hills Stone, mountains Ice instead of Glimmer, lake Water, pumpkin fields Pumpkins). Spots are the rarer secondary: no meadow spots, no extra mountain Ice spots, Greens on about 1 forest in 4, a well on every lake.
- **Treats are cooked from Greens** (2 → 3, about a minute, `// TUNE:`) or grown on farm plots. The `treats` id is unchanged.
- **Affinities:** Frost → Ice, Water → Water, Leaf → Greens. Feelings share resources: Water/Silly (moved from Treats), Leaf/Cozy, Frost/Sleepy (`// TUNE:`).
- **Out on the land, squishies gather the land's main resource; spots are the Keeper's** (owner). In the home ring, gatherers still work the spot.
- **A fire on a tile keeps its spot;** the tile's new node waits until the fire is gone, as it does for a tile a squishy gathers on.
- **Ice gets one named exemption** from #241's "every recipe says what it's for" guard until the Ice Wall (#203) uses it. Tests fail once Ice has a use, so the exemption can't outlive it.

## 2026-10-07 — Pick a wild squishy from the map (#209, PR #252)

_Owner decisions on the #209 mockup, 2026-10-07. Proposed in PR #252; recorded by the coordinator after merge._

- **The map marker is a rustling tuft,** not a paw print (paw prints stay the forest chihuahuas' clue).
- **The tile panel says "Something's rustling here!" with Meet it first,** above Claim. On short landscape screens the panel's big buttons sit two to a row.
- **The note under Find a squishy is "N nearby! Or tap a rustle to pick."** ("No wild squishies nearby right now." when there are none).
- **No tufts on the Tutorial Glade.** Kids meet starters through Find a squishy there and discover tufts on their first real patch.

## 2026-10-07 — A finger on a map button can join a pinch (#159, PR #250)

_Proposed in PR #250; recorded by the coordinator after merge._

- **A finger on a map button** (not one in a sheet) counts as half of a pinch once a finger is on the map and either moves; the button then gets no click. A button tapped with one hand while the other is on the map zooms instead, and a joined thumb stays in the gesture after the other finger lifts, so moving it pans.

## 2026-10-07 — The Mythic rarity (#261, PR #262)

_Proposed in PR #262; recorded by the coordinator after merge._

- **Mythic capture odds are 30% of the base chance** (`// TUNE:`), below Legendary's 40%.
- **Mythic's finish is the shimmer:** iridescent plus pearly bands that move with the view angle, never on a timer. Its colour is teal `#2aa6b8`, with an opal dot.
- **The Boutique never sells Mythic:** the data check refuses it, and the stock roll leaves it out.
- **The wardrobe's rarity filter shows only rarities that have catalog pieces.**

## 2026-10-08 — Ten special Halloween costumes (#261, PR #265)

_Owner decisions of 2026-10-08. Proposed in PR #265; recorded by the coordinator after merge._

- **Costume pieces can sit on body sockets** (`on`), up to 24 pieces, costumes only. Arm pieces may only roll.
- **Costumes wear their rarity's finish,** existing Legendary costumes included, and pieces can glow.
- **Marigold Calavera goes on the rack at 320.** This overrides #45's "Legendary is found-only" for this costume only; the Hollow Man stays found-only.
- **The Ghost Sheet goes from 60 to 210,** the Rare costume price, so costumes stay in rarity order. Boutique price order is checked within a slot, which also relaxes it for everyday pieces; `maxPrice` is 320.
- **New drop sources `battle` and `explore`.** Capturing land that had another owner uses `rivalChance` (20%). Every drop weight is ×10, with no change to relative odds.
- **Star Striker keeps its polka ball.**
- **Lucky Star counts Mythic finds.**

## 2026-10-08 — Emberwood fences (#203, PR #256)

_Owner decisions of 2026-10-07 (mockup 2) and on #244. Proposed in PR #256; recorded by the coordinator after merge._

- **Eight fences, one per element, three levels each,** with the same energy and toughness per level.
- **A two-part challenge:** the first squishy breaks the weakest exposed segment in at most 6 turns (`// TUNE:`). A standing fence holds and keeps the energy it lost. Breaking uses a try and starts the rest. Keep going finishes the challenge with no new try, within `FENCE_RULES.keepGoingMinutes` (10, `// TUNE:`), while the tile is still the same Keeper's.
- **If the owner rebuilds the gap during Keep going,** the tile counts as fenced again: the challenger faces a new fence battle after the tile's rest, and their try is spent. The client shows "resting".
- **Repair costs 25% of the segment's cost,** scaled by the energy it lost. Take down gives the usual share. A broken fence gives nothing back.
- **A rival's capture destroys the old owner's segments on the tile,** nothing back, and the owner's report counts them. **My own segments facing a tile I capture come down** for the take-down share (`lost: 'inner'`).
- **Rim edges facing off the map need no fence;** the server builds fences only on border edges.
- **Approved contract changes:** fence events (the attacker's identity internal only), `PublicTile.fences`, `Raid.fence` and `Raid.lostFences` (a count), `TerritoryStatus.fenceBroken`, `fence.removed`'s public `lost`, and the battle setup's fence participant and `turnLimit`.

## 2026-10-08 — Explore your land on the server, with homesteads (#199, PR #280)

_Owner decisions of 2026-10-07. Proposed in PR #280; recorded by the coordinator after merge._

- **The homestead bonus is yield, not speed:** +1 per cycle on a joined homestead, squishy and Keeper. Paused homesteads give nothing. *Why:* the speed bonus gave +0% because of the 4-cycle cap.
- **The new Keeper track is "Seeker".** The Territory "Explorer" track and the Explorer's Hat are unchanged.
- **Homesteads** aren't safe at nightfall, never fade once joined, and take no home buildings in Phase 1. Pumpkin fields need hands and a Shovel. Juniper's Gap is not explorable in Phase 1.
- **The homestead model is derived** from `tile_explore` rows plus ownership, with no tile column. Lock order: `tile_explore` rows after tiles and `tile_defenders`, in `(user_id, tile_id)` order.
- **Search spots don't depend on buildings,** so building never reshuffles progress.
- **A paused homestead is a pause window on its row** (`paused_at` to `resumed_at`) that the gatherer count leaves out, so a capture touches no squishy rows.
- **A tool is an item counted in uses** (`Resource.tool`), with no durability table.

## 2026-10-08 — Land borders and the legend (#278, PR #283)

_Proposed in PR #283; recorded by the coordinator after merge._

- **The legend is a card that opens from the icons beside the map's name,** not a permanent row of chips. *Why:* the space under the name already holds the gathering chip, chat, the land chip and tray hints. A small change from the mockup, for the owner's OK.
- **Every Keeper's ribbon is the same width.** A wider "yours" didn't show on a phone.

## 2026-10-08 — Trading posts on the map (#269, PR #282)

_Proposed in PR #282; recorded by the coordinator after merge._

- **A trading post is a terrain on the existing tile rows,** with no `buildings` row. Its name comes from its index in (q, r) order; nothing is stored.
- **Placement:** one post per home at the same distance first (the smallest that fits), then any left over where they're furthest apart without bringing a home a nearer post. Defaults: `perMap` 4, `maxFromSeed` 5, `minFromSeed` 3, `minApart` 4 (all `// TUNE:`).
- **The boot pass never takes owned, home or busy land.** It skips a patch with no fair spot (logged and shown in the admin console) and tries again every boot.
- **Posts never connect land,** and an edge facing a post needs no fence. Spawn and guardian tables can't list the post terrain.
- **Claiming a post is refused with `FORBIDDEN`** and a kid-readable message, as `home` is, not a new error code (coordinator).
- **The map's draw-call ceiling goes from 55 to 57** for one tile look and one hut mesh, however many posts.

## 2026-10-08 — Night at 7 PM; the Hollow Man grows bolder (#277, PR #285)

_Owner decisions and coordinator rulings of 2026-10-08. Proposed in PR #285; recorded by the coordinator after merge._

- **Night falls at 7 PM map time** (was 9 PM), so the Hollow Man arrives earlier (`19 * 60`, daylight saving included).
- **Hearthfires store 8 nights of fuel,** so a full week away loses nothing. It's a storage cap; a night's burn is unchanged.
- **A level-3 Hearthfire costs 1 Glimmer,** down from 2, for the sim gate's margin.
- **The shared night cap:** untended land tops up to `min(wildPerNight, 3)` minus that night's Hollow reclaims. Loss is never more than 3 a night, or 2 on a gentle patch.
- **"Unlightable"** means no node-free, non-home tile (any owner's) within the widest fire's reach (2). This is the lenient reading; the sim's cover model is stricter. Owner to confirm.
- **The walk is computed on the server.** Each Keeper gets up to 3 seeded lit recoils plus the strike tiles, ordered round their Heart Seed, starting with `enter` and ending with `leave`. Where he can't strike (the Glade), there's no walk and the stage is "watching".
- **The night's report is decided at 7:00.** In the small window a job retry opens, a skipped reclaim still shows as gone.
- **`MorningReport.stage` for nights before #277** is worked out from when the Keeper joined.
- **`rewildTiles` refreshes homesteads** for untended land too. The audit action is `patch.hollow_strength`.

## 2026-10-08 — Befriend land guardians (#279, PR #284)

_Owner decisions of 2026-10-08. Proposed in PR #284; recorded by the coordinator after merge._

- **A befriend is a knockout.** The engine flags the squishy that left as `befriended`; the last one isn't flagged, so the battle ends `captured` and wild battles stay byte-identical. No content-hash change and no migration.
- **No battle XP, extra coins or drops for befriending on land.** The claim's tile coins and one drop roll stand.
- **Friends are kept on a lost claim,** because they were granted when they said yes.
- **An evolved guardian joins one stage back,** as the species one evolution before the form it fought as, with that species' element and the guardian's feeling. A wild squishy joins as it was.
- **Once per window:** a guardian a player befriended stays out of that player's fights on that tile until the guardian window ends. The shared tile hint still shows the whole team.

## 2026-10-08 — Keeper faces and the Keeper builder (#289; PR #292, #297)

_Proposed in each PR; recorded by the coordinator after merge._

- **Keepers share one line face** (arched ink brows, flat ink nose, smile line). Face lines are always dark ink on every skin tone.
- **Ten skin tones, light to deep,** with Hazel `#7a4a2c` the deepest (owner). The darker tones were dropped rather than chasing line readability on them. Tones have no names: swatches on screen, "Skin tone N" for screen readers; ids `tone-1` to `tone-10`.
- **A Keeper is one model with every part a choice.** The 12 presets are starting looks; one tap sets every row. Body shape stays with the starting look for now. Blush, freckles, lashes and the heart sticker are player choices.
- **Builder fields are optional on input.** Rows store them complete; replies leave out the starting look's own, so older apps keep loading untouched Keepers. A save that leaves a field out keeps the stored value while the starting look stays the same.
- **The Keeper screen is one scrolling list,** and "That's me!" always shows (owner).

## 2026-10-08 — Journeys to trading posts (#270, PR #293)

_Owner decisions of 2026-10-08. Proposed in PR #293; recorded by the coordinator after merge._

- **Difficulty:** level `4 + 2 × distance`, uncapped; team size 1 at distance 1–2, 2 at 3–5, 3 from 6 (`// TUNE:`).
- **Older patches keep #269's fairness rule:** every home equally far from its nearest post, even when that's 5 from the Heart Seed.
- **The trail pool is the common and uncommon year-round base forms,** so difficulty is distance, not a rare draw.
- **A journey to a connected post, or one with a pass still open, is refused** (`CONFLICT`).
- **No coins and no found clothing on a journey win:** it's a gate, not a farm. XP as a wild win.
- **The preview lives in the post's tile panel,** with "Start journey" first.

## 2026-10-08 — The night show (#277, PR #299)

_Proposed in PR #299; recorded by the coordinator after merge._

- **One Hollow Man per walking Keeper,** made when a walk starts and gone when it leaves (3 draw calls each).
- **Others' walks are silent,** so the card never talks about someone else's night. Joining part way plays only my own walk.
- **Dark land on the client is the plain `safeTiles` rule.** Land claimed today and land no fire could light still show dark; lighting them is never wrong.
- **"Light my land" and "🔥 Light fire" glide to the farthest dark tile** and open its panel. They don't pick a fire site for the kid.
- **The dusk nudge shows from 60 minutes before nightfall** (`DUSK_MINUTES`, `// TUNE:`), once a night per device, so a kid has time to gather Emberwood. Confirmed by the owner in #302.
- **The replay is offered** for the newest night with a walk, until this device watches or skips it.

## 2026-10-08 — The explore view (#199, PR #290)

_Proposed in PR #290; recorded by the coordinator after merge._

- **A drag anywhere on the tile is the floating joystick;** a tap that doesn't move walks. The action button sits bottom right.
- **Every mini-interaction has a one-tap or hold easy way** that finds exactly the same thing, so a gesture never blocks a search.
- **Seeker rewards:** titles Rock Flipper, Trail Seeker and Seeker of Secrets; pieces Seeker's Bandana, Trail Pack and Mossy Crown; coins 25, 50 and 100.
- **Tool recipe hints stay sealed** until their ingredients are collected.

## 2026-10-08 — Crafting Factory (#294, PR #301)

_Owner decisions of 2026-10-08 (the mockup and all 9 recommendations). Proposed in PR #301; recorded by the coordinator after merge._

- **Queues by level:** 2, 3 and 4 batches at levels 1, 2 and 3.
- **Costs:** level 1 is 30 Timber and 20 Stone; level 2 is 60 Timber and 50 Stone, with no Glimmer; level 3 is 120 Timber, 90 Stone and 12 Glimmer. `pnpm sim:factory` guards level 1 by day 7 and level 2 by day 10.
- **A batch is one recipe, as many as the bag can pay for,** paid up front. The only cap is a technical 999 (`FACTORY_RULES.maxBatch`). The same recipe can run in two batches.
- **Stopping keeps what's made and gives back every unfinished run,** the one being made included.
- **Seasonal recipes only start in season;** a batch started in season finishes after it. Only open recipe-book pages can be queued. Speed-ups are fixed when the batch starts.
- **Upgrades keep batches running.** Taking the Factory down, or leaving the patch, stops them with that refund, plus half the building's cost for a take-down.
- **"Queue in Factory" stays hidden until a Factory is built,** with a one-time Sprout tip.
- **Welcome back:** the first settle after 30+ minutes away (the patch off screen) that lands Factory things shows a card, after the land's card if both have news. Shorter trips get the usual pop-up.
- **Name and look:** "Crafting Factory", a cozy toy workshop with 🏭.

## 2026-10-08 — Trades, escrow, gifts and the mailbox (#271, PR #300)

_The owner approved the #271 screens with one change. Proposed in PR #300; recorded by the coordinator after merge._

- **Long names never split mid-word.** They shrink to fit (`fitName`, minimum 10px, `// TUNE:`), wrap only between words, and use "…" only as a last resort, on every shelf, offer and mailbox name.
- **Escrow:** a squishy keeps its owner while `in-trade`; items leave the bag into the offer (`trade-escrow`); clothing is held by its offer's id.
- **On a yes,** the sender's side lands with the receiver at once. The receiver's side waits in the sender's mailbox. Pickup makes squishies active, grants items (`trade`) and marks the species as caught.
- **A gift is a mailbox row from the moment it's sent;** picking it up is the yes. `/accept` on a gift is a 409. The receiver may decline it, and a gift past its time can't be picked up.
- **A resting squishy that lives in a habitat may be offered;** its habitat is cleared when it moves. This goes beyond "resting only" in the design doc and needs the owner's OK.
- **In-trade squishies are off the job board and territory status.** One on its way to you stays hidden until pickup, so a secret species doesn't show early.
- **Giving away your last copy of a piece** takes it off your Keeper and your squishies.
- **Leaving a patch calls off its trades** in a separate transaction after the leave commits. Expiry is lazy, before every trade read and command, and is the backstop.
- **One open offer per pair, gifts included** ("One at a time!").
- **A send can race the owner switching trading off.** Left as is: an open trade can't be accepted while trading is off, and pickup works with trading off on purpose.
- **Pickup events are `gift.collected` and `mailbox.collected`.** A dev-only connect route exists for e2e and phone testing.

## 2026-10-08 — Training Grounds move to homesteads (#277, PR #302)

_Owner-confirmed defaults of 2026-10-08, relayed by the coordinator. Proposed in PR #302; recorded by the coordinator after merge._

- **The boot pass packs up home Training Grounds** with the note "Your Training Grounds packed up and moved out! Build one on a homestead 🏡." (two lines, under the morning report's 12-word cap).
- **A trainee on a napping homestead keeps its job** and makes no progress while it naps.
- **A trainee leaves its habitat bed when it starts training,** and moving into a habitat stops training, like gatherers. It reverses #193's "a trainee keeps its habitat bed".
- **API:** `SetJobRequest.training.buildingId?`; `JobsView.trainingGrounds` becomes a list (it replaces the single object rather than sitting beside it); `TrainingStatus` gains `q/r/firelit/napping`; `HollowStatus.trainingGroundsPacked`. A stale app's job board fails to parse until it updates.
- **`training-grounds` stays in `HOME_BASE_RULES.buildableKinds`,** the global "playable at all" gate. "Not at home" is enforced by `placement: 'homestead'`.

## 2026-10-09 — Explore view, cozy-sim feel (#291, PR #311)

_Proposed in PR #311; recorded by the coordinator after merge._

- **The camera never turns.** It's a fixed 3/4 view from behind. The Keeper starts in profile so the face shows on opening.
- **Tool icons are drawn, not emoji,** because some render as a box on older iOS.
- **The full card is only for rare finds and a finished tile.** Everything else is a toast and the bag bounce.
- **The lantern plays in the open,** with the screen darkened around a warm light, not in a separate cave.
- **The header bag isn't tappable while exploring;** it only bounces "+N".

## 2026-10-09 — The split-view trade screen (#305, PR #309)

_Owner decisions on the #305 mockup. Proposed in PR #309; recorded by the coordinator after merge._

- **iPhone layout: two narrow columns, mine | theirs.**
- **Colours by role, not by player:** mint is always "you", lilac the patch-mate. A real Keeper colour would be a new saved setting and a later issue.
- **The iPad landscape side panel widens from 430 to 640** so both columns fit with the map still live.
- **Trade values (pulled forward from #272):** squishy = rarity × stage × synergy × (1 + 0.08 × (level − 1)); items per id; clothing per rarity. Even is within 15% of the bigger side; lopsided is one side at 2× or more. An unmet species counts as a first-stage uncommon with neutral synergy at its real level. All in `TRADE_VALUES`, `// TUNE:`.
- **"Newest" uses the time-ordered UUIDv7 ids** (newest found, not newest received); items have no date and sort last.

## 2026-10-09 — The Lorebook (#307; PR #312, #315)

_The owner approved the mockup in full on 2026-10-09. Proposed in PR #312; recorded by the coordinator after merge. PR #315 added the explore card's button._

- **Four chapters and 12 pages:** Juniper's Gap, The Wild Lands, The Hollow Man, Little Guardians, with all pages and hints as written.
- **Ways in:** a 📖 Lorebook tile at the top of the Bag, a sparkle on the Bag button while a page is unread, **Open Lorebook** on every found-page card and on explore's find card, and Settings.
- **Lore triggers may use the finder `payload-user`** (the payload's `userId`) for system events, like a squishy taken to the Hollow (coordinator: additive, inside lore's own schema, no event payload change).
- **A page counts as read once it's on screen in the book.** Pages found before #307 start unread.
- **An unfound page's slot id is its place** (`<chapter>-<order>`), so not even its title's slug leaves the server.
- **Card order:** the found-page card waits while the "Make a patch" form, the book or explore is open. Other cards wait for an open book. The account chip steps aside while the book is open.

## 2026-10-09 — Emoji floor and drawn tool icons (#308, PR #316)

_Proposed in PR #316; recorded by the coordinator after merge._

- **Emoji floor (owner):** only the seven Emoji 13–14 emoji already in use (🪵 Timber, 🪨 Stone, 🪶, 🪱, 🫐, 🛖, 🫧) are allowed, on the hand-checked `ON_THE_FLOOR` list in `ui/emoji-floor.test.ts`. Everything else must be Emoji 12 or older. That makes the effective floor iOS 15.4, well inside the iOS 17 device floor.

## 2026-10-09 — A lighter map when zoomed out (#318, PR #321)

_Proposed in PR #321; recorded by the coordinator after merge._

- **The map changes detail by zoom, not by chunk.** Zoomed out, tiles and props draw from low-detail meshes (one per look and kind) and prop shadows hide. Draw calls stay flat.
- **Chunked culling was built, measured and dropped,** so nobody retries it blind. At the map's 58° tilt the start-zoom camera still sees 66–79% of the map. Chunking roughly doubled draw calls for a 21–33% triangle cut, added 150–270 meshes and up to 70% build time.
- **What the LOD saves:** a busy radius-12 patch zoomed out goes from 729k to 376k triangles (61 → 60 draw calls); a radius-16 6-seat prototype from 1.27M to 630k (64 → 63). Up close is unchanged.
- **The steady map draw-call count is about 61 (r12) and 64 (r16).** The "16/18" in the plan came from frames where Babylon skips meshes still compiling shaders.
- **E2E asserts the render budget:** draw calls ≤ 75; triangles ≤ 800k up close and ≤ 420k zoomed out on a 4-seat patch; zooming out never costs draw calls.
- **No mid-detail tier yet.** Up-close triangle work waits for the iPad 9th gen check.

## 2026-10-09 — The Keeper and team hop (#317, #323; PR #322, #325)

_Proposed in each PR; recorded by the coordinator after merge._

- **The hop is visual only.** Fields take optional `lift`, `squash` and `shadow` placement values; the shadow stays on the ground.
- **Followers glide along the Keeper's trail,** (i + 1.5) × `followGap` back, instead of snapping between trail points.
- **Followers keep a camera-derived lead** (`followLead`), so the team waits on the far side from the camera and never covers the Keeper.
- **Field `move()` re-places in place** (no re-layout). Contact shadows take an optional per-instance `shadowAlpha` and are always drawn.

## 2026-10-09 — Six-seat patches and six Keepers (#318; PR #324, #327)

_Proposed in each PR; recorded by the coordinator after merge. See also "Owner decisions (coordinator)" below._

- **New patches seat 6 on a radius-16 map,** with homes 10 steps from the centre, so neighbours are as far apart as on a 4-seat patch. Older patches keep their 4 seats.
- **`maps_max_players_range` is 1–6** (migration 0039), defaulting to 6.
- **Trading posts are `max(perMap, seats)`,** so 6 on a 6-seat patch.
- **An open home draws as a soft lavender dashed outline,** with no wash or badges, all open homes in one mesh. Its panel says it's saved for the next Keeper who joins.
- **The camera's farthest zoom scales with the map's width,** so wider patches frame like a radius-12 one.
- **STYLE_GUIDE:** a patch is "one shared world, up to 6 players; older patches 4".

## 2026-10-09 — Owner decisions (coordinator)

_Owner calls made in the coordinator session on 2026-10-09._

- **Patches have up to 6 players.** New maps are radius 16 (817 tiles); patches made before #324 keep 4 seats. Empty seats are wild land until someone joins. Open homes get **no claim buffer**, so late joiners claim further out (#318).
- **The map lowers detail by zoom (LOD), not by chunks;** see "A lighter map when zoomed out (#318, PR #321)".
- **Performance floor:** iPad 9th gen (A13) at 30 fps or better on a busy 6-seat patch, and iPhone 14 at 60. The owner runs the real-device check before the playtest.
- **In explore, the Keeper and team hop as they walk** instead of gliding, with smaller hops for short steps (#317, #322). Followers stay behind the Keeper, and the hop shadow fades (#323, #325).
- **Emoji floor iOS 15.4, and tools drawn as icons;** see "Emoji floor and drawn tool icons (#308, PR #316)".
- **Six Keeper looks, palette A:** Strawberry/heart/solid, Blueberry/star/dash, Grape/flower/dot, Tangerine/diamond/double, Cherry/moon/dash-dot, Mint/leaf/long dash (#327).
- **Filed for Phase 2:** #319 (the Boutique moves into the trading post only, out of the top-right menu) and #320 (sell duplicates to the post, plus open offers and auctions for items and resources, without coins).
