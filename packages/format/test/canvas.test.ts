// Format 0.3 canvas features: text and slot layers, groups, layouts, caption styles.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CAPTION_STYLES,
  LAYOUTS,
  addAsset,
  addLayer,
  addVariant,
  applyLayout,
  aspectClass,
  captionStyle,
  clearSlot,
  createProject,
  duplicateLayers,
  fillSlot,
  groupLayers,
  layoutsFor,
  moveLayers,
  removeAsset,
  removeLayers,
  serializeProject,
  setSlotFit,
  setSlotFrame,
  slotPlacement,
  textLayerInput,
  ungroupLayers,
  updateLayers,
  validateProject,
  validateSchema,
  addShot,
  type CanvasVariant,
  type SbdProject,
} from '../src/index.js';
import { openProjectPath } from '../src/node.js';
import { EXAMPLE } from './helpers.js';

let base: SbdProject;
beforeAll(async () => {
  base = (await openProjectPath(EXAMPLE)).project;
});

const errors = (p: SbdProject) => validateProject(p).filter((i) => i.severity === 'error');
const canvasOf = (p: SbdProject, shot = 'climb', v = 'layout') =>
  p.shots[shot]!.variants!.find((x) => x.id === v) as CanvasVariant;
const layer = (p: SbdProject, id: string, shot = 'climb', v = 'layout') =>
  canvasOf(p, shot, v).layers.find((l) => l.id === id)!;

/** A vertical (9:16) project with two images and one shot. */
function vertical(): SbdProject {
  let p = createProject({ title: 'V', preset: 'vertical' });
  p = addAsset(p, {
    id: 'wide',
    name: 'Wide',
    kind: 'image',
    src: 'media/wide.png',
    width: 1600,
    height: 900,
  }).project;
  p = addAsset(p, {
    id: 'tall',
    name: 'Tall',
    kind: 'image',
    src: 'media/tall.png',
    width: 900,
    height: 1600,
  }).project;
  p = addAsset(p, { id: 'font', name: 'Font', kind: 'font', src: 'media/f.woff2' }).project;
  return addShot(p, { id: 'hook' }).project;
}

describe('format 0.3 layers', () => {
  it('old (0.1/0.2) projects stay valid and keep their version', () => {
    expect(errors(base)).toEqual([]);
    expect(base.manifest.format_version).toBe('0.1.0');
    const moved = updateLayers(base, 'climb', 'layout', { maya: { x: 10 } });
    expect(moved.manifest.format_version).toBe('0.1.0'); // nothing new used
  });

  it('text layers validate, render attributes round-trip and bump the format to 0.3', () => {
    const r = addLayer(base, 'climb', 'layout', {
      kind: 'text',
      text: 'Hello',
      x: 100,
      y: 80,
      width: 600,
      font: 'Montserrat',
      font_size: 48,
      stroke: { color: '#000', width: 4 },
    });
    expect(errors(r.project)).toEqual([]);
    expect(r.project.manifest.format_version).toBe('0.3.0');
    const shot = JSON.parse(serializeProject(r.project)['shots/climb.json']!);
    expect(validateSchema('shot', shot)).toEqual([]);
    expect(layer(r.project, r.id)).toMatchObject({ kind: 'text', text: 'Hello', font_size: 48 });
    expect(() => addLayer(base, 'climb', 'layout', { kind: 'text' } as never)).toThrow(/text/);
  });

  it('the schema requires asset for image layers, text for text, a size for slots', () => {
    const shot = (layers: unknown[]) => ({
      id: 's',
      variants: [{ id: 'v', type: 'canvas', layers }],
    });
    expect(validateSchema('shot', shot([{ id: 'a' }])).length).toBeGreaterThan(0);
    expect(validateSchema('shot', shot([{ id: 'a', kind: 'text' }])).length).toBeGreaterThan(0);
    expect(validateSchema('shot', shot([{ id: 'a', kind: 'slot' }])).length).toBeGreaterThan(0);
    expect(
      validateSchema('shot', shot([{ id: 'a', kind: 'slot', width: 10, height: 10 }])),
    ).toEqual([]);
    // unknown kinds are allowed by the schema (readers skip them; validation warns)
    expect(validateSchema('shot', shot([{ id: 'a', kind: 'sticker' }]))).toEqual([]);
  });

  it('font assets: text layers may use them; removing the font keeps the text', () => {
    let p = vertical();
    const v = applyLayout(p, 'hook', 'full-bleed');
    p = v.project;
    const t = addLayer(p, 'hook', v.id, { kind: 'text', text: 'Hi', font_asset: 'font' });
    expect(errors(t.project)).toEqual([]);
    expect(() =>
      addLayer(p, 'hook', v.id, { kind: 'text', text: 'Hi', font_asset: 'nope' }),
    ).toThrow(/font asset/);
    const removed = removeAsset(t.project, 'font', { force: true });
    expect(layer(removed, t.id, 'hook', v.id)).toMatchObject({ kind: 'text', text: 'Hi' });
    expect(layer(removed, t.id, 'hook', v.id).font_asset).toBeUndefined();
  });

  it('unknown layer kinds are a warning, not an error', () => {
    const r = addLayer(base, 'climb', 'layout', { kind: 'sticker' } as never);
    const issues = validateProject(r.project);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(issues.some((i) => i.code === 'unknown-layer-kind')).toBe(true);
  });
});

describe('batch layer ops and groups', () => {
  it('updateLayers patches several layers in one step; null deletes', () => {
    const p = updateLayers(base, 'climb', 'layout', {
      maya: { x: 1, y: 2 },
      box: { rotation: null, opacity: 0.5 },
    });
    expect(layer(p, 'maya')).toMatchObject({ x: 1, y: 2 });
    expect(layer(p, 'box').rotation).toBeUndefined();
    expect(layer(p, 'box').opacity).toBe(0.5);
    expect(() => updateLayers(base, 'climb', 'layout', { nope: { x: 1 } })).toThrow(/Unknown/);
  });

  it('group, move, duplicate and ungroup', () => {
    const g = groupLayers(base, 'climb', 'layout', ['bg', 'box']);
    const ids = () => canvasOf(g.project).layers.map((l) => l.id);
    // members become adjacent at the topmost member's place
    expect(ids()).toEqual(['maya', 'bg', 'box']);
    expect(layer(g.project, 'bg').group).toBe(g.id);
    expect(g.project.manifest.format_version).toBe('0.3.0');
    expect(errors(g.project)).toEqual([]);
    const moved = moveLayers(g.project, 'climb', 'layout', ['bg', 'box'], 0);
    expect(canvasOf(moved).layers.map((l) => l.id)).toEqual(['bg', 'box', 'maya']);
    const dup = duplicateLayers(moved, 'climb', 'layout', ['bg', 'box']);
    const copies = dup.ids.map((id) => layer(dup.project, id));
    expect(copies[0]!.group).toBeDefined();
    expect(copies[0]!.group).not.toBe(g.id); // copies form their own group
    expect(copies[0]!.group).toBe(copies[1]!.group);
    expect(copies[0]!.x).toBe((layer(moved, 'bg').x ?? 0) + 24);
    const un = ungroupLayers(dup.project, 'climb', 'layout', [g.id]);
    expect(layer(un, 'bg').group).toBeUndefined();
    expect(layer(un, 'box').group).toBeUndefined();
    expect(layer(un, dup.ids[0]!).group).toBe(copies[0]!.group);
  });

  it('removing all but one member dissolves the group', () => {
    const g = groupLayers(base, 'climb', 'layout', ['bg', 'box', 'maya']);
    const p = removeLayers(g.project, 'climb', 'layout', ['bg', 'box']);
    expect(layer(p, 'maya').group).toBeUndefined();
    expect(() => groupLayers(base, 'climb', 'layout', ['bg'])).toThrow(/two/);
  });
});

describe('slots', () => {
  const frame = { x: 0, y: 0, width: 1080, height: 960 };

  it('cover crops the overflow (centered), contain fits inside', () => {
    const cover = slotPlacement(frame, { width: 1600, height: 900 }, 'cover');
    expect(cover).toMatchObject({ x: 0, y: 0, width: 1080, height: 960 });
    // 900 px of height map to 960 → k = 1.0667; visible source width = 1080 / k = 1012.5
    expect(cover.crop).toEqual({ x: 293.75, y: 0, width: 1012.5, height: 900 });
    const contain = slotPlacement(frame, { width: 1600, height: 900 }, 'contain');
    expect(contain).toMatchObject({ x: 0, width: 1080, height: 607.5, crop: null });
    expect(contain.y).toBeCloseTo(176.25);
  });

  it('fill, re-fit, move and clear a slot', () => {
    const a = applyLayout(vertical(), 'hook', 'split');
    let p = a.project;
    const v = canvasOf(p, 'hook', a.id);
    expect(v.layers.map((l) => [l.kind, l.name])).toEqual([
      ['slot', 'Top'],
      ['slot', 'Bottom'],
    ]);
    p = fillSlot(p, 'hook', a.id, 'Bottom', 'wide');
    const filled = layer(p, 'bottom', 'hook', a.id);
    expect(filled).toMatchObject({ asset: 'wide', x: 0, y: 960, width: 1080, height: 960 });
    expect(filled.slot).toEqual({ x: 0, y: 960, width: 1080, height: 960, name: 'Bottom' });
    expect(filled.kind).toBeUndefined(); // an ordinary image layer for older readers
    expect(errors(p)).toEqual([]);
    p = setSlotFit(p, 'hook', a.id, 'bottom', 'contain');
    expect(layer(p, 'bottom', 'hook', a.id)).toMatchObject({ width: 1080, height: 607.5 });
    expect(layer(p, 'bottom', 'hook', a.id).slot!.fit).toBe('contain');
    p = setSlotFrame(p, 'hook', a.id, 'bottom', { x: 100, y: 1000, width: 540, height: 540 });
    expect(layer(p, 'bottom', 'hook', a.id)).toMatchObject({ x: 100, width: 540, height: 303.75 });
    p = clearSlot(p, 'hook', a.id, 'bottom');
    expect(layer(p, 'bottom', 'hook', a.id)).toEqual({
      id: 'bottom',
      kind: 'slot',
      name: 'Bottom',
      fit: 'contain',
      x: 100,
      y: 1000,
      width: 540,
      height: 540,
    });
    expect(() => fillSlot(p, 'hook', a.id, 'Nope', 'wide')).toThrow(/No slot/);
  });

  it('removing a picture used in a slot leaves the empty slot', () => {
    const a = applyLayout(vertical(), 'hook', 'full-bleed', { images: ['tall'] });
    const p = removeAsset(a.project, 'tall', { force: true });
    expect(layer(p, 'main', 'hook', a.id)).toMatchObject({ kind: 'slot', name: 'Main' });
  });
});

describe('layouts', () => {
  it('are filtered by the frame shape', () => {
    expect(aspectClass(1080, 1920)).toBe('vertical');
    expect(aspectClass(1080, 1350)).toBe('portrait');
    expect(aspectClass(1080, 1080)).toBe('square');
    expect(aspectClass(1920, 1080)).toBe('landscape');
    expect(layoutsFor(1080, 1920).map((l) => l.id)).toEqual([
      'full-bleed',
      'split',
      'picture-in-picture',
      'caption-band',
      'three-stack',
      'talking-head-broll',
    ]);
    expect(layoutsFor(1920, 1080).map((l) => l.id)).toEqual([
      'full-frame',
      'two-up',
      'lower-third',
      'title-card',
    ]);
    expect(layoutsFor(1080, 1080).length).toBeGreaterThan(1);
    expect(layoutsFor(1080, 1350).length).toBeGreaterThan(1);
    for (const l of LAYOUTS)
      for (const s of l.slots) {
        expect(s.x + s.w).toBeLessThanOrEqual(1.0001);
        expect(s.y + s.h).toBeLessThanOrEqual(1.0001);
      }
  });

  it('a new layout variant: slots in pixels, images in order, placeholder text', () => {
    const r = applyLayout(vertical(), 'hook', 'caption-band', { images: ['wide'] });
    const v = canvasOf(r.project, 'hook', r.id);
    expect(r.project.shots['hook']!.active_variant).toBe(r.id);
    expect(v.background).toBe('#101114');
    expect(v.name).toBe('Bottom caption band');
    const [main, caption] = v.layers;
    expect(main).toMatchObject({ id: 'main', asset: 'wide', width: 1080, height: 1228.8 });
    expect(caption).toMatchObject({ kind: 'text', text: 'Your caption here', style: 'bold' });
    expect(caption!.font).toBe('Montserrat');
    expect(errors(r.project)).toEqual([]);
    const json = JSON.parse(serializeProject(r.project)['shots/hook.json']!);
    expect(validateSchema('shot', json)).toEqual([]);
  });

  it('apply to an existing canvas maps its pictures into the slots, largest first', () => {
    // climb: background 640x360 ×2 (largest), Maya 220x320 ×1.6, matchbox 120x80
    const r = applyLayout(base, 'climb', 'two-up', { variantId: 'layout' });
    const v = canvasOf(r.project);
    expect(r.id).toBe('layout');
    expect(v.layers.map((l) => [l.id, l.asset, l.slot?.name])).toEqual([
      ['bg', 'lantern-room', 'Left'],
      ['maya', 'maya', 'Right'],
      ['box', 'matchbox', undefined], // no slot left: stays a free layer
    ]);
    expect(layer(r.project, 'bg')).toMatchObject({ x: 0, y: 0, width: 640, height: 720 });
    expect(errors(r.project)).toEqual([]);
  });

  it('apply to an image variant makes a canvas with that image in the first slot', () => {
    let p = vertical();
    p = addVariant(p, 'hook', { id: 'img', type: 'image', asset: 'tall' }).project;
    const r = applyLayout(p, 'hook', 'picture-in-picture', { variantId: 'img', images: ['wide'] });
    const v = canvasOf(r.project, 'hook', r.id);
    expect(v.layers.map((l) => l.asset ?? l.kind)).toEqual(['tall', 'wide']);
    expect(() => applyLayout(p, 'hook', 'nope')).toThrow(/Unknown layout/);
  });
});

describe('caption styles', () => {
  it('scale with the frame and produce valid text layers', () => {
    for (const s of CAPTION_STYLES) {
      const small = captionStyle(s.id, { width: 540, height: 960 });
      const big = captionStyle(s.id, { width: 1080, height: 1920 });
      expect(big.font_size).toBeGreaterThan(small.font_size as number);
      const input = textLayerInput({ text: 'x', style: s.id }, { width: 1080, height: 1920 });
      const a = applyLayout(vertical(), 'hook', 'full-bleed');
      const r = addLayer(a.project, 'hook', a.id, input);
      expect(errors(r.project)).toEqual([]);
    }
    expect(() => captionStyle('nope', { width: 1, height: 1 })).toThrow(/caption style/);
  });
});
