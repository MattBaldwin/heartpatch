import type { JobSquishy, JobsView, SetJobRequest, WorkSpot } from '@heartpatch/shared';
import { el } from '../../ui/dom.js';
import { canTrain, groundsLabel, JOBS_TEXT, nameOf, spotFit, spotLabel } from './jobs-view.js';

// A squishy's job actions (Team, Gather, Train, Rest) and the spot and
// Training Grounds pickers behind Gather and Train: the DOM the job board and
// the home Squishies roster (#375) both draw, so the two can't drift. The
// owner (board or roster) holds the state and the server calls; this file only
// builds buttons and calls back.

export interface JobActionsContext {
  readonly view: JobsView;
  /** A command is in flight: every button waits. */
  readonly working: boolean;
  /** A tile to offer first in the pickers (opened from the tile panel), or null. */
  readonly wantSpot: { q: number; r: number } | null;
  /** Sends the squishy's new job; `done` is the line to say when it lands. */
  assign: (squishy: JobSquishy, job: SetJobRequest, done: string) => void;
  /**
   * Gather at a spot (#376): the owner sends it and may cheer once it lands
   * (hearts for a spot it loves). Without one, it's a plain `assign`.
   */
  gather?: (squishy: JobSquishy, spot: WorkSpot, fits: boolean) => void;
  /** Gather was tapped: show the spot picker for this squishy. */
  pickSpot: (squishy: JobSquishy) => void;
  /** Train was tapped: show the Training Grounds picker for this squishy. */
  pickGrounds: (squishy: JobSquishy) => void;
  /** "Never mind" in a picker. */
  cancel: () => void;
}

/** A job button (Team, a spot, …), switched off while a command is in flight. */
export function jobButton(
  label: string,
  onTap: () => void,
  working: boolean,
  attrs: Record<string, string> = {},
): HTMLButtonElement {
  const b = el(
    'button',
    { type: 'button', class: 'hp-button hp-button-primary jobs-action', ...attrs },
    label,
  );
  b.disabled = working;
  b.addEventListener('click', onTap);
  return b;
}

/** Its Team / Gather / Train / Rest buttons, with the ones that don't fit switched off. */
export function jobActions(s: JobSquishy, ctx: JobActionsContext): HTMLElement {
  const name = nameOf(ctx.view, s);
  const button = (label: string, onTap: () => void, attrs: Record<string, string>) =>
    jobButton(label, onTap, ctx.working, attrs);
  const actions = el(
    'div',
    { class: 'jobs-actions' },
    button(
      `⚔️ ${JOBS_TEXT.team}`,
      () => {
        ctx.assign(s, { job: 'team' }, `${name} joined the team!`);
      },
      { 'data-job': 'team' },
    ),
    button(
      `🧺 ${JOBS_TEXT.gather}`,
      () => {
        ctx.pickSpot(s);
      },
      { 'data-job': 'gatherer' },
    ),
    // Owner decision 2026-10-06: practice at the Training Grounds, one a
    // homestead (#277): pick which, seeing whether it's lit at night.
    button(
      `🎯 ${JOBS_TEXT.train}`,
      () => {
        ctx.pickGrounds(s);
      },
      { 'data-job': 'training' },
    ),
    button(
      `💤 ${JOBS_TEXT.rest}`,
      () => {
        ctx.assign(s, { job: 'resting' }, `${name} is having a rest.`);
      },
      { 'data-job': 'resting' },
    ),
  );
  // Train needs Training Grounds with room (the server checks again); a
  // trainee may move to other Training Grounds.
  const away = s.squishy.state !== 'active';
  const trainable = canTrain(ctx.view);
  for (const b of actions.querySelectorAll('button')) {
    const job = b.getAttribute('data-job');
    const again = job !== 'gatherer' && job !== 'training' && job === s.job;
    if (away || again) b.disabled = true;
    if (job === 'training' && !trainable) b.disabled = true;
  }
  return actions;
}

/**
 * The spots this squishy could go and gather, the ones it loves first (#376),
 * each with how it feels about it and the firelight warning.
 */
export function spotPicker(squishy: JobSquishy, ctx: JobActionsContext): HTMLElement {
  const current = ctx.view;
  const name = nameOf(current, squishy);
  const want = ctx.wantSpot;
  const spots = [...current.spots]
    .filter((s) => s.inSeason)
    .sort((a, b) => {
      const first = (s: { q: number; r: number }) =>
        want && s.q === want.q && s.r === want.r ? 0 : 1;
      // Then the spots it loves (#376); the sort keeps the server's order otherwise.
      const fit = (s: WorkSpot) => (spotFit(squishy, s).fits ? 0 : 1);
      return first(a) - first(b) || fit(a) - fit(b);
    });
  const rows = spots.map((spot) => {
    const worker = current.squishies.find((s) => s.squishy.id === spot.workerId);
    const fit = spotFit(squishy, spot);
    const go = jobButton(
      spotLabel(spot),
      () => {
        if (ctx.gather) ctx.gather(squishy, spot, fit.fits);
        else {
          ctx.assign(
            squishy,
            { job: 'gatherer', q: spot.q, r: spot.r },
            fit.fits ? JOBS_TEXT.lovesIt(name) : JOBS_TEXT.notKeen(name),
          );
        }
      },
      ctx.working,
      { 'data-testid': 'jobs-spot', 'data-q': String(spot.q), 'data-r': String(spot.r) },
    );
    if (worker && worker.squishy.id !== squishy.squishy.id) go.disabled = true;
    go.append(
      el(
        'span',
        { class: fit.fits ? 'jobs-heart' : 'jobs-heart jobs-cloud', 'aria-hidden': 'true' },
        fit.fits ? '💕' : '🌧️',
      ),
    );
    return el(
      'li',
      { class: `jobs-spot ${fit.fits ? 'jobs-spot-loved' : 'jobs-spot-meh'}` },
      go,
      el(
        'p',
        { class: fit.fits ? 'jobs-fit' : 'jobs-no-fit', 'data-testid': 'jobs-spot-fit' },
        fit.line,
      ),
      el(
        'p',
        { class: spot.firelit ? 'jobs-safe' : 'jobs-dark' },
        spot.firelit ? JOBS_TEXT.firelit : JOBS_TEXT.dark,
      ),
      ...(worker
        ? [el('p', { class: 'jobs-small' }, JOBS_TEXT.takenBy(nameOf(current, worker)))]
        : []),
    );
  });
  return el(
    'div',
    { class: 'jobs-picker', 'data-testid': 'jobs-picker' },
    el('p', { class: 'jobs-small' }, JOBS_TEXT.pickSpot),
    ...(rows.length > 0
      ? [el('ul', { class: 'jobs-spots' }, ...rows)]
      : [el('p', {}, JOBS_TEXT.noSpots)]),
    jobButton(JOBS_TEXT.cancel, ctx.cancel, ctx.working),
  );
}

/**
 * The Training Grounds this squishy could practice at (#277), with the
 * firelight warning before it goes: a trainee sleeps on its homestead.
 */
export function groundsPicker(squishy: JobSquishy, ctx: JobActionsContext): HTMLElement {
  const current = ctx.view;
  const name = nameOf(current, squishy);
  const want = ctx.wantSpot;
  const first = (g: { q: number; r: number }) => (want && g.q === want.q && g.r === want.r ? 0 : 1);
  const rows = [...current.trainingGrounds]
    .sort((a, b) => first(a) - first(b))
    .map((g) => {
      const go = jobButton(
        groundsLabel(current, g.id),
        () => {
          ctx.assign(squishy, { job: 'training', buildingId: g.id }, JOBS_TEXT.offToTrain(name));
        },
        ctx.working,
        { 'data-testid': 'jobs-grounds', 'data-q': String(g.q), 'data-r': String(g.r) },
      );
      const here = squishy.training?.buildingId === g.id;
      if (here || g.napping || g.used >= g.capacity) go.disabled = true;
      return el(
        'li',
        { class: 'jobs-spot' },
        go,
        g.napping
          ? el('p', { class: 'jobs-dark' }, JOBS_TEXT.groundsNapping)
          : el(
              'p',
              { class: g.firelit ? 'jobs-safe' : 'jobs-dark' },
              g.firelit ? JOBS_TEXT.groundsLit : JOBS_TEXT.groundsDark,
            ),
      );
    });
  return el(
    'div',
    { class: 'jobs-picker', 'data-testid': 'jobs-grounds-picker' },
    el('p', { class: 'jobs-small' }, JOBS_TEXT.pickGrounds),
    el('ul', { class: 'jobs-spots' }, ...rows),
    jobButton(JOBS_TEXT.cancel, ctx.cancel, ctx.working),
  );
}
