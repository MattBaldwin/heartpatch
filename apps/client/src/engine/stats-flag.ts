/**
 * Whether to show the stats badge (fps, renderer, tier, draws): always in a
 * dev build, and in a production build only with `?fps=1` in the address, so
 * the owner can read a real device's frame rate on the live site (#335).
 */
export function showsStats(dev: boolean, params: URLSearchParams): boolean {
  return dev || params.get('fps') === '1';
}
