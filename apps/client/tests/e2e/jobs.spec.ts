import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/**
 * Squishy jobs on an iPhone (owner decisions 2026-10-04): send a squishy to
 * gather from the job board, let its work finish (the dev short timer) and
 * land in the bag by itself; then pick a team and see it fight in the next battle.
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
  badgeMoods: { loves: number; meh: number };
}

/** The part of `HomeDebug` (src/home/home-screen.ts) the mood test reads. */
interface HomeMoodDebug {
  open: boolean;
  scene: { happy: number; drooping: number; away: number } | null;
  moodCues: 'bounce' | 'static';
  moodLayout: { id: string; mood: 'loves' | 'meh' | null }[];
}

interface BattleBody {
  battle: { mySide: 'a' | 'b'; view: { sides: Record<string, { squishies: { id: string }[] }> } };
}

const jobsState = (page: Page) => hook<JobsDebug>(page, 'jobs');
const mapState = (page: Page) => hook<{ id: string; live: string | null }>(page, 'map');
const homeState = (page: Page) => hook<HomeMoodDebug>(page, 'home');

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

  // The job board, from My Home.
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

  // Its work finishes (the dev short timer) and goes straight into the bag
  // when the board opens again (owner decision 2026-10-06): no Collect.
  const total = async () => {
    const bag = await api(page, 'GET', `/maps/${mapId}/inventory`);
    const items = (bag.body as { items: Record<string, number> }).items;
    return Object.values(items).reduce((a, b) => a + b, 0);
  };
  const before = await total();
  expect((await api(page, 'POST', `/maps/${mapId}/dev/work/ready`)).status).toBe(200);
  await board.getByRole('button', { name: 'Close' }).tap();
  await (await trayButton(page, 'jobs-open')).tap();
  await expect(page.getByTestId('landed-toast')).toContainText('+');
  await expect.poll(total).toBeGreaterThan(before);
  await expect(board.getByRole('button', { name: /Collect/ })).toHaveCount(0);
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

interface CareBody {
  squishies: { id: string; contentment: number; moodDrift: string | null }[];
}

test('a gatherer on a spot it loves stays happy while a resting one drifts (#376)', async ({
  browser,
}) => {
  test.setTimeout(180_000); // a full map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('mood'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Happy Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');
  const mapId = (await mapState(page))!.id;

  const granted = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, {
    speciesId: 'mossmuffin',
    level: 4,
  });
  expect(granted.status).toBe(201);
  const helperId = (granted.body as { squishy: { id: string } }).squishy.id;

  // The picker marks the spots it loves and the ones that aren't its thing.
  await (await trayButton(page, 'jobs-open')).tap();
  const board = page.getByTestId('jobs');
  const helper = board.locator(`[data-testid="jobs-row"][data-squishy="${helperId}"]`);
  await helper.getByRole('button', { name: /Gather/ }).tap();
  const picker = helper.getByTestId('jobs-picker');
  const loved = picker.locator('.jobs-spot', { has: page.locator('.jobs-fit') }).first();
  await expect(loved.getByTestId('jobs-spot-fit')).toContainText('Loves gathering');
  expect(findAvoidedWords((await picker.textContent()) ?? '')).toEqual([]);
  await expect(loved.locator('.jobs-heart')).toHaveText('💕');
  await loved.getByTestId('jobs-spot').tap();
  await expect.poll(async () => (await jobsState(page))?.board.jobs[helperId]).toBe('gatherer');
  // Its row says so (the 2.6 s pop-up is left out: too short to wait on in CI).
  await expect(helper.getByTestId('jobs-mood')).toContainText('Loves this job');
  expect(findAvoidedWords((await helper.textContent()) ?? '')).toEqual([]);
  await board.getByRole('button', { name: 'Close' }).tap();

  const moods = async () => {
    const res = await api(page, 'GET', `/maps/${mapId}/care`);
    return new Map((res.body as CareBody).squishies.map((s) => [s.id, s]));
  };
  const before = await moods();
  const starterId = [...before.keys()].find((id) => id !== helperId)!;

  // An hour passes (the dev clock jump): the gatherer holds, the resting starter drifts.
  expect((await api(page, 'POST', `/maps/${mapId}/dev/mood/age`, { minutes: 60 })).status).toBe(
    200,
  );
  const after = await moods();
  expect(after.get(helperId)).toMatchObject({
    contentment: before.get(helperId)!.contentment,
    moodDrift: 'steady',
  });
  expect(after.get(starterId)!.contentment).toBeLessThan(before.get(starterId)!.contentment);
  expect(after.get(starterId)!.moodDrift).toBe('resting');
  expect(errors).toEqual([]);
});

test('my gatherers show how they feel on the map, and are away from home (#393, #604)', async ({
  browser,
}) => {
  test.setTimeout(180_000); // a full map build; CI renders in software
  const page = await newPlayer(browser, uniqueName('cue'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Moody Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect.poll(async () => (await mapState(page))?.live, { timeout: 30_000 }).toBe('live');
  const mapId = (await mapState(page))!.id;

  const grant = async () => {
    const res = await api(page, 'POST', `/maps/${mapId}/dev/squishies`, {
      speciesId: 'mossmuffin',
      level: 4,
    });
    expect(res.status).toBe(201);
    return (res.body as { squishy: { id: string } }).squishy.id;
  };
  const happyId = await grant();
  const glumId = await grant();
  // A team member stays home and loves its job (#393): home's own bubble.
  const teamId = await grant();
  expect(
    (await api(page, 'POST', `/maps/${mapId}/squishies/${teamId}/job`, { job: 'team' })).status,
  ).toBe(200);

  // One on a spot it loves, one on a spot that isn't its thing.
  await (await trayButton(page, 'jobs-open')).tap();
  const board = page.getByTestId('jobs');
  const sendTo = async (id: string, kind: 'loved' | 'meh') => {
    const row = board.locator(`[data-testid="jobs-row"][data-squishy="${id}"]`);
    await row.getByRole('button', { name: /Gather/ }).tap();
    await row
      .getByTestId('jobs-picker')
      .locator(`.jobs-spot-${kind}`)
      .first()
      .getByTestId('jobs-spot')
      .tap();
    await expect.poll(async () => (await jobsState(page))?.board.jobs[id]).toBe('gatherer');
  };
  await sendTo(happyId, 'loved');
  await sendTo(glumId, 'meh');
  await board.getByRole('button', { name: 'Close' }).tap();

  // On the map, my two 🧺 badges say how each gatherer feels.
  await expect
    .poll(async () => (await jobsState(page))?.badgeMoods, { timeout: 15_000 })
    .toEqual({ loves: 1, meh: 1 });
  const badges = page.locator('.gatherer-badge');
  await expect(badges.filter({ hasText: '💕' })).toHaveCount(1);
  await expect(badges.filter({ hasText: '🌧️' })).toHaveCount(1);

  // At home the gatherers are away (#604): out on their tiles, so home
  // draws neither them nor a bubble. The badges above say how they feel.
  // The team member is home, with its bubble (shown, or waiting hidden
  // behind a neighbour), and may bounce.
  await (await trayButton(page, 'home-open')).tap();
  await expect.poll(async () => (await homeState(page))?.scene?.away, { timeout: 30_000 }).toBe(2);
  await expect.poll(async () => (await homeState(page))?.scene?.happy, { timeout: 30_000 }).toBe(1);
  expect((await homeState(page))!.scene!.drooping).toBe(0);
  await expect
    .poll(async () => {
      const layout = (await homeState(page))?.moodLayout ?? [];
      return Object.fromEntries(layout.filter((l) => l.mood).map((l) => [l.id, l.mood]));
    })
    .toEqual({ [teamId]: 'loves' });
  await expect(page.getByTestId('home-mood-mark')).toHaveCount(1);

  // Reduce Motion: the bubble stays, the bounce doesn't.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await homeState(page))?.moodCues).toBe('static');
  await expect(page.getByTestId('home-mood-mark')).toHaveCount(1);
  expect(errors).toEqual([]);
});
