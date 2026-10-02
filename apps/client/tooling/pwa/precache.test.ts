import { describe, expect, it } from 'vitest';
import { buildPrecache, injectPrecache, isShellFile } from './precache.js';

const extras = new Set(['/manifest.webmanifest', '/pwa/icon-192.png']);

describe('isShellFile', () => {
  it.each([
    ['index.html', true],
    ['assets/index-abc.js', true],
    ['assets/index-abc.css', true],
    ['manifest.webmanifest', true],
    ['pwa/icon-192.png', true],
    ['assets/index-abc.js.map', false],
    ['sw.js', false],
    ['gallery.html', false],
    ['pwa/splash-1179x2556.png', false],
  ])('%s → %s', (fileName, expected) => {
    expect(isShellFile(fileName, extras)).toBe(expected);
  });
});

describe('buildPrecache', () => {
  const files = [
    { fileName: 'assets/b-2.js', content: 'b' },
    { fileName: 'index.html', content: '<html>' },
    { fileName: 'assets/b-2.js.map', content: '{}' },
    { fileName: 'manifest.webmanifest', content: new Uint8Array([1, 2]) },
    { fileName: 'assets/a-1.js', content: 'a' },
  ];

  it('lists the shell files as sorted absolute paths', () => {
    expect(buildPrecache(files, extras, 'sw').urls).toEqual([
      '/assets/a-1.js',
      '/assets/b-2.js',
      '/index.html',
      '/manifest.webmanifest',
    ]);
  });

  it('versions by content: same build, same version; any change, new version', () => {
    const { version } = buildPrecache(files, extras, 'sw');
    expect(version).toMatch(/^[0-9a-f]{12}$/);
    expect(buildPrecache([...files].reverse(), extras, 'sw').version).toBe(version);

    const changedHtml = files.map((f) =>
      f.fileName === 'index.html' ? { ...f, content: '<html lang="en">' } : f,
    );
    expect(buildPrecache(changedHtml, extras, 'sw').version).not.toBe(version);
    expect(buildPrecache(files, extras, 'sw v2').version).not.toBe(version);
    // Source maps aren't cached, so they don't change the version.
    const changedMap = files.map((f) => (f.fileName.endsWith('.map') ? { ...f, content: 'x' } : f));
    expect(buildPrecache(changedMap, extras, 'sw').version).toBe(version);
  });
});

describe('injectPrecache', () => {
  const precache = { version: 'abc123def456', urls: ['/index.html', '/assets/a.js'] };

  it('fills both placeholders, whatever quotes the minifier picked', () => {
    const code = `const v="__HP_SHELL_VERSION__",l=['__HP_PRECACHE__'];`;
    expect(injectPrecache(code, precache)).toBe(
      `const v="abc123def456",l=["/index.html","/assets/a.js"];`,
    );
  });

  it('fails loudly if a placeholder is missing', () => {
    expect(() => injectPrecache('const l=["__HP_PRECACHE__"];', precache)).toThrow(/placeholders/);
  });
});
