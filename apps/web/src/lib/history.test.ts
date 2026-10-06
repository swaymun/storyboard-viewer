import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('undoes and redoes with labels', () => {
    const h = new History<number>();
    h.push(0, 'Add one');
    h.push(1, 'Add two');
    expect(h.undoLabel).toBe('Add two');
    expect(h.undo(3)!.state).toBe(1);
    expect(h.redoLabel).toBe('Add two');
    expect(h.undo(1)!.state).toBe(0);
    expect(h.undo(0)).toBeNull();
    expect(h.redo(0)!.state).toBe(1);
    expect(h.redo(1)!.state).toBe(3);
    expect(h.redo(3)).toBeNull();
  });

  it('clears the redo stack on a new action', () => {
    const h = new History<number>();
    h.push(0, 'a');
    h.undo(1);
    h.push(0, 'b');
    expect(h.redoLabel).toBeNull();
    expect(h.undoLabel).toBe('b');
  });

  it('coalesces repeated actions within the window', () => {
    let t = 0;
    const h = new History<number>(100, 1000, () => t);
    h.push(0, 'Opacity', 'layer-1-opacity');
    t = 500;
    h.push(1, 'Opacity', 'layer-1-opacity');
    t = 900;
    h.push(2, 'Opacity', 'layer-1-opacity');
    expect(h.past).toHaveLength(1);
    expect(h.undo(3)!.state).toBe(0);
    t = 5000;
    h.push(3, 'Opacity', 'layer-1-opacity');
    t = 7000;
    h.push(4, 'Opacity', 'layer-1-opacity');
    expect(h.past).toHaveLength(2);
  });

  it('keeps at most `limit` entries and can rewrite states', () => {
    const h = new History<number>(3);
    for (let i = 0; i < 5; i++) h.push(i, `#${i}`);
    expect(h.past.map((e) => e.state)).toEqual([2, 3, 4]);
    h.map((s) => s * 10);
    expect(h.past.map((e) => e.state)).toEqual([20, 30, 40]);
  });
});
