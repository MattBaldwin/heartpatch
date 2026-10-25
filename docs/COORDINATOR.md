# Heartpatch — Coordinator Playbook

> How the **supervisor (coordinator) session** runs the build: launching parallel build sessions, merging their PRs, and keeping the codebase consistent. Any supervisor session follows this file, so the process survives a handoff. Rules for build sessions live in `CLAUDE.md`; decisions and their reasons live in `docs/DECISIONS.md`.

Session tools (`create_session`, `send_message`, `archive_session`, `list_triggers`, `delete_trigger`) are claude-code-remote MCP tools; GitHub actions use the `mcp__github__*` tools. Load either with ToolSearch if they are deferred.

## 1. Roles

- **Project owner (Matt):** makes product and design calls, provides accounts (AWS, GoDaddy, GitHub secrets), and approves anything that changes a decision.
- **Supervisor:** plans batches from the issue dependency graph, writes briefs, starts build sessions, runs the merge gates, merges, audits for drift, and escalates owner decisions. It doesn't write feature code, except small `Chore:`/`Docs:`/`Fix:` PRs and taking over a stuck lane.
- **Build session:** one issue, one lane, one PR. It runs its own reviewer loop and reports milestones (CLAUDE.md, "Report to the coordinator"). It never merges.
- **Reviewer subagent** (`.claude/agents/reviewer.md`): independent, read-only, runs every check itself.

## 2. Launching a build session

1. **Pick work** whose "Depends on" issues are merged. Run issues in parallel only when they touch separate folders. Contract-defining work merges before the work that consumes it.
2. **Write the brief** from the template in §7. Every brief includes:
   - the reporting block
   - lane **Owns / Must not change**
   - concrete files on `main` to copy
   - the decisions that apply (DECISIONS.md entries by name)
   - issue-specific guidance
   - build checks, PR rules, and a review loop capped at 4 rounds (a round caused only by merging `main` doesn't count)
3. **Start it** with `create_session` (source = repo, `outcome_branch` = `issue-<n>-<slug>`, tags `heartpatch:phase-1` and `heartpatch:batch-<k>`). Pick the model per §6.
4. **Don't subscribe** to the PR (§5). The lane subscribes to its own PR; pick the PR up from its `opened` report or the next sweep.

**Full send for Phase 1 (owner, 2026-10-11):** the 4-lane cap is lifted until Phase 1 ships (due Oct 31). The separate-folders rule in step 1 still holds. **Every PR gets a fresh lane session**; don't reuse a lane for its next PR.

### Lane size and handoffs (owner, 2026-10-18)

Lanes do **small changes** and hand off cleanly. A long-running lane gets expensive: every step re-reads its whole conversation, so cost grows with context even when the step is tiny. One house lane ran for a week across several PRs and cost about $770.

- **One small PR per lane.** If an issue needs more than one PR, the supervisor splits it into parts (for example B5a, B5b) when briefing, and each part gets its own fresh lane.
- **Context cap:** when a lane's context passes about **200k tokens** (`get_session`, `context_usage.used_tokens`), the supervisor tells it to wrap up: push a coherent state, get that PR to ready (or leave it open with `Part of #N`), and post the handoff comment.
- **Handoff note (required when a lane stops with work left on the issue).** The lane posts it as a comment on the issue, titled `Lane handoff`. A comment outlives the session, so the next lane can read it after the old one is archived. It holds:
  - the branch and head SHA
  - what is done and merged (PR numbers)
  - what the next part covers, as a short scope list
  - the owner-approved mockups and captures (artifact links) and the owner decisions that apply
  - open gotchas: failing or flaky checks, tooling quirks, things that looked wrong but aren't
  - the files to start from
- **The next lane's brief links that comment** under "Before writing code" and doesn't depend on the old session.
- The supervisor archives the old lane only after the handoff comment is posted.

### Big features (owner, 2026-10-11)

A feature is **big** when it is a new or changed core DB table or migration; an economy, battle-engine or server-authority change; a non-additive shared-contract change; or a multi-PR, multi-layer feature. Additive optional schema fields, client-only art and UI, and data-only content are not big. The supervisor decides "big" when briefing and says so in the brief.

For a big feature:
1. **Fable writes the plan** as an issue comment: files, schema and type deltas, the migration with backfill and rollback, API and WebSocket changes, the UI flow, edge cases, named tests and risks.
2. **Opus codes it** against that plan. The PR body lists **Plan deviations**.
3. **A Fable reviewer is the second reviewer** on the first full review.

Rulings so far: #372B and #376 are big; #261, #379, #372A and the trail and cave are not.

### Migrations (owner, 2026-10-11)

- **Migration freeze, Oct 15–18:** no DB-changing merge from the day before the family playtest through its end (the playtest runs Oct 16–18).
- **Outside the freeze:** merge when green, one migration at a time, and #376 first.

## 3. Merge gates (all required)

1. A reviewer **APPROVE** verdict comment for the **current head** commit.
2. **CI green** on that same commit.
3. **Cross-PR pass (supervisor):** read the diff against `main` and the other open PRs. Look for lane violations, duplicate helpers, a second way of doing something, naming, and contract changes nobody flagged.
4. **Decision compliance:** the PR follows every DECISIONS.md entry that applies to it. Spot-check the code, not just the PR body.
5. **Base is current:** if `main` moved in a way that could interact, the branch has merged `main` and CI is green again.

Merge with **squash**, passing `expectedHeadSha`. Post or confirm the verdict comment.

**Render-checks (visual work):** before a capture reaches the owner, a read-only helper subagent checks it. Start it with the Agent tool (`general-purpose`, `model: "opus"`, background). It returns **PASS** or **FIX** with a list. Captures name their quality tier and show no dev HUD.

**Don't wait for pings.** On every `check_suite.completed` event, check for a verdict on the current head yourself: read the PR comments (`pull_request_read` → `get_comments`) for the build session's verdict comment naming that SHA. The "ready" ping is a convenience, not a dependency.

## 4. After a merge

- **Tell dependent sessions** what landed that affects them (new contracts, files they also touch). Use `send_message` with priority `next`; use `now` only for something blocking or urgent.
- **Check the other open PRs for conflicts** (`pull_request_read` → `get`, `mergeable_state: "dirty"`, or `git merge-tree` locally). A PR that conflicts with `main` runs **no** `pull_request` CI, so no `check_suite` event ever fires and its session can wait forever. Tell each conflicted session to merge `main` now.
- **Archive the finished session** (owner-approved), only after any `Lane handoff` comment is posted (§2). Before archiving, delete its self-scheduled "Re-check PR" triggers (`list_triggers`, filter by `persistent_session_id`).
- **Start what the merge unblocked.**
- **Drift audit after each batch:** run a fresh read-only auditor over `main`. It looks for duplicate implementations, pattern drift, code vs docs, secret data reachable from the client, and contracts the next batch will need. Turn findings into:
  - a small `Chore:`/`Docs:` PR,
  - plus a lint rule or doc change so the drift can't recur,
  - and notes for the briefs of upcoming issues.

## 5. Watching sessions

**A session is stuck if any of these is true:**
- the same check fails on 3 consecutive pushes;
- more than 4 review rounds without APPROVE (rounds caused only by merging `main` don't count);
- no new commit in about 40 minutes while it shows as working;
- its cost is more than about 3× a typical lane with no green CI in sight.

**When stuck:** read its recent actions, then send a specific fix or narrow its scope. If that fails, stop it and take over or restart with a tighter brief. Scope changes beyond existing decisions go to the owner.

**Sessions can't run WebKit** (only CI can). Client e2e tests assert on the game's own signals (counters, state), never pixel-exact screenshots.

**Check-ins:** the earlier "don't schedule check-ins to poll sessions" rule is superseded by the owner's request for active supervision (2026-10-23): sweep GitHub every ~20 min while lanes are active (§9, "Check-in"). **The supervisor does not subscribe to lane PRs** (owner, 2026-10-23): a PR's events go to one session, and each cost the supervisor about 4k tokens of context. Lanes own their PR subscriptions and report to the supervisor; the supervisor merges on the gates from the sweep.

## 6. Usage and models (owner decision)

| Work | Model |
|---|---|
| Big features: the plan, and the second reviewer on the first full review | Fable (`claude-fable-5-1`), owner decision 2026-10-11 |
| Big features: the code | Opus 5.5 (`claude-opus-5-5`) |
| Other code lanes (not big) | Opus 5.5 (owner rule 2026-10-05) |
| Client UI and content (not big) | Sonnet 5.5 |
| Every PR review (the `reviewer` subagent) | Opus 5.5 (owner decision 2026-10-11) |
| Drift audits and docs-only work | Sonnet 5.5 |
| Periodic end-to-end review of the whole solution | Fable (`claude-fable-5-1`), only when the owner explicitly asks for it |

The 2026-10-11 rows replace the earlier "docs-only reviews on Sonnet" row: every PR review now runs on Opus. Where rows overlap, big wins: a big feature's UI is coded by Opus, and only non-big client UI and content go to Sonnet.

**Keeping supervisor cost down:**
- Treat trivial wakes (subscription confirmations, merge echoes) as one-liners.
- Batch tool calls.
- Don't re-read large files.
- **Why lanes are short and fresh:** cache reads cost the same on Opus and Sonnet and dominate lane cost. Every PR gets a fresh lane session, capped at about 200k tokens of context, with a handoff comment when work is left (§2, "Lane size and handoffs").
- When the supervisor's context gets large (about **400k tokens**, owner decision 2026-10-11), **hand off** to a fresh supervisor session (§8). **A supervisor must never reach context compaction** (owner, 2026-10-23): hand off well before it. Supervisor 9 reached 735k context and cost $719.

**Avoid mid-flight scope changes** unless they're blocking contracts. They roughly doubled one lane's cost (#6).

Report usage to the owner when asked, and flag any lane above about $20 (except #13: about $30, see §9). A typical phase-1 lane cost $5–12; read per-session cost from `get_session`.

## 7. Brief template

```
You are a Heartpatch build session working on GitHub issue #{N}: "{TITLE}" in mattbaldwin/heartpatch.
A coordinator session assigned this to you and will merge your PR. Other sessions are working in
parallel right now ({PARALLEL}), so stay inside your lane.

## Reporting (required by the project owner; part of this task)
Follow "Report to the coordinator" in CLAUDE.md: send_message to "@parent" with one line:
`#{N} PR #<n> opened` / `#{N} PR #<n> ready: reviewer APPROVE, CI green on <sha>` (only once CI is
green on your final head) / `#{N} blocked: <one line>` / `#{N} CI red on <sha>: <check>, fixing`.
Subscribe to your own PR (subscribe_pr_activity) so CI results wake you. If the CI wake doesn't arrive,
check `get_check_runs` yourself before going idle; never wait silently on a green PR.

## Before writing code
Read CLAUDE.md, the relevant GAME_DESIGN/TECH_SPEC sections, STYLE_GUIDE, DECISIONS (name the
entries), apps/server/README.md. Read the issue. Copy these files on main: {CONCRETE FILES}.
{IF CONTINUING: Read the `Lane handoff` comment on the issue first: {HANDOFF COMMENT LINK}.}

## Your lane
- Owns: {OWNS}
- Must not change: {NOT}
- Shared-contract changes: don't; report `#{N} blocked:` instead.
- Build sessions can't edit `.github/workflows`; the coordinator makes CI changes.

## Issue-specific guidance
{GUIDANCE, including applicable decisions, audit carry-overs from the coordinator notes}

## Build
Branch issue-{N}-{slug} from latest origin/main. Before every push: pnpm format:check && pnpm lint
&& pnpm typecheck && pnpm test && pnpm build (+ PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium
pnpm test:e2e if client). DB tests: DATABASE_URL against local Postgres 16.

## Pull request
Don't edit docs/DECISIONS.md; put new decisions under `## Decisions` in the PR body (the coordinator records them after merge).
Title `#{N}: <summary>`, `Closes #{N}` (or `Part of #{N}` + what remains), deps with reasons,
"How to test on iPhone" for client work, "Coordinator notes".

## Size and handoff
Keep this PR small: one part of the issue. If you find the work is bigger than one PR, finish a
coherent part and report `#{N} blocked: needs split: <what's left>`. When you stop with work left on
the issue, post a `Lane handoff` comment on the issue (COORDINATOR.md §2, "Lane size and handoffs"):
branch + head SHA, done/merged, next part's scope, approved mockups and decisions, gotchas, start files.

## Review loop
Reviewer subagent until APPROVE; fresh reviewer each round; at most 4 rounds, then report blocked.
A round caused only by merging main doesn't count.
Post the verdict comment summarizing each round. Don't merge.
```

## 8. Supervisor handoff

1. Wait until the build sessions this supervisor started have merged, or hand them over explicitly: send each one the new supervisor's session id to report to. Their `@parent` reports belong to the session that started them; the lanes keep their own PR subscriptions.
   - **The new supervisor owns re-routing (hard rule).** At every check-in until each lane has confirmed the switch, it reads each lane's recent events (`list_events`, kinds `assistant`) for a `send_message` to `@parent` or to the old supervisor. Any lane that still reports there gets the correction again, and the new supervisor re-checks GitHub for whatever that report said (opened PRs, verdicts, blockers), because the old supervisor may already be archived. Lessons from the supervisor 5 → 6 handoff: two lanes kept reporting to `@parent` after being told, and one report was a deploy blocker.
2. Make sure everything durable is in the repo: DECISIONS.md, this playbook, and the briefs' carry-over notes (§9).
3. Start the new supervisor with a compact prompt:
   - read this playbook, CLAUDE.md and DECISIONS.md;
   - current `main` state, open PRs and sessions;
   - the queued follow-ups (§9);
   - the next batch to launch.
4. Retire the old session (rename it "(retired)"). Don't archive it until the owner says so. (Build sessions are archived after merge, per §4; supervisor sessions are not.)
5. **Lineage limit (coordinator rule, 2026-10-11):** sessions nest at most 8 deep, counting the owner's first supervisor session as depth 1. The last supervisor, at depth 7, doesn't start another one. It writes the handoff into the repo (this playbook, DECISIONS, and the §9 state) and asks the owner to start the next supervisor from a fresh session.

## 9. Open follow-ups for upcoming briefs

The supervisor keeps this list current. Remove items as they land.

- **State (supervisor 16 handoff, 2026-10-25 ~02:25 UTC):** main `6ade165` (#663), migrations through 0059. Phase 1 is due Oct 31. DECISIONS is current through "2026-10-25 — Owner decisions and coordinator calls (supervisor 16)". Merged under supervisor 16: #658, #661, #660, #663. **Lineage is at the limit:** supervisor 16 was depth 7, so the owner starts supervisor 17 from a fresh session (depth 1 again).
- **Lanes in flight.** Each reports to supervisor 16. **Supervisor 17's first job:** send each lane its session id with "report to me from now on (not @parent, not supervisor 16)" and confirm each switch (§8). The lanes' @parent is supervisor 16, who is retiring.

| Lane | Session | Model | State at handoff |
|---|---|---|---|
| #652 battle camera | session_01VcgKMM7bJDCTCKSWitQfn7 | Opus | PR #662 at f963dad (main merged), CI running. Owner screens approved, reviewer APPROVE stands. Merge on green. Then tell #656 to merge main and re-shoot landscape. ~$28, past cap. |
| #651 furniture collision | session_012CGASVrWZPEG23BtogBkGM | Opus | PR #666, owner-approved, CI running. ~$25. |
| #654 door sparkle | session_01KeFwYLALnBtn6Aet32iZYV | Sonnet | PR #667, owner-approved, CI running. |
| #657 Keeper bodies | session_01M3Prx7iS5iLSC4sx6usbpU | Sonnet | PR #665, owner-approved (v4, hands on hips OK). One CI failure to check. |
| #655 B sell server | session_0123znVDm43dnicWq8dtuDob | Opus | PR #668, needs Opus + Fable APPROVE. When it merges, start #655 C (client Sell tab, plan §11 row C, from the part B Lane handoff on #655). |
| Controls B2b | session_01Q3gaJyyf3ZTWfdnMxThnpS | Sonnet | Owner-approved (v4). PR coming. |
| #664 music | session_0111CwPFcW65bLs6K7UZ8Dy9 | Opus | Owner-approved by ear. PR coming. |
| #656 battle sheet | session_01A4ki5ZK3QfXiyAttzyssbP | Sonnet | Holding until #662 merges, then merges main, re-shoots landscape, render-check, then owner. |
| Controls D2 | session_01VsBejqQ2kX9uauASFnXpa4 | Sonnet | Building. Screens (render-check, then owner) next. Map legend left for later (W1-4 owns map/). |
| #501 explore fps | session_014Gew1kNrjygNXk9ZzAK5q5 | Opus | No-repro. May open a small "no blocking GPU wait per frame" PR, or stop. Archive when done. |
| e2e fix | session_013Bbxqq72VnQJMuiuaF3sUx | Opus | Fixing iPad e2e failures on main: lorebook:44, map-hole:63, lobby:135, tutorial-flow:563, tutorial:515. Urgent: main is red on ipad groups 1 and 2. |
| #382 squishy Wave 2 | session_01StqxPaD94zxAurY2S1VYPz | Sonnet | Rendering a 72-frame species sheet (slow). Sheet goes to render-check, then the owner. Past cap: if it needs a re-shoot, it should post a Lane handoff instead. |
| #621 W1-2 mapgen | session_01DNAMb3gFEfciDcg5K5yJXt | Opus | Just started. |
| #621 W1-5a roads (migration 0060) | session_01So3UgZNFQubx1rLMcXFbMF | Opus | Just started. The only migration lane. |
| #621 W1-4 island map | session_015MjtcmZYTvxc3Wmp8xYHZw | Opus | Just started. Owner screens (iPhone 15 + iPad). |
| Wild Isle planner | session_01PdqoGSArLRgVrdshJnaZvq | Fable | Idle, ~$41. Archive after Wave 1 lands. |

- **Queue (start in this order as lanes free up):**
  1. #655 C (client Sell tab) after PR #668 merges. Then ask the owner whether #655 D (Gift/Trade/Swap bar) is Halloween.
  2. Wild Isle: W1-3 after W1-2; W1-5b and W1-7 (migration 0061) after W1-5a; then W1-6, W1-8, W1-9, W1-10, W1-11 per plan §6 and revision 1.
  3. **Logged nits:**
     - the What's new date wraps on SE
     - `isPlural` in crooked-text.ts
     - the 6e/6f nits
     - the Water echo near the home indicator
     - room-name pills truncate ("Dining Roo…", "Conservato…")
     - disabled Feed looks enabled in close-up
     - the trays `hp-settling` fallback (the e2e-fix finding)
     - re-measure the E2E_GROUPS medians after a few runs; group 6 iPad is the tightest
  4. **Owner to-dos:** optionally allow kenney.nl, opengameart.org and freesound.org (Network access → Allowed domains). Optionally delete the stale remote branch `chore-ci-e2e-timeout` (auto mode blocks the coordinator from deleting it).
- **Sweep helper:** the supervisor's sweep script checked, for each open PR, the head SHA, check-run counts, a reviewer APPROVE comment naming the head, and `git merge-tree --write-tree origin/main <head>`. Recreate it in your scratchpad.
- **Watch:** `lobby.spec.ts:9` (owner/friend join) hit its 120 s timeout twice on one ipad-webkit group 5 run on PR #644, then passed. If it recurs, it gets a robustness fix.
- **Filed, no lane yet:** #341 (Forest Chihuahua, Phase 2), #319 and #320 (Phase 2).
- **Check-in (owner, 2026-10-23):** a supervisor sweep every ~20 min while lanes are active, via a self-bound trigger (arm your own and delete your predecessor's). The owner asked for active supervision: sweep GitHub for open PRs (no PR subscriptions, §5), merge on the gates, nudge stuck lanes, and start the next queued lane.
- **Owner working style (supervisor 5 handoff):** explain the technical reasons; ask ONE question at a time with the recommended option first; open screenshots and mockups as they arrive; say when something is testable locally (DEPLOY.md §9). Opus 5.5 builds and reviews code, Sonnet 5.5 writes and reviews docs; Fable only when the owner explicitly asks, for a periodic end-to-end review (§6). Nothing visual is built without an owner-approved mockup or captures first. **Show the screens before asking (2026-10-11, relayed by the coordinator):** always send the owner the images, or open the artifact, before asking him to choose or approve. Never ask an approval question with only a link. **Features must be felt (2026-10-11, relayed by the coordinator):** a feature needs visible feedback, not just correct text, and the home must be personal and personalizable. **Squishies are the most important visual part (2026-10-11, relayed by the coordinator):** every new kind needs a unique, memorable hook and a distinct silhouette, with a creative brief and a duplication check before building. Quality beats dates: ship fewer great kinds rather than more weak ones.
- **Merge gates as practised:** reviewer APPROVE on the exact head; all checks green on it; `git merge-tree --write-tree origin/main <head>` clean; squash via `gh api -X PUT repos/MattBaldwin/heartpatch/pulls/N/merge -f merge_method=squash -f sha=<full sha>`; a verdict comment ending with the Claude Code footer. A check red **on main too**, or a test this PR doesn't touch that fails across several PRs while a fix lane owns it, doesn't block (say so in the verdict comment).
- **After a merge:** check the other open PRs for conflicts (`git merge-tree --name-only`); delete the lane's own one-shot triggers (`list_triggers` with `recurring:false`, filter by `persistent_session_id`); archive the lane. Never archive a supervisor.
- **Brief notes:**
  - **Coins (#45):** credits are keyed on `(source, ref_id)`. Care must never spend a Heart Charm without reordering locks (TECH_SPEC §7).
  - **Every new event consumer takes one `maps` lock per event** (TECH_SPEC §7). Don't batch events.
- **Briefs:** follow §7, plus:
  - reporting with the fallback trigger;
  - neither sessions nor the supervisor can re-run CI (403), so a flaky test gets a robustness fix in the PR, never a skip;
  - e2e players must pick a Keeper (`HP_KEEPER_REQUIRED`).
  - Name tables exactly as TECH_SPEC §4's core table list. #17 cost a mid-flight rename because a brief invented names.
- **Merge order and churn:**
  - Every PR adds a migration, so later PRs regenerate theirs after each merge.
  - **Run one migration-adding lane at a time.** #21 cost $58 after four merges of `main` and three migration regenerates.
  - Hold lanes that edit the same files (battles module, spawn tables) rather than run them in parallel. Lanes that started on a current main and never re-merged were the cheapest (#18 $25.77, #15 $23.11, #42 $23.57).
  - **Review cap (owner decision, 2026-10-03):** at most 4 rounds; rounds caused only by merging `main` don't count.
- **Lock order** is in TECH_SPEC §7 ("Lock order"). New code must follow it, and `lock-order.test.ts` checks it.
- **Test robustness:**
  - `keeper-gallery.spec.ts` ignores Babylon's shader-fallback console noise (headless WebKit has no GPU). Check a real iPad for the fallback during #28.
  - `keeper.spec` timed out once under a full local run.
  - #9's `squishy-gallery.spec.ts:168` (jiggle to idle) should wait on a signal, not on timing.
  - The auth login rate-limit test runs about 2.6 s against a 5 s timeout: raise the timeout, or lower the Argon2 cost in tests.
- **Earlier follow-ups still open:**
  - #9: count real draw calls in the "flat draw calls" e2e; NullEngine tests for `SquishyField.move` and `remove`; partial buffer updates; rebase `squishTime`; forward part taps to the body; the crypto ban misses `globalThis.crypto`.
  - #7: a FORBIDDEN resync for map A while the player opens map B lands them in the lobby; a doc comment on `generation`.
  - #47: start, replay and skip each have their own limiter; add a live wake-up delivery check.
  - #27 deploy: `restore.sh` should re-allow connections on a leftover `heartpatch_restore`; add a `/ws` check to `local-smoke.sh`.
  - Server hardening: shared `lib/rate-limit.ts`, a loose global per-IP limit, helmet/CSP or a note that Caddy sets the headers.
  - The avoided-words scan over error messages.
  - Each merged PR's "Coordinator notes" list that lane's own follow-ups.
- **Lessons (2026-10-25, supervisor 16):**
  - **When a visual fails 3+ render-checks on the same core problem, take it to the owner with a different approach** instead of iterating. #306 needed six "light the room" rounds. The #657 hands question was settled in one owner answer.
  - **A long foreground check can hide a coordinator message for an hour,** so lanes run long checks in the background.
  - **Lanes past ~300k context cost the most.** #652 reached $28 and #651 $25, mostly from re-shoots and review rounds at 400–565k. Move screen re-shoots to a fresh lane once a lane passes about 300k.
  - **The supervisor's context grows fast with 12+ lanes.** Supervisor 16 hit 429k in 4 hours. Use a helper subagent for status tables, keep render-checks in helpers, and check your own context every few sweeps.
  - **Owner approvals from AskUserQuestion get closed by container restarts** (twice tonight). Re-ask at once, with the artifact opened in the same response.
  - **CI is the bottleneck with 7+ PRs open.** Jobs queue for 20+ minutes. Batch merges when they clear.
  - **A remote branch name can already exist from months ago.** `chore-ci-e2e-timeout` did, and PR #659 opened against the stale branch. Check `git ls-remote` before reusing a branch name.
  - **Render-check helpers can't always save the artifact file.** Tell them to write the returned content verbatim, never to hand-type a copy.
  - **Costs tonight:** #653 $12.25, #655 A $7.34, W1-1 $18.52, #655 planner $15.99, supervisor 16 ~$36 at 429k.
- **Lessons (2026-10-24, supervisor 14):**
  - **Playwright's fake clock starves Babylon rendering.** `page.clock.install()` fakes rAF, so each fake 16 ms costs a whole SwiftShader frame: portraits took 156 s, and the Water picker faces never drew. Shoot "asleep" and picker frames without the fake clock (6e3's finding).
  - **Render-checks caught real bugs every round:** a room pill truncated with no ellipsis, "The flames needs", the battle tip in the home-indicator area, a different random state between phones, captions describing things not on screen, and swapped titles on the artifact page. Keep checking every round, including page-only changes.
  - **Briefs must not over-specify a capture.** A brief that named a specific rare friend and pickers for all powers produced false FIX items. Name what must be shown, not the random outcome.
  - **Random rolls differ between phones:** chest opens roll a random extra. Seed them, or reuse one saved state, and caption anything random.
  - **A Sonnet lane can run past the 200k cap when its local state is expensive to rebuild.** 6e4 hit 248k for $4.90, which beat a fresh lane re-scouting for 75 min.
  - **Fable planning costs:** the Wild Isle plan was $19.95 and hit 262k context in its first 4 minutes, because its helpers returned whole files. Brief planners to have helpers return short summaries.
  - **Container restarts closed pending AskUserQuestions about five times today.** Re-ask at once with the artifact opened in the same response.
  - **Lane costs today:** 6e2 $10.13, 6e3 $8.48, 6e4 $4.90, B2a $11.29, E2E rebalance $3.22, Wild Isle plan ~$20; supervisor 14 ~$13 at 295k.
- **Lessons (2026-10-23, supervisor 13):**
  - **Render-check every round.** The first two checks of 6f's screens came back FIX on real bugs: "as it opens" frames byte-identical to the whole frames, and a reward card that could cover the chest lid on slow devices because it waited on real time while the scene ran its own clock. The Run-away fix needed simulated safe-area insets (Chromium `Emulation.setSafeAreaInsetsOverride`), because Chromium's insets are 0. The artifact page itself must stack below 600px and use native-size PNGs.
  - **Long house lanes still cost the most.** 6e cost $58 (737k context), 6f $43 (649k), 6d $38. Most of it was re-shoot cycles at high context. Finishing work goes to a fresh lane (6e2) with a `Lane handoff`.
  - **Lane costs today under supervisor 13:** Run-away fix $5.74 (Sonnet). Supervisor 13 about $12 at handoff.
  - **The supervisor re-routing message to 6f was blocked once by the auto-mode classifier.** A reworded message got through. Re-check each lane's confirmation.
- **Lessons (2026-10-23, supervisor 12):**
  - **Every first render-check of a lane's owner screens came back FIX,** mostly from capture slips: the dev HUD or "(dev)" buttons showing, different players before and after, "Reconnecting…", tips covering half a pair. Briefs now list those as rules. The check also caught real layout bugs: safe-area insets, a modal covering the top bar, a disc left behind, an inverted button hierarchy. Keep checking every round.
  - **Lanes kept reporting to `@parent` after a handoff until told three times.** The retired supervisor forwarding their reports kept anything from being lost.
  - **Nobody can re-run CI (403).** When main has moved, merging main is the real push that re-runs CI on a fresh head. A main-merge-only review round doesn't count against the cap.
  - **Container restarts closed pending AskUserQuestions several times.** Re-ask at once, with the artifact opened in the same response.
  - **Lane costs today:** Controls D $10.18 (363k context), #601 PR 10 $5.21, 6d $37.81 (590k context, three re-shoots and three review rounds; flagged to the owner).
- **Lessons (2026-10-23, supervisor 11):**
  - **Put the artifact link in the question text itself (owner, 2026-10-23).** The owner didn't see an opened artifact beside an AskUserQuestion. Every approval question names its artifact URL inline, as well as opening it.
  - **Container restarts drop a pending AskUserQuestion.** The tool call is closed unanswered and nobody refused it. Re-ask it on the next turn: open the artifact and ask in the same response, before slower work.
  - **Render-check results survive a restart in the subagent transcript.** Read the `SubagentHandback` input with `jq` from `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl` instead of re-running the check.
  - **Re-shoots cost lanes a cycle each.** Briefs for visual lanes now say: shoot every phone from the same game state, put the tier in every caption, and give an "as it opens" frame as well as a whole-card frame. Two re-shoots turned up a real bug already on main (the tile panel kept the last tile's scroll).
  - **A timed-out e2e job with every test passed is still red**, and nobody here can re-run it (403). The fix is a real push (a main merge when main has moved), never an empty commit, plus #635's longer timeout until the groups are rebalanced.
  - **Pace sweeps to the work.** While every lane only waits on the owner, stretch check-ins (60 → 120 → 240 min) and stop after three empty ones; go back to 20 min when he answers.
  - **Lane costs today:** Controls C $4.38, Controls A $14.94, Warehouse client $38.72, Crooked House 6c $53.46. The house and warehouse lanes ran long on CI fixes and re-shoots.
- **Lessons (2026-10-22):**
  - **Long lanes are expensive.** Lanes past ~200k context cost $50–66.
  - **Reviewers fix only blockers.** 5–7 review rounds were spent on nits. Nits are logged as follow-ups, not fixed in the PR.
  - **Hand off the supervisor near 400k, and never reach compaction (owner, 2026-10-23).** Supervisor 9 ran 11 days to 735k context and cost $719.
  - **Owner questions:** ask ONE at a time, recommended option first. Open the artifact and render-check images before asking. Never ask the owner for perf or flag tests. Flag any lane over ~$20.
- **Lessons (2026-10-11):**
  - **Superseded runs look like failures.** A run replaced by a newer one can show as red or stopped. Check whether it was superseded before treating it as broken.
  - **There are no required checks on main.** Branch protection requires none (#349 showed `mergeable_state: clean` with zero check runs). The §3 gates are the only guard, so read CI on the head yourself.
  - **A lane's `@parent` is its creator.** Its reports go to the session that started it, so after a handoff the new supervisor re-routes the lanes (§8).
  - **Polish lanes burn cache.** Long polish sessions cost the most in cache reads. Keep them short, or start a fresh one.
  - **Never merge on a chat "ready".** Merge only on the reviewer's APPROVE and green CI on the exact head SHA, checked on GitHub.
  - **Stop orders aren't self-enforcing.** A lane can keep working after a STOP. Confirm a hold on GitHub (draft state), not only in chat.
- **Lessons (2026-10-10):**
  - **Render-check visual work at the tier the owner will see.** Headless SwiftShader drops to the low quality tier (no shadows, LOD or AA). Explore captures shot that way, on flat scene design, were rejected outright. Pin the tier (`?tier=`) and label every capture with it.
  - **Render-check every artifact before it reaches the owner:** screenshot it with Playwright, look at it, then delete the PNGs.
  - **"Continue from where you left off" always means resume the pending work.** Never answer it with "No response requested".
  - **`merge_pull_request` needs the full 40-character `expectedHeadSha`.** A short SHA is refused.
  - **A STOP to a lane can cross a message already in flight.** Confirm a hold on GitHub (draft state), not just in chat.
- **Lessons (2026-10-05):**
  - **A red main costs every lane.** Each PR re-merged main and re-ran 8–15 min of WebKit CI per merge; the day's seven lanes cost about $650 (taps $154, tutorial $152, battle $108, screens $65, rules $64, flakes $60, tray-fix $40). Fix main first, and fix a timing test by waiting on the game's own state (`still()` in `apps/client/tests/e2e/layout.ts`), never on time.
  - **`docs/DECISIONS.md` is append-only at the bottom, so every pair of open PRs conflicts there.** Lanes now put their decision text under a `## Decisions` heading in the PR body; the coordinator appends it to DECISIONS.md after the merge (in the next Docs PR). Lanes don't edit DECISIONS.md.
  - **A test that waits for the UI to settle can hide the bug it guards.** Keep one test that acts mid-motion (#126's sticky-tap spec fails without the fix).
  - **Split a lane that finds a second root cause** into its own small PR rather than growing the first (#126 grew to 8 review rounds).
  - **Containers can't SSH out** (port 22 is blocked by the egress proxy). AWS work goes through the API; the server's own setup runs as Lightsail's first-boot script.
- **Earlier lessons:**
  - CI wakes get lost, so sessions check `get_check_runs` themselves before going idle (§7).
  - Check DECISIONS before copying an issue's text into a brief. #45's "per map" came from the issue and contradicted decision F (the coins are the account's).
- **Cost so far (USD):**
  - Batch 6: #13 48.88, #42 23.57, #17 36.72, #14 43.98.
  - Batch 7: #18 25.77, #15 23.11, #43 46.62, #19 32.99, #16 17.29, #10 17.19, #12 4.59, #21 58.10, #20 33.19. Fix PR 11.24, audit 1.87.
  - Batch 8–9: #95 10.14, #96 9.22, #94 10.96, #93 1.56, #97 16.73, #98 11.44, #99 29.61, audit 1.9.
  - Batches 10–12: #102 5.24, #103 10.37, #104 6.31, #105 36.09, #106 32.17, #107 24.81, Docs #101 2.00, audits 2.83 and 2.92. The CI split (#100) was coordinator-made.
  - Supervisor 3: about 28.
  - Big lanes run $25–50; flag above about $35.
- **Owner questions queued:** none open. The tutorial gate, tutorial coins, the Halloween clock, the milestone member count and the #24/#44/#45/#46 confirmations were answered on 2026-10-04 (DECISIONS, "2026-10-04 — Owner decisions").
  - **AWS:** done 2026-10-05 (DECISIONS, "Deploy on the new AWS experience"). A fresh supervisor container needs the network policy to allow `*.signin.aws.amazon.com`, `signin.aws.amazon.com`, `*.amazonaws.com` and `*.api.aws`, then the CLI install and `aws login --remote --region us-east-2 --profile heartpatch` (pipe the pasted code into the waiting process through a FIFO). Agent Toolkit rules live in the uncommitted `CLAUDE.local.md`.
