/**
 * Makes a thing once and hands the same one back until it's dropped. The
 * Add to Home Screen card uses it so each lobby render re-appends the card
 * already on screen instead of building a new one under a finger (#423).
 */
export function keepOne<T>(make: (drop: () => void) => T): () => T {
  let current: { value: T } | null = null;
  const drop = () => {
    current = null;
  };
  return () => {
    current ??= { value: make(drop) };
    return current.value;
  };
}
