import { describe, expect, it } from 'vitest';
import { align, distribute, rectTargets, snapRect, union } from './arrange';
import { PLATFORMS, guideTargets } from './safe-zones';

const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('snapping', () => {
  const frame = { width: 1080, height: 1920 };

  it('snaps an edge or the center to the nearest guide within the tolerance', () => {
    const t = guideTargets(frame, false, []);
    const s = snapRect(r(560, 300, 100, 100), t, 8); // nothing within 8 px
    expect(s.x).toBeNull();
    const c = snapRect(r(487, 900, 100, 100), t, 8); // center 537 → frame center 540
    expect(c.dx).toBe(3);
    expect(c.x?.label).toBe('Frame center');
    expect(c.y).toBeNull(); // center y 950: 10 px from 960, outside the tolerance
  });

  it('labels what it snapped to: safe areas, platform zones, other layers', () => {
    const t = guideTargets(frame, true, ['tiktok']);
    const safe = snapRect(r(110, 600, 50, 50), t, 4); // 10 % of 1080 = 108
    expect(safe.x?.label).toBe('Title safe');
    expect(safe.dx).toBe(-2);
    const zone = snapRect(r(300, 1400, 100, 130), t, 6); // bottom 1530 → TikTok caption at 1536
    expect(zone.y?.label).toBe('TikTok caption & sound');
    const others = rectTargets([{ rect: r(600, 200, 200, 100), label: 'Layer: Cat' }]);
    const l = snapRect(r(803, 50, 50, 50), others, 5);
    expect(l.x).toEqual({ at: 800, label: 'Layer: Cat' });
  });

  it('only shows platform guides that are switched on', () => {
    const none = guideTargets(frame, false, []);
    expect(none.y.some((l) => l.label.startsWith('Reels'))).toBe(false);
    const reels = guideTargets(frame, false, ['reels']);
    expect(reels.y.some((l) => l.label === 'Reels caption & buttons' && l.at === 1920 * 0.65)).toBe(
      true,
    );
    for (const p of PLATFORMS)
      for (const z of p.zones) {
        expect(z.x + z.w).toBeLessThanOrEqual(1);
        expect(z.y + z.h).toBeLessThanOrEqual(1);
      }
  });
});

describe('align and distribute', () => {
  const rects = new Map([
    ['a', r(10, 10, 100, 50)],
    ['b', r(200, 80, 40, 40)],
    ['c', r(500, 30, 60, 20)],
  ]);

  it('aligns to the selection or a reference box', () => {
    const sel = union([...rects.values()]);
    expect(sel).toEqual(r(10, 10, 550, 110));
    const left = align(rects, 'left', sel);
    expect(left.get('b')).toEqual({ dx: -190, dy: 0 });
    const mid = align(rects, 'vcenter', r(0, 0, 1000, 200));
    expect(mid.get('a')).toEqual({ dx: 0, dy: 65 });
    const right = align(rects, 'right', sel);
    expect(right.get('c')).toEqual({ dx: 0, dy: 0 });
  });

  it('distributes with equal gaps, keeping the outer boxes', () => {
    const d = distribute(rects, 'x');
    expect(d.get('a')!.dx).toBe(0);
    expect(d.get('c')!.dx).toBe(0);
    // total width 200, span 10…560 → gaps of 175
    expect(200 + d.get('b')!.dx).toBe(285);
    expect(distribute(new Map([...rects].slice(0, 2)), 'x').size).toBe(0);
    const inFrame = distribute(rects, 'y', r(0, 0, 100, 400));
    expect(inFrame.get('a')!.dy).toBe(-10);
  });
});
