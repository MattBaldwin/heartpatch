import { describe, expect, it } from 'vitest';
import {
  isServerPath,
  networkFirst,
  precachePath,
  shellVersion,
  withoutRedirect,
} from './shell-strategy.js';

describe('isServerPath', () => {
  it.each([
    ['/api', true],
    ['/api/v1/health', true],
    ['/ws', true],
    ['/ws/maps', true],
    ['/', false],
    ['/assets/index-abc.js', false],
    ['/apiary.png', false],
  ])('%s → %s', (path, expected) => {
    expect(isServerPath(path)).toBe(expected);
  });
});

describe('precachePath', () => {
  it('caches index.html as the page URL and everything else at its own path', () => {
    expect(precachePath({ url: 'index.html', revision: 'r1' })).toBe('/');
    expect(precachePath({ url: 'assets/index-abc.js', revision: null })).toBe(
      '/assets/index-abc.js',
    );
    expect(precachePath('/manifest.webmanifest')).toBe('/manifest.webmanifest');
  });
});

describe('shellVersion', () => {
  const entries = [
    { url: 'index.html', revision: 'aaa' },
    { url: 'assets/index-abc.js', revision: null },
  ];

  it('is 12 hex characters, the same for the same shell in any order', () => {
    const version = shellVersion(entries);
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(shellVersion([...entries].reverse())).toBe(version);
  });

  it('changes when any file changes', () => {
    const version = shellVersion(entries);
    expect(shellVersion([{ url: 'index.html', revision: 'bbb' }, entries[1]!])).not.toBe(version);
    expect(shellVersion([entries[0]!, { url: 'assets/index-def.js', revision: null }])).not.toBe(
      version,
    );
  });
});

describe('withoutRedirect', () => {
  it('copies a redirected response so a page load can use it', async () => {
    const redirected = new Response('<html>', { status: 200, headers: { 'x-a': '1' } });
    Object.defineProperty(redirected, 'redirected', { value: true });
    const clean = await withoutRedirect(redirected);
    expect(clean.redirected).toBe(false);
    expect(clean.headers.get('x-a')).toBe('1');
    expect(await clean.text()).toBe('<html>');
  });

  it('passes other responses through', async () => {
    const response = new Response('ok');
    expect(await withoutRedirect(response)).toBe(response);
  });
});

describe('networkFirst', () => {
  const shell = new Response('cached shell');
  const cached = () => Promise.resolve(shell);
  const never = new Promise<Response>(() => undefined);

  it('uses the network when it answers', async () => {
    const fresh = new Response('fresh');
    expect(await networkFirst(Promise.resolve(fresh), cached, 1000)).toBe(fresh);
  });

  it('falls back to the cached shell offline, on a server error, or when slow', async () => {
    expect(await networkFirst(Promise.reject(new Error('offline')), cached, 1000)).toBe(shell);
    expect(
      await networkFirst(Promise.resolve(new Response('', { status: 502 })), cached, 1000),
    ).toBe(shell);
    expect(await networkFirst(never, cached, 5)).toBe(shell);
  });

  it('lets the browser follow a page-load redirect', async () => {
    const redirect = new Response(null, { status: 200 });
    Object.defineProperty(redirect, 'ok', { value: false });
    Object.defineProperty(redirect, 'type', { value: 'opaqueredirect' });
    expect(await networkFirst(Promise.resolve(redirect), cached, 1000)).toBe(redirect);
  });

  it('returns the network answer when there is no cached shell', async () => {
    const error = new Response('', { status: 502 });
    const none = () => Promise.resolve(undefined);
    expect(await networkFirst(Promise.resolve(error), none, 1000)).toBe(error);
    expect((await networkFirst(Promise.reject(new Error('offline')), none, 1000)).type).toBe(
      'error',
    );
  });
});
