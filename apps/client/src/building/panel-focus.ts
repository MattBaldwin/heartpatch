// A step of building or fence care has the tile panel to itself (#371): the
// tile's title lines step aside, the panel may grow, and the side trays'
// handles hide so they don't sit on top of it. Features that take the panel
// over say so here; the trays follow while any of them has it.

const owners = new Set<string>();
let listener: ((focused: boolean) => void) | null = null;

/** Who to tell when the panel is taken over, or given back (the side trays). */
export function onPanelFocus(next: ((focused: boolean) => void) | null): void {
  listener = next;
}

/** `owner` takes the panel over (focused) or gives it back. */
export function setPanelFocus(container: HTMLElement, owner: string, focused: boolean): void {
  container.classList.toggle('tile-actions-focus', focused);
  container.parentElement?.classList.toggle('tile-panel-actions-focus', focused);
  container.closest('.tile-panel')?.classList.toggle('tile-panel-building', focused);
  const before = owners.size > 0;
  if (focused) owners.add(owner);
  else owners.delete(owner);
  const after = owners.size > 0;
  if (after !== before) listener?.(after);
}
