import { expect, type Page } from '@playwright/test';

// Text never touches a control's edge (style guide §3). These measure the
// words inside each visible control on the page as drawn, against the
// control's own box and the screen: a guard, not a pixel comparison.

/** Phones and tablets every tray and book layout must fit. */
export const SCREENS = [
  { name: 'smallest phone', width: 320, height: 568 },
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 15', width: 390, height: 844 },
  { name: 'iPhone Pro Max', width: 430, height: 932 },
  { name: 'iPad portrait', width: 820, height: 1180 },
  { name: 'iPad landscape', width: 1180, height: 820 },
] as const;

/**
 * Waits until nothing is sliding, turning or fading (every finite CSS
 * animation and transition has finished): a page turn's rotateY or a tray
 * mid-slide squeezes what's measured. Endless ones (a handle's glow) don't count.
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity,
        ) &&
      // A tray says so itself while it slides (`hp-settling`, cleared on
      // transitionend or its fallback), and an open one rests at its own
      // place: WebKit in CI has reported no running animation with the
      // slide still a few pixels short.
      document.querySelector('.hp-settling') === null &&
      [...document.querySelectorAll<HTMLElement>('.tray.tray-shown')].every(
        (tray) => getComputedStyle(tray).transform === 'none',
      ),
    undefined,
    { timeout: 15_000 },
  );
}

/**
 * Waits until everything matching `selector` has sat in the same place for
 * three animation frames running, with no finite animation or transition in
 * flight. settled() alone isn't enough in CI's WebKit: it has measured an
 * open tray a few pixels short of its slide, and a fresh page turn at its
 * first keyframe, after document.getAnimations() reported nothing running.
 * The boxes themselves can't lie: a slide or turn in progress moves them
 * between frames, and one that hasn't started yet starts at the next frame.
 * An element with an endless animation of its own (the tutorial's bobbing
 * arrow) is left out of the comparison.
 */
export async function still(page: Page, selector: string): Promise<void> {
  await page.evaluate(async (selector) => {
    const frame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    const endless = (a: Animation) => a.effect?.getComputedTiming().iterations === Infinity;
    const boxes = () =>
      JSON.stringify(
        [...document.querySelectorAll(selector)]
          .filter((el) => !el.getAnimations().some(endless))
          .map((el) => {
            const b = el.getBoundingClientRect();
            return [b.left, b.top, b.right, b.bottom];
          }),
      );
    const moving = () =>
      document.getAnimations().some((a) => a.playState === 'running' && !endless(a));
    const deadline = performance.now() + 15_000;
    let last = boxes();
    let held = 0;
    while (performance.now() < deadline) {
      await frame();
      const now = boxes();
      held = now === last && !moving() ? held + 1 : 0;
      last = now;
      if (held >= 3) return;
    }
    throw new Error(`still moving after 15s: ${selector}`);
  }, selector);
}

/**
 * Every visible control matching `selector` keeps its text at least `min`
 * px inside its own box on every side, and sits fully on screen. Badges
 * (`ignore`) may sit on an edge on purpose.
 */
export async function expectRoomyLabels(
  page: Page,
  selector: string,
  { min = 8, ignore = '.tray-badge, [data-tray-alert], .rbook-sticker' } = {},
): Promise<void> {
  await settled(page);
  await still(page, selector);
  const problems = await page.evaluate(
    ({ selector, min, ignore }) => {
      const out: string[] = [];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let checked = 0;
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        if (el.closest('[hidden]') || el.closest('[inert]')) continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;
        // A control in a scrolling page (a long recipe) is measured where it rests.
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        checked += 1;
        const name = `${el.dataset['testid'] ?? el.className} "${el.textContent.trim().slice(0, 24)}"`;
        if (box.left < -0.5 || box.top < -0.5 || box.right > vw + 0.5 || box.bottom > vh + 0.5) {
          out.push(
            `${name} is off screen (${String(Math.round(box.left))}..${String(Math.round(box.right))} of ${String(vw)})`,
          );
        }
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let text: { l: number; r: number; t: number; b: number } | null = null;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent?.trim() || n.parentElement?.closest(ignore)) continue;
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) {
            if (r.width === 0) continue;
            text = text
              ? {
                  l: Math.min(text.l, r.left),
                  r: Math.max(text.r, r.right),
                  t: Math.min(text.t, r.top),
                  b: Math.max(text.b, r.bottom),
                }
              : { l: r.left, r: r.right, t: r.top, b: r.bottom };
          }
        }
        if (!text) continue;
        const gaps = {
          left: text.l - box.left,
          right: box.right - text.r,
          top: text.t - box.top,
          bottom: box.bottom - text.b,
        };
        for (const [side, gap] of Object.entries(gaps)) {
          if (gap < min - 0.5)
            out.push(`${name}: text ${String(Math.round(gap))}px from the ${side} edge`);
        }
      }
      return { out, checked };
    },
    { selector, min, ignore },
  );
  expect(problems.checked, `nothing on screen matched ${selector}`).toBeGreaterThan(0);
  expect(problems.out).toEqual([]);
}

/**
 * Sprout never covers what it's pointing at (owner, 2026-10-05): the
 * visible element matching `bubble` shares no area with any visible
 * element matching `targets`.
 */
export async function expectClear(page: Page, bubble: string, targets: string): Promise<void> {
  await settled(page);
  await still(page, `${bubble}, ${targets}`);
  const result = await page.evaluate(
    ({ bubble, targets }) => {
      const shown = (el: Element) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      };
      const b = [...document.querySelectorAll(bubble)].find(shown);
      if (!b) return { found: false, hits: [] as string[], targets: 0 };
      const a = b.getBoundingClientRect();
      const hits: string[] = [];
      const list = [...document.querySelectorAll(targets)].filter(shown);
      for (const t of list) {
        const r = t.getBoundingClientRect();
        const overlap =
          a.left < r.right && r.left < a.right && a.top < r.bottom && r.top < a.bottom;
        if (overlap) {
          hits.push(
            `${(t as HTMLElement).dataset['testid'] ?? t.className} ${JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round))} under ${JSON.stringify([a.left, a.top, a.right, a.bottom].map(Math.round))}`,
          );
        }
      }
      return { found: true, hits, targets: list.length };
    },
    { bubble, targets },
  );
  expect(result.found, `nothing on screen matched ${bubble}`).toBe(true);
  expect(result.targets, `nothing on screen matched ${targets}`).toBeGreaterThan(0);
  expect(result.hits).toEqual([]);
}
