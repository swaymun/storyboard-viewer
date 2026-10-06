import { describe, expect, it } from 'vitest';
import type { Shot } from '@storyboard-viewer/format';
import { shotSummary } from './shot-summary';

const shot = (s: Partial<Shot>) => ({ id: 'a', ...s }) as Shot;
const img = (id: string) => ({ id, type: 'image', asset: 'x' });

describe('shot summary', () => {
  it('counts details with a value, tags and versions', () => {
    expect(
      shotSummary(
        shot({
          fields: { camera: 'Wide', lens: '', notes: null, angle: 'Low' } as Shot['fields'],
          tags: ['night', 'act-1'],
          variants: [img('a'), img('b'), img('c')] as Shot['variants'],
        }),
      ),
    ).toBe('2 details · 2 tags · 3 versions');
    expect(shotSummary(shot({ fields: { camera: 'Wide' } as Shot['fields'], tags: ['x'] }))).toBe(
      '1 detail · 1 tag',
    );
    // one picture is not a "version": it stays visible
    expect(shotSummary(shot({ variants: [img('a')] as Shot['variants'] }))).toBe('');
    expect(shotSummary(shot({}))).toBe('');
  });
});
