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
