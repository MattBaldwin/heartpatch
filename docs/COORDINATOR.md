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
4. **Subscribe** to the PR as soon as the session reports `PR #<n> opened`.

## 3. Merge gates (all required)

1. A reviewer **APPROVE** verdict comment for the **current head** commit.
2. **CI green** on that same commit.
3. **Cross-PR pass (supervisor):** read the diff against `main` and the other open PRs. Look for lane violations, duplicate helpers, a second way of doing something, naming, and contract changes nobody flagged.
4. **Decision compliance:** the PR follows every DECISIONS.md entry that applies to it. Spot-check the code, not just the PR body.
5. **Base is current:** if `main` moved in a way that could interact, the branch has merged `main` and CI is green again.

Merge with **squash**, passing `expectedHeadSha`. Post or confirm the verdict comment.

**Don't wait for pings.** On every `check_suite.completed` event, check for a verdict on the current head yourself: read the PR comments (`pull_request_read` → `get_comments`) for the build session's verdict comment naming that SHA. The "ready" ping is a convenience, not a dependency.

## 4. After a merge

- **Tell dependent sessions** what landed that affects them (new contracts, files they also touch). Use `send_message` with priority `next`; use `now` only for something blocking or urgent.
- **Check the other open PRs for conflicts** (`pull_request_read` → `get`, `mergeable_state: "dirty"`, or `git merge-tree` locally). A PR that conflicts with `main` runs **no** `pull_request` CI, so no `check_suite` event ever fires and its session can wait forever. Tell each conflicted session to merge `main` now.
- **Archive the finished session** (owner-approved). Before archiving, delete its self-scheduled "Re-check PR" triggers (`list_triggers`, filter by `persistent_session_id`).
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

**Don't schedule check-ins to poll sessions** (owner decision). Rely on reports, GitHub events, and session-failure notifications.

## 6. Usage and models (owner decision)

| Work | Model |
|---|---|
| Build sessions that write code; reviewers on code PRs | Fable (`claude-fable-5-1`, owner decision 2026-10-05) |
| Docs-only PR reviews, drift audits, simple content/docs sessions | Sonnet 5.5 |

**Keeping supervisor cost down:**
- Treat trivial wakes (subscription confirmations, merge echoes) as one-liners.
- Batch tool calls.
- Don't re-read large files.
- When the supervisor's context gets large (≈ 600K+ tokens), **hand off** to a fresh supervisor session (§8).

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

## Review loop
Reviewer subagent until APPROVE; fresh reviewer each round; at most 4 rounds, then report blocked.
A round caused only by merging main doesn't count.
Post the verdict comment summarizing each round. Don't merge.
```

## 8. Supervisor handoff

1. Wait until the build sessions this supervisor started have merged, or hand them over explicitly: send each one the new supervisor's session id to report to, and subscribe the new supervisor to their PRs. Their `@parent` reports and PR subscriptions belong to the session that started them.
2. Make sure everything durable is in the repo: DECISIONS.md, this playbook, and the briefs' carry-over notes (§9).
3. Start the new supervisor with a compact prompt:
   - read this playbook, CLAUDE.md and DECISIONS.md;
   - current `main` state, open PRs and sessions;
   - the queued follow-ups (§9);
   - the next batch to launch.
4. Retire the old session (rename it "(retired)"). Don't archive it until the owner says so. (Build sessions are archived after merge, per §4; supervisor sessions are not.)

## 9. Open follow-ups for upcoming briefs

The supervisor keeps this list current. Remove items as they land.

- **State (supervisor 5, 2026-10-05 evening):** main `d60573e` after the bug-bash stabilization (#166, #125, #167, #169, #168, #126, #170, #171 merged; #121 closed as superseded by #170). Server live on Lightsail (see DEPLOY.md and DECISIONS 2026-10-05 "Deploy on the new AWS experience"); the owner adds the four GitHub secrets, then runs the Deploy workflow.
- **In flight:** the taps-flake lane (`fix-taps-gather-flake`: `taps.spec.ts:164` gather → chip → Bag fails intermittently on busier branches' WebKit legs) and the lean full review (three read-only reviewers → one ranked report; feeds the art bible).
- **Plan after stabilization (owner-approved, in order):** lean review report → owner questions one at a time → **ART BIBLE** mockup (palette, lighting, materials, UI kit, motion, squishy style, Sprout) → visual-upgrade lanes per area, each mockup-first (map/terrain resumes #124 on a fresh session from `83a0aa7`; squishies/close-up; HUD kit, menus, recipe book; cinematic; lobby/onboarding) → **Sprout lane** (she/her, face mockup first, portrait in every bubble, data-driven first-time tips with server-side seen state, an "Ask Sprout" button whose next-best hint the server computes without leaking secrets, she rewrites "See the grey land?") → **food lane** (4–6 foods with recipes, a Feed picker, element/feeling favourites, short boosts, same daily caps, the balance sim must pass).
- **Remaining Phase 1:** #28 device playtest on the live server. Follow-ups: spotlight relayout on an older iPad; `homeNodeOf` tests; a server capability flag to hide "(dev)" buttons; the #126 round-7 notes landed; move the server to the 2 GB plan when AWS allows it.
- **Owner working style (supervisor 5 handoff):** explain the technical reasons; ask ONE question at a time with the recommended option first; open screenshots and mockups as they arrive; say when something is testable locally (DEPLOY.md §9). Fable (`claude-fable-5-1`) does all build, fix and review work. Nothing visual is built without an owner-approved mockup or captures first.
- **Merge gates as practised:** reviewer APPROVE on the exact head; CI green on it; base current, or a merge-only delta verified with `git merge-tree`; squash with `expectedHeadSha`; a verdict comment ending with the Claude Code footer. A check red **on main too**, or a test this PR doesn't touch that fails across several PRs while a fix lane owns it, doesn't block (say so in the verdict comment).
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
- **Docs drift:** #22 may be closed but still open on GitHub. Confirm and close.
- **Earlier follow-ups still open:**
  - #9: count real draw calls in the "flat draw calls" e2e; NullEngine tests for `SquishyField.move` and `remove`; partial buffer updates; rebase `squishTime`; forward part taps to the body; the crypto ban misses `globalThis.crypto`.
  - #7: a FORBIDDEN resync for map A while the player opens map B lands them in the lobby; a doc comment on `generation`.
  - #47: start, replay and skip each have their own limiter; add a live wake-up delivery check.
  - #27 deploy: `restore.sh` should re-allow connections on a leftover `heartpatch_restore`; add a `/ws` check to `local-smoke.sh`.
  - Server hardening: shared `lib/rate-limit.ts`, a loose global per-IP limit, helmet/CSP or a note that Caddy sets the headers.
  - The avoided-words scan over error messages.
  - Each merged PR's "Coordinator notes" list that lane's own follow-ups.
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
