import { describe, expect, it } from 'vitest';
import {
  align,
  distribute,
  normalizeAngle,
  rectTargets,
  rotateAbout,
  snapRect,
  union,
} from './arrange';
import { PLATFORMS, guideTargets, placeZoneLabels, type Box } from './safe-zones';

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

describe('rotating a selection as one', () => {
  it('turns each origin around the pivot and adds the angle', () => {
    const p = rotateAbout({ x: 200, y: 100 }, 10, { x: 100, y: 100 }, 90);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(200);
    expect(p.rotation).toBe(100);
    const q = rotateAbout({ x: 0, y: 0 }, 170, { x: 50, y: 50 }, 30);
    expect(q.rotation).toBe(-160);
    // a full turn comes back
    const back = rotateAbout(
      rotateAbout({ x: 7, y: 9 }, 0, { x: 1, y: 2 }, 120),
      0,
      { x: 1, y: 2 },
      240,
    );
    expect(back.x).toBeCloseTo(7);
    expect(back.y).toBeCloseTo(9);
  });

  it('normalizes angles to (−180, 180]', () => {
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(-360)).toBe(0);
    expect(Object.is(normalizeAngle(-360), -0)).toBe(false);
  });
});

describe('zone labels', () => {
  const hit = (a: Box, b: Box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it('never overlap with all three platforms on, at several zooms', () => {
    for (const zoom of [0.2, 0.3, 0.45, 1]) {
      const W = 1080 * zoom;
      const H = 1920 * zoom;
      // screen px: 11 px type, ~6 px per character, 3 px padding
      const reqs = PLATFORMS.flatMap((p) =>
        p.zones.map((z) => {
          const zone = { x: z.x * W, y: z.y * H, width: z.w * W, height: z.h * H };
          return {
            zone,
            width: z.label.length * 6 + 6,
            height: 17,
            vertical: zone.width < 90,
          };
        }),
      );
      const boxes = placeZoneLabels(reqs, 3);
      expect(boxes).toHaveLength(9);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++)
          expect(hit(boxes[i]!, boxes[j]!), `zoom ${zoom}: ${i} × ${j}`).toBe(false);
      // each label starts inside (or at the edge of) its own zone's column / row
      const starts = boxes.map((b, i) => {
        const q = reqs[i]!;
        return q.vertical ? b.y - q.zone.y : b.x - q.zone.x;
      });
      expect(Math.min(...starts)).toBeGreaterThanOrEqual(0);
    }
  });

  it('a single platform keeps its labels in the corners of its zones', () => {
    const tiktok = PLATFORMS[0]!;
    const reqs = tiktok.zones.map((z) => ({
      zone: { x: z.x * 324, y: z.y * 576, width: z.w * 324, height: z.h * 576 },
      width: 80,
      height: 17,
      vertical: z.w * 324 < 90,
    }));
    const boxes = placeZoneLabels(reqs, 3);
    expect(boxes[0]).toMatchObject({ x: 3, y: 3 });
    expect(boxes[1]!.x + boxes[1]!.width).toBeCloseTo(324 - 3);
    expect(boxes[1]!.height).toBe(80); // turned: runs down the button column
  });
});
