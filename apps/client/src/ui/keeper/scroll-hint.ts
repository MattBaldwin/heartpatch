// Scroll hints for the Keeper picker's rows (#130): a scroller that has more
// to show fades out on that side, so a player can see there's more to swipe
// to. Measured from the element, so it follows a resize or a new row.

/** Which ends of a scroller have more content past them. */
export interface ScrollMore {
  readonly start: boolean;
  readonly end: boolean;
}

/** Less than this past an edge (px) counts as at the edge: subpixel layout rounds. */
const SLACK = 2;

/** Where a scroller has more to show, from its scroll offset and sizes (px). */
export function scrollMore(offset: number, viewport: number, content: number): ScrollMore {
  return {
    start: offset > SLACK,
    end: offset + viewport < content - SLACK,
  };
}

/** The `data-more` value CSS fades by: `start`, `end`, `both` or `none`. */
export function moreAttr({ start, end }: ScrollMore): string {
  if (start && end) return 'both';
  if (start) return 'start';
  return end ? 'end' : 'none';
}

/**
 * Keeps `data-more` on each scroller up to date while `signal` lives:
 * horizontal ones by `scrollLeft`, vertical ones by `scrollTop`.
 */
export function watchScrollHints(
  scrollers: readonly { node: HTMLElement; axis: 'x' | 'y' }[],
  signal: AbortSignal,
): () => void {
  const update = (): void => {
    for (const { node, axis } of scrollers) {
      const more =
        axis === 'x'
          ? scrollMore(node.scrollLeft, node.clientWidth, node.scrollWidth)
          : scrollMore(node.scrollTop, node.clientHeight, node.scrollHeight);
      node.dataset['more'] = moreAttr(more);
    }
  };
  for (const { node } of scrollers) {
    node.addEventListener('scroll', update, { passive: true, signal });
  }
  window.addEventListener('resize', update, { signal });
  update();
  return update;
}
