import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  aspectRatioString,
  buildAnimatic,
  exportFountain,
  projectFromStoryboarder,
  resolveLines,
  splitDialogue,
  unreferencedMedia,
  validateProject,
  type CanvasVariant,
  type StoryboarderImportResult,
} from '../src/index.js';

const DIR = join(import.meta.dirname, 'fixtures/storyboarder/lantern');

function load(): StoryboarderImportResult {
  const files = new Map<string, Uint8Array>();
  for (const f of readdirSync(join(DIR, 'images')))
    files.set(f, new Uint8Array(readFileSync(join(DIR, 'images', f))));
  const json = readFileSync(join(DIR, 'lantern.storyboarder'), 'utf8');
  return projectFromStoryboarder(json, {
    title: 'Lantern',
    files,
    now: new Date('2026-10-06T00:00:00Z'),
  });
}

describe('Storyboarder import', () => {
  let r: StoryboarderImportResult;
  beforeAll(() => {
    r = load();
  });

  it('produces a valid project with one shot per board', () => {
    const p = r.project;
    const media = new Set(Object.keys(r.media));
    const errors = validateProject(p, { hasFile: (f) => media.has(f) }).filter(
      (i) => i.severity === 'error',
    );
    expect(errors).toEqual([]);
    expect(p.ids.shots.map((s) => s.id)).toEqual(['A1B2C', 'D3E4F', 'G5H6I']);
    expect(p.shots['A1B2C']!.title).toBe('Shot 1A');
    expect(p.shots['G5H6I']!.tags).toEqual(['new-shot']);
    expect(p.manifest.aspect_ratio).toBe('16:9');
    expect(p.manifest.canvas).toEqual({ width: 192, height: 108 });
    expect(p.manifest.fps).toBe(24);
    expect(p.manifest.default_shot_duration).toBe(2);
    expect(p.manifest.preset).toBe('film');
  });

  it('maps layers bottom → top into a canvas variant with the posterframe as preview', () => {
    const v = r.project.shots['A1B2C']!.variants![0] as CanvasVariant;
    expect(v.type).toBe('canvas');
    expect(v.layers.map((l) => l.id)).toEqual(['reference', 'fill', 'ink', 'notes']);
    expect(v.layers[0]!.opacity).toBe(0.5);
    expect(v.layers.find((l) => l.id === 'notes')!.visible).toBe(false);
    expect(v.preview).toBe('board-1-a1b2c-posterframe');
    const poster = r.project.assets.assets.find((a) => a.id === v.preview)!;
    expect(poster).toMatchObject({ kind: 'image', mime: 'image/jpeg', width: 192, height: 108 });
  });

  it('treats the main image of pre-1.6 scenes as the fill layer', () => {
    const v = r.project.shots['D3E4F']!.variants![0] as CanvasVariant;
    expect(v.layers.map((l) => [l.id, l.asset])).toEqual([['fill', 'board-2-d3e4f']]);
  });

  it('turns action and dialogue into Fountain lines of the right shot', () => {
    const p = r.project;
    const text = (shot: string) =>
      p.ids.shots.find((s) => s.id === shot)!.lines.map((id) => resolveLines(p).get(id)!);
    expect(text('A1B2C').map((l) => [l.type, l.text])).toEqual([
      ['action', 'A lantern sways on a hook.'],
      ['action', 'Wind rattles the shutters.'],
    ]);
    const maya = text('D3E4F');
    expect(maya.map((l) => [l.type, l.text, l.element?.character, l.element?.extension])).toEqual([
      ['dialogue', 'We should go before the storm.', 'MAYA', 'V.O.'],
    ]);
    expect(text('G5H6I').map((l) => [l.text, l.element?.character])).toEqual([
      ['Hello? Is anyone there?', 'VOICE'],
    ]);
    expect(exportFountain(p)).toContain('MAYA (V.O.)\nWe should go before the storm.');
    expect(p.shots['A1B2C']!.fields).toEqual({ notes: 'Low angle, warm key light.' });
  });

  it('keeps Storyboarder timing: board duration, default timing, audio length', () => {
    const p = r.project;
    expect(p.shots['A1B2C']!.duration).toBe(1.5);
    expect(p.shots['D3E4F']!.duration).toBe(3);
    expect(p.shots['G5H6I']!.duration).toBe(2.6); // audio (2.6 s) > default (2 s)
    const a = buildAnimatic(p);
    expect(a.duration).toBeCloseTo(7.1);
  });

  it('attaches board audio as shot cues', () => {
    const cues = r.project.timeline.cues;
    expect(cues.map((c) => [c.target, c.track])).toEqual([
      [{ shot: 'D3E4F' }, 'audio'],
      [{ shot: 'G5H6I' }, 'audio'],
    ]);
    const audio = r.project.assets.assets.find((a) => a.id === cues[0]!.asset)!;
    expect(audio).toMatchObject({ kind: 'audio', category: 'dialogue', duration: 1 });
  });

  it('copies only used files and reports missing ones', () => {
    expect(Object.keys(r.media).sort()).toEqual([
      'media/D3E4F-audio-1700000000000.wav',
      'media/G5H6I-audio-1700000000001.wav',
      'media/board-1-A1B2C-fill.png',
      'media/board-1-A1B2C-ink.png',
      'media/board-1-A1B2C-notes.png',
      'media/board-1-A1B2C-posterframe.jpg',
      'media/board-1-A1B2C-reference.png',
      'media/board-2-D3E4F.png',
    ]);
    expect(unreferencedMedia(r.project, Object.keys(r.media))).toEqual([]);
    expect(r.warnings).toEqual([
      'Board 3A: layer file images/board-3-G5H6I-pencil.png is missing',
      'Board 3A: no drawing found',
    ]);
  });

  it('rejects files that are not Storyboarder scenes', () => {
    expect(() =>
      projectFromStoryboarder('{"title": "x"}', { title: 'x', files: new Map() }),
    ).toThrow(/boards/);
  });

  it('splits dialogue and formats aspect ratios', () => {
    expect(splitDialogue('MARA: Hi.')).toEqual({ character: 'MARA', text: 'Hi.' });
    expect(splitDialogue('Note: this is a long sentence with many words in it: yes')).toEqual({
      character: 'VOICE',
      text: 'Note: this is a long sentence with many words in it: yes',
    });
    expect(splitDialogue('Just words.', 'NARRATOR')).toEqual({
      character: 'NARRATOR',
      text: 'Just words.',
    });
    expect(aspectRatioString(1.7777777)).toBe('16:9');
    expect(aspectRatioString(2.39)).toBe('2.39:1');
    expect(aspectRatioString(1.66)).toBe('1.66:1');
    expect(aspectRatioString(0.5625)).toBe('9:16');
  });
});

describe('unreferencedMedia', () => {
  it('lists media files no asset uses (src, poster, renditions)', () => {
    const p = {
      assets: {
        assets: [
          { id: 'a', name: 'a', kind: 'video' as const, src: 'media/a.mp4', poster: 'media/a.jpg' },
          {
            id: 'b',
            name: 'b',
            kind: 'image' as const,
            src: 'media/b.png',
            variants: [{ src: 'media/b-small.webp' }],
          },
          { id: 'c', name: 'c', kind: 'image' as const, src: 'file:../c.png' },
        ],
      },
    };
    const files = [
      'manifest.json',
      'media/a.mp4',
      'media/a.jpg',
      'media/b.png',
      'media/b-small.webp',
      'media/old/take-1.wav',
      'media/unused.png',
    ];
    expect(unreferencedMedia(p, files)).toEqual(['media/old/take-1.wav', 'media/unused.png']);
  });
});
