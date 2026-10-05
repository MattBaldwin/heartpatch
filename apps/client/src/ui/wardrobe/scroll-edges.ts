/*
 * Which way a row of chips can still scroll (#152): the wardrobe's tab,
 * filter and outfit rows scroll sideways on a phone, and a row that's cut off
 * at the edge should look cut off (a fade), not finished. Pure, so it's
 * unit-tested; the screen puts the answer on the row as `data-scroll-more`
 * and the stylesheet fades that edge.
 */

export interface ScrollEdges {
  /** More to see on the left (scrolled right already). */
  readonly left: boolean;
  /** More to see on the right. */
  readonly right: boolean;
}

/** Rounding slack: browsers report fractional scroll sizes. */
const SLACK = 1;

export function scrollEdges(
  row: Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>,
): ScrollEdges {
  const overflow = row.scrollWidth - row.clientWidth;
  if (overflow <= SLACK) return { left: false, right: false };
  return {
    left: row.scrollLeft > SLACK,
    right: row.scrollLeft < overflow - SLACK,
  };
}

/** The `data-scroll-more` value for a row: "left", "right", "left right" or none (null). */
export function scrollMore(edges: ScrollEdges): string | null {
  const sides = [...(edges.left ? ['left'] : []), ...(edges.right ? ['right'] : [])];
  return sides.length === 0 ? null : sides.join(' ');
}

/**
 * Keeps `data-scroll-more` on a row up to date: on scroll, when its content
 * changes (`refresh`, after a render) and when the window resizes, until
 * `dispose` (the wardrobe lives as long as the page, but a reuse may not).
 */
export function watchScrollEdges(row: HTMLElement): {
  refresh: () => void;
  dispose: () => void;
} {
  const refresh = () => {
    const more = scrollMore(scrollEdges(row));
    if (more === null) row.removeAttribute('data-scroll-more');
    else if (row.getAttribute('data-scroll-more') !== more)
      row.setAttribute('data-scroll-more', more);
  };
  const controller = new AbortController();
  const { signal } = controller;
  row.addEventListener('scroll', refresh, { passive: true, signal });
  window.addEventListener('resize', refresh, { signal });
  return {
    refresh,
    dispose: () => {
      controller.abort();
    },
  };
}
