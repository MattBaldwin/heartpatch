import { expect, test } from '@playwright/test';

test('a device without WebGL still gets the login, with the renderer note on top', async ({
  page,
}) => {
  // No WebGL at all: every renderer fails to start.
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'getContext')?.value as (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) => unknown;
    Object.defineProperty(proto, 'getContext', {
      value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type.startsWith('webgl') || type === 'experimental-webgl' || type === 'webgpu') {
          return null;
        }
        return original.call(this, type, ...rest);
      },
    });
  });
  await page.goto('/');

  const note = page.locator('.renderer-error');
  await expect(note).toBeVisible();
  await expect(note).toContainText("the squishies can't come out to play");
  // The login is there too (mounted before the renderer tried to start)…
  const overlay = page.getByTestId('auth-overlay');
  await expect(overlay.getByRole('heading', { name: 'Welcome to Heartpatch!' })).toBeVisible();
  // …and the note is drawn above it, not hidden behind it.
  const box = (await note.boundingBox())!;
  const onTop = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('.renderer-error') !== null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(onTop).toBe(true);
});
