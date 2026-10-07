import {
  APP_MAJOR,
  ChangelogSchema,
  formatAppVersion,
  type BuildInfo,
  type ChangeAreaId,
  type ChangeEntryView,
} from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import {
  createSeenStore,
  groupByBuild,
  groupLabel,
  isNewSince,
  popUpPlan,
  type SeenStore,
} from './whats-new-model.js';
import './whats-new.css';

// "What's new" (#220): every change since the version a tester last saw, with
// what to try. Tapping the version line opens it (owner decision 2026-10-07);
// after an update it pops up once, never over a battle, the tutorial or a
// held screen (#47): it waits for the map. `changelog.json` is fetched only
// when it's needed.

export const WHATS_NEW_TEXT = {
  title: 'What’s new',
  popTitle: 'What’s new!',
  popSub: 'Here’s everything since you last looked.',
  youreOn: (version: string) => `You’re on ${version}`,
  copy: 'Copy',
  copied: 'Copied!',
  notCopied: 'Couldn’t copy',
  newSince: 'New since you last looked',
  seenBefore: 'You’ve seen these',
  tryIt: 'Try it:',
  emptyTitle: 'Nothing new yet!',
  emptyLine: 'New things show up here after an update.',
  loading: 'One moment…',
  failed: 'Couldn’t load what’s new. Try again in a bit!',
  done: 'Yay!',
  close: 'Close',
} as const;

const AREA_ICONS: Readonly<Record<ChangeAreaId, string>> = {
  battles: '⚔️',
  land: '🗺️',
  home: '🏡',
  squishies: '💗',
  account: '👤',
  other: '✨',
};
const AREA_NAMES: Readonly<Record<ChangeAreaId, string>> = {
  battles: 'Battles',
  land: 'Land',
  home: 'Home',
  squishies: 'Squishies',
  account: 'Account',
  other: 'Other',
};

/** TUNE: how often a pop-up that found the screen busy tries again. */
const BUSY_RETRY_MS = 3_000;
/** TUNE: how long the Copy chip says "Copied!". */
const COPIED_MS = 1_500;

export interface WhatsNewOptions {
  root: HTMLElement;
  /** This app's build (`CLIENT_BUILD`); null for a dev build without git. */
  client: BuildInfo | null;
  /** Something owns the screen (a battle, the tutorial, a held screen): the pop-up waits. */
  busy: () => boolean;
  copy: (text: string) => Promise<void>;
  fetchChangelog?: () => Promise<unknown>;
  seen?: SeenStore;
  setTimer?: (task: () => void, ms: number) => unknown;
}

export interface WhatsNewDebug {
  readonly open: boolean;
  /** Why it opened: the version line, or by itself after an update. */
  readonly mode: 'menu' | 'update' | null;
  readonly entries: number;
}

export interface WhatsNew {
  /** The version line was tapped. */
  open: () => void;
  /** The map is on screen: pop up once if this build is newer than the last one seen. */
  maybePop: () => void;
  readonly debug: WhatsNewDebug;
}

export function createWhatsNew(options: WhatsNewOptions): WhatsNew {
  const fetchChangelog =
    options.fetchChangelog ??
    (async () => {
      const res = await fetch('/changelog.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`changelog ${String(res.status)}`);
      return (await res.json()) as unknown;
    });
  const seen = options.seen ?? createSeenStore(() => window.localStorage);
  const setTimer = options.setTimer ?? ((task, ms) => setTimeout(task, ms));
  const version = formatAppVersion(options.client);

  let mode: WhatsNewDebug['mode'] = null;
  let shown = 0;
  let poppedThisRun = false;
  let retrying = false;
  let entries: ChangeEntryView[] | null = null;

  const title = el('h2', { class: 'whats-new-title', id: 'whats-new-title' });
  const sub = el('p', { class: 'whats-new-sub' });
  const copyChip = el('button', { type: 'button', class: 'whats-new-copy' }, WHATS_NEW_TEXT.copy);
  const closeX = el(
    'button',
    { type: 'button', class: 'whats-new-x', 'aria-label': WHATS_NEW_TEXT.close },
    '×',
  );
  const list = el('div', { class: 'whats-new-list', 'data-testid': 'whats-new-list' });
  const done = el(
    'button',
    { type: 'button', class: 'auth-button whats-new-done' },
    WHATS_NEW_TEXT.done,
  );
  const card = el(
    'section',
    {
      class: 'whats-new',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'whats-new-title',
      'data-testid': 'whats-new',
    },
    el('header', { class: 'whats-new-head' }, el('div', {}, title, sub), closeX),
    list,
    done,
  );
  card.hidden = true;
  options.root.append(card);

  let copiedTimer: unknown;
  copyChip.addEventListener('click', () => {
    options.copy(version).then(
      () => {
        copyChip.textContent = WHATS_NEW_TEXT.copied;
      },
      () => {
        copyChip.textContent = WHATS_NEW_TEXT.notCopied;
      },
    );
    if (copiedTimer === undefined) {
      copiedTimer = setTimer(() => {
        copiedTimer = undefined;
        copyChip.textContent = WHATS_NEW_TEXT.copy;
      }, COPIED_MS);
    }
  });

  const close = () => {
    card.hidden = true;
    mode = null;
    shown += 1;
    // Everything up to this build has been seen now.
    if (options.client) seen.write(options.client.number);
  };
  closeX.addEventListener('click', close);
  done.addEventListener('click', close);

  const entryCard = (e: ChangeEntryView) =>
    el(
      'article',
      { class: 'whats-new-entry', 'data-entry': e.slug },
      el('p', { class: 'whats-new-area' }, `${AREA_ICONS[e.area]} ${AREA_NAMES[e.area]}`),
      el('h4', {}, e.title),
      el('p', {}, e.body),
      ...(e.tryIt
        ? [el('p', { class: 'whats-new-try' }, el('b', {}, WHATS_NEW_TEXT.tryIt), ` ${e.tryIt}`)]
        : []),
    );
  const divider = (text: string, seenBefore = false) =>
    el(
      'p',
      {
        class: `whats-new-divider${seenBefore ? ' whats-new-divider-seen' : ''}`,
        role: 'separator',
      },
      el('span', {}, text),
    );

  function render(since: number | null): void {
    if (entries === null) return;
    const groups = groupByBuild(entries);
    if (groups.length === 0) {
      list.replaceChildren(
        el(
          'div',
          { class: 'whats-new-empty', 'data-testid': 'whats-new-empty' },
          el('p', { class: 'whats-new-empty-icon', 'aria-hidden': 'true' }, '🌱'),
          el('h4', {}, WHATS_NEW_TEXT.emptyTitle),
          el('p', {}, WHATS_NEW_TEXT.emptyLine),
        ),
      );
      return;
    }
    const nodes: Node[] = [];
    let wasNew: boolean | null = null;
    for (const group of groups) {
      const isNew = mode === 'update' && isNewSince(group, since);
      if (mode === 'update' && isNew !== wasNew) {
        nodes.push(divider(isNew ? WHATS_NEW_TEXT.newSince : WHATS_NEW_TEXT.seenBefore, !isNew));
      }
      wasNew = isNew;
      nodes.push(
        el(
          'section',
          { class: 'whats-new-version', 'data-build': String(group.build ?? 'next') },
          el('h3', {}, groupLabel(group, APP_MAJOR)),
          ...group.entries.map(entryCard),
        ),
      );
    }
    list.replaceChildren(...nodes);
  }

  async function show(how: 'menu' | 'update', since: number | null): Promise<void> {
    const at = (shown += 1);
    mode = how;
    title.textContent = how === 'update' ? WHATS_NEW_TEXT.popTitle : WHATS_NEW_TEXT.title;
    sub.replaceChildren(
      how === 'update' ? WHATS_NEW_TEXT.popSub : WHATS_NEW_TEXT.youreOn(version),
      ...(how === 'menu' ? [' ', copyChip] : []),
    );
    card.hidden = false;
    list.scrollTop = 0;
    if (entries === null) {
      list.replaceChildren(el('p', { class: 'whats-new-note' }, WHATS_NEW_TEXT.loading));
      try {
        entries = ChangelogSchema.parse(await fetchChangelog()).entries;
      } catch {
        if (at === shown)
          list.replaceChildren(el('p', { class: 'whats-new-note' }, WHATS_NEW_TEXT.failed));
        return;
      }
    }
    if (at === shown) render(since);
  }

  const tryPop = () => {
    if (poppedThisRun) return;
    const plan = popUpPlan(options.client?.number ?? null, seen.read());
    if (plan.remember !== null) seen.write(plan.remember);
    if (!plan.pop) return;
    if (options.busy() || !card.hidden) {
      if (!retrying) {
        retrying = true;
        setTimer(() => {
          retrying = false;
          tryPop();
        }, BUSY_RETRY_MS);
      }
      return;
    }
    poppedThisRun = true;
    void show('update', plan.since);
  };

  return {
    open: () => void show('menu', seen.read()),
    maybePop: tryPop,
    get debug() {
      return { open: !card.hidden, mode, entries: entries?.length ?? 0 };
    },
  };
}
