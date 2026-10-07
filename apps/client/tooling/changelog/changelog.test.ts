import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChangelogSchema } from '@heartpatch/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { changelogJson, parseEntry, readChangelog, runGit } from './changelog.js';

const entry = (title: string, area = 'battles', extra = '') =>
  `---\ntitle: ${title}\narea: ${area}   # battles | land | ...\n---\nSomething changed.\n${extra}`;

describe('parseEntry (#220)', () => {
  it('reads the title, area, words and the Try it line', () => {
    expect(
      parseEntry(
        entry('Wild squishies wander off', 'battles', '**Try it:** lose a battle.\n'),
        'changes/208-x.md',
      ),
    ).toEqual({
      slug: '208-x',
      title: 'Wild squishies wander off',
      area: 'battles',
      body: 'Something changed.',
      tryIt: 'lose a battle.',
    });
  });

  it('fails with a clear message naming the file and the field', () => {
    expect(() => parseEntry('no front matter', 'changes/a.md')).toThrow(
      /changes\/a\.md: needs front matter/,
    );
    expect(() => parseEntry('---\narea: land\n---\nWords.', 'changes/b.md')).toThrow(
      /b\.md: front matter needs a title/,
    );
    expect(() => parseEntry(entry('Hi', 'castles'), 'changes/c.md')).toThrow(
      /c\.md: area must be one of battles/,
    );
    expect(() => parseEntry('---\ntitle: Hi\narea: land\n---\n', 'changes/d.md')).toThrow(
      /d\.md: needs a line/,
    );
  });
});

describe('readChangelog (#220)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hp-changelog-'));
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-10-07T23:30:00-07:00',
        GIT_COMMITTER_DATE: '2026-10-07T23:30:00-07:00',
      },
    });
  const commit = (file: string, text: string) => {
    writeFileSync(join(repo, file), text);
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', file);
  };

  it('numbers each entry by the commit that added it, newest first, with its UTC date', () => {
    git('init', '-q');
    mkdirSync(join(repo, 'changes'));
    commit('README', 'one'); // build 1
    commit('changes/first.md', entry('First')); // build 2
    commit('README', 'three'); // build 3
    commit('changes/second.md', entry('Second', 'land')); // build 4
    // Editing an entry later keeps the build it was added at.
    commit('changes/first.md', entry('First, edited'));
    const entries = readChangelog(join(repo, 'changes'), repo, runGit);
    expect(entries.map((e) => [e.slug, e.build, e.date, e.title])).toEqual([
      ['second', 4, '2026-10-08', 'Second'],
      ['first', 2, '2026-10-08', 'First, edited'],
    ]);
    // What the client reads.
    expect(ChangelogSchema.parse(JSON.parse(changelogJson(entries))).entries).toHaveLength(2);
  });

  it('without git, entries have no build ("Coming next")', () => {
    const entries = readChangelog(join(repo, 'changes'), repo, () => null);
    expect(entries.map((e) => [e.build, e.date])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('is empty with no changes folder', () => {
    expect(readChangelog(join(repo, 'nowhere'), repo, runGit)).toEqual([]);
  });
});
