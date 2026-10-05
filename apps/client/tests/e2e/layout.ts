import { expect, type Page } from '@playwright/test';

// Text never touches a control's edge (style guide §3). These measure the
// words inside each visible control on the page as drawn, against the
// control's own box and the screen: a guard, not a pixel comparison.

/** Phones and tablets every tray and book layout must fit. */
export const SCREENS = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 15', width: 390, height: 844 },
  { name: 'iPhone Pro Max', width: 430, height: 932 },
  { name: 'iPad portrait', width: 820, height: 1180 },
  { name: 'iPad landscape', width: 1180, height: 820 },
] as const;

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
