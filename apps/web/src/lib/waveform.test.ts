import { describe, expect, it } from 'vitest';
import { computePeaks } from './waveform';

describe('computePeaks', () => {
  it('reduces samples to per-bucket absolute peaks across channels', () => {
    const sr = 1000;
    const a = new Float32Array(1000);
    const b = new Float32Array(1000);
    a[5] = 0.5; // bucket 0
    b[15] = -0.8; // bucket 1
    a[995] = 0.25; // last bucket
    const p = computePeaks([a, b], sr, 100);
    expect(p.rate).toBe(100);
    expect(p.duration).toBe(1);
    expect(p.data.length).toBe(100);
    expect(p.data[0]).toBeCloseTo(0.5);
    expect(p.data[1]).toBeCloseTo(0.8);
    expect(p.data[2]).toBe(0);
    expect(p.data[99]).toBeCloseTo(0.25);
  });
});
