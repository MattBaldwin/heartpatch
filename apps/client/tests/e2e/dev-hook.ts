import { expect, type Page } from '@playwright/test';

/**
 * The getters on the dev-only `window.__heartpatch` hook (src/engine/dev-hook.d.ts).
 * The e2e tsconfig doesn't include `src`, so each spec declares the shape it reads.
 */
export type HookName =
  | 'renderer'
  | 'quality'
  | 'camera'
  | 'map'
  | 'trays'
  | 'recipeBook'
  | 'tutorial'
  | 'updatesHeld'
  | 'battle'
  | 'keeper'
  | 'cinematic'
  | 'inventory'
  | 'territory'
  | 'fences'
  | 'tileBuild'
  | 'roads'
  | 'stranded'
  | 'hollow'
  | 'raids'
  | 'home'
  | 'explore'
  | 'care'
  | 'closeUp'
  | 'house'
  | 'catalog'
  | 'wardrobe'
  | 'heartCoins'
  | 'starter'
  | 'lore'
  | 'milestones'
  | 'chat'
  | 'friendly'
  | 'audio'
  | 'jobs'
  | 'roster'
  | 'posts'
  | 'communities'
  | 'journey'
  | 'farHollowHouse'
  | 'trickOrTreat'
  | 'post'
  | 'whatsNew'
  | 'patchLine'
  | 'frameCap'
  | 'testScenes'
  | 'hitchesExpected';

type HookWindow = { __heartpatch?: Partial<Record<string, () => unknown>> };

/** What the hook's `name` getter returns, or null when the page has no hook or no getter. */
export function hook<T>(page: Page, name: HookName): Promise<T | null> {
  return page.evaluate(
    (n) => ((window as unknown as HookWindow).__heartpatch?.[n]?.() ?? null) as T | null,
    name,
  );
}

/**
 * How long the map gets to open and catch up live: on a slow WebKit runner
 * (software GL) the patch can still be building well after `data-ready`.
 */
export const LIVE_MAP_TIMEOUT = 60_000;

/**
 * Waits until the map is open and following the patch live (and is `mapId`,
 * if given). `#game[data-ready]` marks the engine, not the map: wait on this
 * before tapping, selecting or reading the map.
 */
export async function waitForLiveMap(page: Page, mapId?: string): Promise<void> {
  await expect
    .poll(() => hook<{ id: string; live: string | null }>(page, 'map'), {
      timeout: LIVE_MAP_TIMEOUT,
    })
    .toMatchObject(mapId === undefined ? { live: 'live' } : { id: mapId, live: 'live' });
}

/** Frames drawn so far (0 without the hook); stays put while the scene is idle. */
export function draws(page: Page): Promise<number> {
  return page.evaluate(
    () => ((window as unknown as HookWindow).__heartpatch?.['draws']?.() ?? 0) as number,
  );
}

/** True when the render loop's last iteration drew nothing (false without the hook). */
export function idle(page: Page): Promise<boolean> {
  return page.evaluate(
    () => ((window as unknown as HookWindow).__heartpatch?.['idle']?.() ?? false) as boolean,
  );
}

/** Asks the page to draw a few frames, as any untracked change would. */
export function invalidate(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as HookWindow).__heartpatch?.['invalidate']?.();
  });
}

export interface ApiResult<T = unknown> {
  status: number;
  /** The JSON body, null for an empty one (204), or the raw text if it isn't JSON. */
  body: T;
}

/**
 * Calls `/api/v1<path>` from the page, as the logged-in player (session
 * cookie and the CSRF header): the status and the JSON body.
 */
export function api<T = unknown>(
  page: Page,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          'x-requested-with': 'heartpatch',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let parsed: unknown = null;
      if (text !== '') {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text; // e.g. a proxy's HTML error page: the status check reports it
        }
      }
      return { status: res.status, body: parsed as T };
    },
    { method, path, body },
  );
}
