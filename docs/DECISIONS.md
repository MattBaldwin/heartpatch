# Heartpatch — Decision Log

> Product and process decisions made with the project owner, with the reasoning, so parallel sessions don't re-open them. The design doc and tech spec hold the resulting rules; this file explains **why**. Add new entries at the bottom.

## 2026-10-02 — Kickoff

### Scope and schedule
- **Phase 1 keeps its full scope.** Nothing is cut or shrunk.
- **The Halloween window is extended for 2026** (to Nov 9, `// TUNE:`) so the launch gets a full Halloween run if work slips past Oct 31. Season windows may overlap (design doc §15).
- **Order:** work the critical path first (#1 → #2 → #3 → #4 → #5 → #7 → #13 → #15 → …). Large standalone issues (#46 cinematic, #45 Boutique, #25 audio) fill gaps in parallel.

### PR workflow
- **Every PR is reviewed by the `reviewer` subagent** (`.claude/agents/reviewer.md`): a senior engineer persona with deep TypeScript and game-development experience. It runs the checks itself and returns APPROVE or REQUEST CHANGES.
- The author fixes or answers each finding with evidence; a **fresh** reviewer instance re-reviews with the prior findings and responses. If the same point is still contested after 3 rounds, escalate to the project owner.
- **Once the reviewer approves and CI is green, the coordinating agent merges.** The final verdict is posted as a PR comment for the record.

### Parallel sessions and drift
- The coordinating agent starts and coordinates parallel sessions, **2–3 issues at a time**, only after the scaffold (#1) has merged and only for issues that touch separate folders.
- **Shared contracts land on `main` before dependent work splits off:** `game_events` types, the error-code enum, the WebSocket envelope, hex coordinates, data schemas.
- **Drift control:** lint rules and import boundaries enforce standards automatically; the reviewer checks consistency with existing `main` patterns and the style guide; the coordinator merges the latest `main` and re-runs CI before every merge; a drift audit sweeps `main` every ~5 merges or weekly. Drift is fixed with a small follow-up PR **and** a new lint rule or doc update so it can't recur.
- Content issues most at risk of story drift (#10, #24, #43, #46) don't run at the same time.

### Deployment
- **Build towards a workable version before deploying.** Client work is verified with Playwright (WebKit, iPhone/iPad viewports) and PR screenshots.
- When gameplay and visuals are ready to test on a real device (after #6, #7, #9), the coordinator walks the owner step by step through AWS account creation, Lightsail setup and the GoDaddy DNS change, then lands #27.

### Devices and playtesting
- Playtest devices: **iPhone 14+** and **iPads from the last ~4 years**. Default quality tier high; WebGPU primary with WebGL2 fallback. The spec's lower performance floor stays as a safety margin.
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
