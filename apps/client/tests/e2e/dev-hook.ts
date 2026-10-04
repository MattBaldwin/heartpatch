import type { Page } from '@playwright/test';

/**
 * The getters on the dev-only `window.__heartpatch` hook (src/engine/dev-hook.d.ts).
 * The e2e tsconfig doesn't include `src`, so each spec declares the shape it reads.
 */
export type HookName =
  | 'renderer'
  | 'quality'
  | 'camera'
  | 'map'
  | 'tutorial'
  | 'updatesHeld'
  | 'battle'
  | 'keeper'
  | 'cinematic'
  | 'inventory'
  | 'territory'
  | 'hollow'
  | 'raids'
  | 'home'
  | 'care'
  | 'closeUp'
  | 'catalog'
  | 'wardrobe'
  | 'starter'
  | 'lore'
  | 'milestones'
  | 'chat'
  | 'audio';

type HookWindow = { __heartpatch?: Partial<Record<string, () => unknown>> };

/** What the hook's `name` getter returns, or null when the page has no hook or no getter. */
export function hook<T>(page: Page, name: HookName): Promise<T | null> {
  return page.evaluate(
    (n) => ((window as unknown as HookWindow).__heartpatch?.[n]?.() ?? null) as T | null,
    name,
  );
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
  /** The JSON body, or null for an empty one (204). */
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
      return { status: res.status, body: (text === '' ? null : JSON.parse(text)) as T };
    },
    { method, path, body },
  );
}
