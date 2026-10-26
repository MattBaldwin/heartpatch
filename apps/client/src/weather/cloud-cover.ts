// Which screen points a cloud hides (#621 W1-9g). The map's tile badges (the
// 🌙 over dark land) are DOM, drawn over the canvas, so the scene's depth
// can't put a cloud in front of them; instead each cloud's body is projected
// to a screen disc and a badge whose middle falls inside one is hidden while
// it is there. Pure; the projection lives in the weather layer.

/** Fixed screen discs, x, y, radius each (CSS pixels); `count` of them in use. */
export interface CloudDiscs {
  readonly discs: Float32Array;
  count: number;
}

export function createCloudDiscs(max: number): CloudDiscs {
  return { discs: new Float32Array(max * 3), count: 0 };
}

/** Whether the screen point (x, y) is under one of the clouds. */
export function underCloud(cover: CloudDiscs, x: number, y: number): boolean {
  for (let i = 0; i < cover.count; i++) {
    const o = i * 3;
    const dx = x - (cover.discs[o] ?? 0);
    const dy = y - (cover.discs[o + 1] ?? 0);
    const r = cover.discs[o + 2] ?? 0;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}
