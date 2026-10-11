# Supervisor 9 handoff (from supervisor 8, 2026-10-11 ~05:00 UTC)

You are the coordinator for mattbaldwin/heartpatch. Follow CLAUDE.md and docs/COORDINATOR.md. Matt (the owner) doesn't read code: he approves screens and gameplay, and you approve and merge PRs. Supervisor 8's session is `session_01AdDpax9Xp7nGUbP6ueLWXt`, at depth 7 and with 500k context, so it stands down. You start at depth 1 (a fresh session), so lanes you create can spawn their own lanes again.

## First actions
1. Arm a self check-in with send_later about every 45 minutes, and re-arm it first at every check-in.
2. Call subscribe_pr_activity on every open PR: #368, #363, #387, #388, #390. Also subscribe to #371, #372B's PR and #389's PR once they open.
3. Send EVERY live lane (table below) one message from your session: "Supervisor 9 here, send all reports to <your session id>, never @parent or older supervisors." Lanes answer whoever messaged them last.
4. Tell Matt in one line that you've taken over.
5. Archive supervisor 7 (`session_01PZEra8T4keVFQxAYpPpYBU`, idle; it was relaying) and supervisor 8 once lanes are re-pointed.

## Owner working style (hard rules, many set today)
- **Screens first, one question at a time.**
  - Before ANY approval question, send the images (SendUserFile, display "render") or open the artifact.
  - The question itself says in plain words what is being approved and includes the link.
  - Ask one question per AskUserQuestion, with the recommended option first.
  - Matt was frustrated today when this wasn't followed.
- **Summaries only; no chatter.** Help level is HIGH: explain the technical reason behind each answer in plain words.
- **Render-check every artifact before Matt sees it.**
  - Use a read-only helper subagent: Agent tool, general-purpose, model "opus", background. It returns PASS/FIX and saves owner-ready PNGs (one per decision, captions burned in) into your scratchpad.
  - playwright-core: run `npm i playwright-core` in the scratchpad, then launch with executablePath '/opt/pw-browsers/chromium' and args ['--headless=new'].
  - Tell lanes to run their own independent checker subagent before pinging you (the #381 mockup took 7 rounds).
- **Features must be FELT, not just correct**: visible feedback, not text lines.
- **Squishies are the most important visual part of the game.** Every new kind needs a unique hook and silhouette (a creative brief with a duplication matrix before building). Quality beats dates: ship fewer great ones.
- **The Keeper's home must be immersive and elite**: a living 3D place, one of the main reasons players return.
- **Never:**
  - put model names in commits, PRs or code (naming models inside recorded decisions is fine);
  - push empty commits, or close and reopen PRs;
  - modify your checkout's main (use scratchpad worktrees);
  - run two migrations at once;
  - share secrets or the family signup code;
  - archive a lane without checking its title and status first (supervisor 8 accidentally archived the #363 lane mid-task).
- Drain ReadNotifications before every reply to Matt. A worker restart is never "no response requested".
- A `check` job failure where the log shows "fast: cancelled" is a superseded run, not a real failure.

## Merge gates (COORDINATOR §3)
1. A reviewer verdict comment naming the exact head SHA (Opus; big features also get a Fable second reviewer on the first full review).
2. All checks green on the head, with e2e run (not skipped) for code PRs.
3. Mergeable; for overlapping files, run typecheck plus tests on the merged tree in a scratch worktree.
4. A cross-PR read plus a DECISIONS spot-check.
5. Squash with the full 40-character expectedHeadSha.
6. A verdict comment with the footer. Then unsubscribe and archive the finished lane.

**Migration freeze:** no DB-changing merge from Oct 15 to 18 (the family playtest). Merge #387 (#376, migration 0043) BEFORE Oct 15. #372B's migration waits until #387 merges.

## Merged today by supervisor 8
#383 (trades flake), #361 (evolution batch 3), #380 (14 hairstyles), #379 (lake), #384 (docs), #368 (live PvP), #388 (Hollow Man costume), #392 (pink-hole fix, #389), #390 (DECISIONS for 2026-10-11).

NOT yet recorded in DECISIONS (a write was blocked; confirm with Matt directly, then record): one question at a time with the link and images in the question; rare-and-up glow (#391); the immersive, elite home (#381); squishies are the most important visual.

## Live lanes
| Lane | Session | Model | State / next |
|---|---|---|---|
| Evolution #363 | session_01HqBDwq9EsTGvcjvNEkCxSG | Sonnet | READY on 12aa1905dffd8cd269b304d15887b5bfa4ae548c (APPROVE plus 15/15 green). Before merging, show Matt the batch-4 shots and ask, one at a time: (1) Mossquilt −2% stats OK? (2) Stormhoot: add a rarity condition, or drop its "Rare" label? Close #32 by hand after the merge. |
| Happiness #376 → PR #387 | session_01WhoeQV818PcqWJY4DUaJ5f | Opus | BIG; plan posted. LATEST: round-4 Opus APPROVE on f25bbd7, but its requested fix 8eec836 isn't pushed, and the PR must merge main (#368 touched battles/service.ts). Told to push both and get a delta verdict plus green CI. MERGE BEFORE OCT 15. Map-cue follow-up filed as #393. The Fable reviewer approved round 1; the Opus round-1 blockers are fixed (1adc5b3). The owner APPROVED 4 visible cues (hearts badge, pop-up, mood chips, care badge) plus a floating-hearts burst; being pushed into #387. Needs an Opus delta review, green CI and a merge BEFORE Oct 15. Follow-up issue to file: map cues (hearts/bounce) after an older-iPad perf check. |
| Build flow #371 → PR #396 | session_013B8mt2y3btb3TJPPHBkuuy | Sonnet | Owner APPROVED all 4 choices. PR #396 open (404fda9); the Opus reviewer is running. |
| Keeper creator #372B | session_01XUWM9fHiLMJarDUX5E1eBv | Opus | BIG. Owner APPROVED the design (revision 2: Body step with compact tiles plus the outfit row; eye colour moved to Colors). The plan was posted late, so the deviations are listed. Draft PR #394: CI is red by design (the server reads face/body columns) until its migration lands after #387 merges. A prettier fix is pending. Opus plus Fable reviewers. |
| Art #335 trail/cave | session_01PueHb7QTFgUkvjQGsoJ4QN | Sonnet | #379 merged. The trail/cave branch has merged main. Coordinator OK'd the additive explore contract items (display-name renames only, a one-time search reset with a What's new note). Mockup v3 in progress (ghost rock, glints, label overlap). PR #395 is open (ca6ea79) and the Opus reviewer is running. Still owed: Matt's stone-vs-mossy answer (images at scratchpad owner-335/3-stone-vs-mossy.png were sent; ASK one question with the link https://claude.ai/artifact/1AQgskMxF1KoVXUCGfeNr8). Coordinator OK'd glints passing under the HUD (same as the meadow). Adds a `?fps=1` badge on prod: after deploy, ask Matt to open play.pumpkinpatchgames.com/?fps=1 on the iPad 9th gen, walk each biome for about 20 s, and report fps (pass ≥30). |
| 500 squishies #382 wave 1 | session_01BJnkbYZasTKgnsdF7BzHVE | Sonnet | Owner: the first 30 are duplicative, so be more creative. A Fable creative brief (hooks, silhouette/colour/part/pose families, duplication matrix) is being written; show it to Matt BEFORE building. 4 data-only parts were added (eye-bumps, shell-dome, claw-arms, lure-lantern, plus moth-wings). The CREATIVE BRIEF is ready: https://claude.ai/artifact/LN42r6nCSVUPTPQ8VuKaci (opened for Matt, NOT yet approved). 30 kinds: 3 rares (Moonmoth, Steamboo, Cometsnail), 9 uncommon, 18 common; a duplication matrix; 3 new data-only parts. ASK Matt to approve the brief (one question, with the link). Coordinator answers to the lane's 3 questions: element shown in a part is OK for everyday kinds; Cometsnail accent glow is OK; data-only parts are OK. Then build, render-check and show Matt. It also holds the rare-glow B2 prototype for #391. |
| Keeper's home #381 plan | session_01U5LY5oM6zbQf9hErc7PGmF | Fable | Phase 2, BIG. Owner decisions are in the #381 plan comment. LATEST owner direction: IMMERSIVE and ELITE, a living 3D place (walk in, roaming residents, time of day and seasons, daily reasons to return, 3D furniture placement, paint, sign, memories). The plan is updated for immersive (§1c, PR split A,B,C,H,D,F,G,E); mockup v9 has real-engine renders (Snug 76 draws/100k tris, Hall 98/187k). Waiting on: render-check v9, show Matt, then ask (1) the camera (orbit-limited walk-in vs dollhouse cutaway); (3) PR order (living house H before furniture D). Coordinator calls pending: (2) the house.gift event, ledger reason and house_gifts table (additive, likely OK); (4) the older-iPad 30 fps gate (Matt holds the iPad, using the ?fps=1 flag). |

## Other open items
- **#391** (owner: YES, rare-and-up squishies glow, and finding one is a huge moment). Part 1: a colour-preserving glow stepping up by rarity (the first prototype washed out pale kinds). Part 2: a reveal plus a befriend celebration. Needs a lane after the #382 brief.
- **#385**: the account pill covers the care sheet top. Start a lane after #387 merges (same file).
- **#386**: computer patch-mates (Phase 2, BIG); its questions go to Matt when it's planned.
- **Follow-ups to file:** a dev route that guarantees a lake (for a lake e2e); #376's map cues.
- **#350 and #346** (old drafts): close as superseded once the trail/cave PR merges.
- **Playtest readiness (Oct 15):** a live deploy check, backups, the #362 smoke checklist, the iPad fps check above.
- **Older owner asks:** iPhone checks of #330 and #334; a backups check; suggest a GitHub ruleset requiring the `check` job.
- **Cost:** supervisor 8 spent about $46. Lanes so far: #376 $30, #381 $22, #372B $17, #371 $14. Hand off at ~400k context.
