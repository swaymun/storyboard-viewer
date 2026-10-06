import { describe, expect, it } from 'vitest';
import { mergeRecents, sharedToEntry, timeAgo, type RecentEntry } from './cache';

const local = (id: string, openedAt: number, path?: string): RecentEntry => ({
  id,
  kind: id.startsWith('server:') ? 'server' : 'zip',
  title: id,
  name: id,
  location: '',
  openedAt,
  ...(path ? { path } : {}),
});

describe('recent storyboards', () => {
  it('turns a shared entry into a start-screen entry', () => {
    const e = sharedToEntry({
      path: '/Users/me/Story/cat.sbd',
      title: 'Cat',
      kind: 'folder',
      openedAt: 5,
      thumbnail: 'data:image/webp;base64,AA',
    });
    expect(e).toMatchObject({
      id: 'served:/Users/me/Story/cat.sbd',
      kind: 'served',
      name: 'cat.sbd',
      location: 'Folder · cat.sbd',
      thumbUrl: 'data:image/webp;base64,AA',
    });
    expect(
      sharedToEntry({ path: 'C:\\s\\x.sbd', title: '', kind: 'packed', openedAt: 1 }),
    ).toMatchObject({ title: 'x.sbd', location: '.sbd file · x.sbd' });
  });

  it('merges shared and browser entries: newest first, one per path, at most five', () => {
    const merged = mergeRecents(
      [
        local('server:http://localhost:4401/', 900, '/a.sbd'), // same storyboard as shared /a
        local('zip:drop.sbd', 800),
        local('server:http://localhost:4409/', 50, '/z.sbd'), // only this browser knows it
      ],
      [
        { path: '/a.sbd', title: 'A', kind: 'folder', openedAt: 100 },
        { path: '/b.sbd', title: 'B', kind: 'folder', openedAt: 700 },
        { path: '/c.sbd', title: 'C', kind: 'packed', openedAt: 600 },
        { path: '/d.sbd', title: 'D', kind: 'folder', openedAt: 500 },
      ],
    );
    expect(merged.map((e) => e.id)).toEqual([
      'served:/a.sbd', // opened in this browser at 900
      'zip:drop.sbd',
      'served:/b.sbd',
      'served:/c.sbd',
      'served:/d.sbd',
    ]);
    expect(merged[0]!.openedAt).toBe(900);
    expect(mergeRecents([local('zip:x', 1)], [])).toHaveLength(1);
  });

  it('says how long ago', () => {
    expect(timeAgo(0, 30_000)).toBe('just now');
    expect(timeAgo(0, 5 * 60_000)).toBe('5 min ago');
  });
});
