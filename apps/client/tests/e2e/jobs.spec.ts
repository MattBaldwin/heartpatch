import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/**
 * Squishy jobs on an iPhone (owner decisions 2026-10-04): send a squishy to
 * gather from the job board, let its work finish (the dev short timer) and
 * collect it; then pick a team and see it fight in the next battle.
 * Checked through the dev hook and the API, never pixels or timing.
 */

/** `JobsDebug` from src/squishies/jobs/index.ts (this project can't see its types). */
interface JobsDebug {
  board: {
    open: boolean;
    mapId: string | null;
    jobs: Record<string, string>;
    team: string[];
    ready: Record<string, number>;
    note: string;
  };
  team: { open: boolean; picked: string[]; saved: string[]; note: string };
  badges: number;
}

interface BattleBody {
  battle: { mySide: 'a' | 'b'; view: { sides: Record<string, { squishies: { id: string }[] }> } };
}

const jobsState = (page: Page) => hook<JobsDebug>(page, 'jobs');
const mapState = (page: Page) => hook<{ id: string; live: string | null }>(page, 'map');

test('a squishy gathers on its own, and the picked team goes to battle', async ({ browser }) => {
  test.setTimeout(180_000); // a full map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('jobs'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Busy Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');
  const mapId = (await mapState(page))!.id;

  // A second friend to make the trade-off real (the starter is the first).
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: 'mossmuffin',
    level: 4,
  });
  expect(granted.status).toBe(201);
  const helperId = (granted.body as { squishy: { id: string } }).squishy.id;

  // The job board, from My Heartpatch.
  await (await trayButton(page, 'jobs-open')).tap();
  const board = page.getByTestId('jobs');
  await expect(board).toBeVisible();
  await expect(board.getByTestId('jobs-row')).toHaveCount(2);
  const helper = board.locator(`[data-testid="jobs-row"][data-squishy="${helperId}"]`);
  // What it's good at, from data.
  await expect(helper).toContainText(/at gathering|fighter|guard/);

  // Off to gather on a home spot (the picker says whether the fire keeps it safe).
  await helper.getByRole('button', { name: /Gather/ }).tap();
  const picker = helper.getByTestId('jobs-picker');
  await expect(picker).toContainText(/firelight|fire tonight/);
  await picker.getByTestId('jobs-spot').first().tap();
  await expect.poll(async () => (await jobsState(page))?.board.jobs[helperId]).toBe('gatherer');
  await expect(helper).toContainText('Next in');
  // Live on the map: a 🧺 over the tile it works (a DOM badge from the map's projection).
  await expect.poll(async () => (await jobsState(page))?.badges, { timeout: 15_000 }).toBe(1);

  // Its work finishes (the dev short timer), and Collect puts it in the bag.
  expect((await api(page, 'POST', `/maps/${mapId}/dev/work/ready`)).status).toBe(200);
  await board.getByRole('button', { name: 'Close' }).tap();
  await (await trayButton(page, 'jobs-open')).tap();
  const collect = board.getByTestId('jobs-collect');
  await expect(collect).toBeVisible();
  await collect.tap();
  await expect(board.getByTestId('jobs-note')).toContainText('+');
  const bag = await api(page, 'GET', `/maps/${mapId}/inventory`);
  const items = (bag.body as { items: Record<string, number> }).items;
  expect(Object.values(items).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  expect(findAvoidedWords((await board.textContent()) ?? '')).toEqual([]);
  await board.getByRole('button', { name: 'Close' }).tap();

  // Pick a team: just the helper (it stops gathering to come along).
  await (await trayButton(page, 'team-open')).tap();
  const team = page.getByTestId('team');
  await expect(team).toBeVisible();
  const candidate = team.locator(`[data-testid="team-candidate"][data-squishy="${helperId}"]`);
  await expect(candidate).toContainText('Stops gathering');
  await candidate.tap();
  await team.getByTestId('team-save').tap();
  await expect.poll(async () => (await jobsState(page))?.team.saved).toEqual([helperId]);
  await expect(team.getByTestId('team-note')).toContainText('Team saved!');
  expect(findAvoidedWords((await team.textContent()) ?? '')).toEqual([]);
  await team.getByRole('button', { name: 'Close' }).tap();
  // It left its tile for the team, so its badge went too.
  await expect.poll(async () => (await jobsState(page))?.badges, { timeout: 15_000 }).toBe(0);

  // The next battle brings exactly the picked team.
  const fight = await api(page, 'POST', `/maps/${mapId}/dev/battles`, {
    opponent: { speciesId: 'puddlepuff', level: 2 },
  });
  expect(fight.status).toBe(201);
  const { battle } = fight.body as BattleBody;
  expect(battle.view.sides[battle.mySide]!.squishies.map((s) => s.id)).toEqual([helperId]);
  expect(errors).toEqual([]);
});
