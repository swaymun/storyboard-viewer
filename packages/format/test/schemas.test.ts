import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS build script without types
import { renderSchemasModule, SCHEMA_NAMES } from '../../../scripts/gen-schemas.mjs';
import {
  SCHEMAS,
  createProject,
  validateSchema,
  type Asset,
  type IdsFile,
  type Manifest,
  type Shot,
  type Timeline,
} from '../src/index.js';
import { ROOT, EXAMPLE } from './helpers.js';

describe('JSON Schemas', () => {
  it('schemas.gen.ts is in sync with schema/*.schema.json (run `pnpm gen:schemas`)', () => {
    const current = readFileSync(join(ROOT, 'packages/format/src/schemas.gen.ts'), 'utf8');
    expect(current).toBe(renderSchemasModule());
    expect(Object.keys(SCHEMAS).sort()).toEqual([...(SCHEMA_NAMES as string[])].sort());
  });

  it('validates the example project files', () => {
    const read = (f: string) => JSON.parse(readFileSync(join(EXAMPLE, f), 'utf8'));
    expect(validateSchema('manifest', read('manifest.json'))).toEqual([]);
    expect(validateSchema('ids', read('ids.json'))).toEqual([]);
    expect(validateSchema('assets', read('assets.json'))).toEqual([]);
    expect(validateSchema('timeline', read('timeline.json'))).toEqual([]);
    for (const f of readdirSync(join(EXAMPLE, 'shots'))) {
      expect(validateSchema('shot', read(`shots/${f}`))).toEqual([]);
    }
  });

  it('accepts fully typed fixtures (keeps TS types and schemas in sync)', () => {
    const manifest: Manifest = {
      format: 'sbd',
      format_version: '0.1.0',
      title: 'T',
      description: 'd',
      authors: ['a'],
      language: 'en',
      preset: 'film',
      aspect_ratio: '2.39:1',
      canvas: { width: 1920, height: 803 },
      fps: 24,
      default_shot_duration: 2,
      categories: [{ id: 'character', label: 'Character', kinds: ['image'], color: '#f00' }],
      shot_fields: [
        {
          id: 'camera',
          label: 'Camera',
          type: 'select',
          options: ['Wide'],
          placeholder: 'p',
          description: 'd',
        },
      ],
      created: '2026-01-01T00:00:00Z',
      modified: '2026-01-01T00:00:00Z',
      generator: 'test',
      x_custom: { anything: true },
    };
    const ids: IdsFile = {
      script_hash: null,
      lines: [{ id: 'l_1', ordinal: 0, hash: 'abc', text: 'INT. X', type: 'scene_heading' }],
      shots: [{ id: 's_1', lines: ['l_1'] }],
    };
    const shot: Shot = {
      id: 's_1',
      title: 't',
      fields: { camera: 'Wide', frames: 12, flag: true, cleared: null },
      duration: 2.5,
      tags: ['a'],
      active_variant: 'v2',
      variants: [
        { id: 'v1', type: 'image', asset: 'a1', name: 'n', notes: 'x' },
        {
          id: 'v2',
          type: 'canvas',
          width: 100,
          height: 50,
          background: '#000',
          preview: 'a1',
          layers: [
            {
              id: 'ly1',
              asset: 'a1',
              name: 'L',
              x: 1,
              y: 2,
              width: 10,
              height: 10,
              scale_x: -1,
              scale_y: 1,
              rotation: 45,
              opacity: 0.5,
              crop: { x: 0, y: 0, width: 5, height: 5 },
              filters: [{ type: 'blur', value: 2 }],
              visible: true,
              locked: false,
            },
          ],
        },
      ],
    };
    const asset: Asset = {
      id: 'a1',
      name: 'A',
      kind: 'video',
      category: 'footage',
      tags: ['t'],
      src: 'file:../renders/a.mp4',
      mime: 'video/mp4',
      duration: 3,
      width: 10,
      height: 10,
      poster: 'media/a.png',
      sha256: 'a'.repeat(64),
      size: 10,
      variants: [
        {
          src: 'https://example.com/a.m3u8',
          mime: 'application/vnd.apple.mpegurl',
          role: 'alt',
          label: 'HLS',
          width: 1,
          height: 1,
        },
      ],
      notes: 'n',
      credit: 'c',
      license: 'CC0',
    };
    const timeline: Timeline = {
      tracks: [{ id: 'music', label: 'Music', gain: 0.5, muted: false }],
      cues: [
        {
          id: 'c1',
          asset: 'a1',
          in: 1,
          out: 2,
          target: { line: 'l_1' },
          offset: 0.5,
          gain: 1,
          track: 'dialogue',
          fade_in: 0.1,
          fade_out: 0.1,
          loop: false,
          label: 'x',
        },
        { id: 'c2', asset: 'a1', target: { shot: 's_1' } },
        { id: 'c3', asset: 'a1', target: { range: ['l_1', 'l_1'] } },
        { id: 'c4', asset: 'a1', target: { global: { start: 0 } } },
        { id: 'c5', asset: 'a1', target: { global: {} } },
      ],
    };
    expect(validateSchema('manifest', manifest)).toEqual([]);
    expect(validateSchema('ids', ids)).toEqual([]);
    expect(validateSchema('shot', shot)).toEqual([]);
    expect(validateSchema('assets', { assets: [asset] })).toEqual([]);
    expect(validateSchema('timeline', timeline)).toEqual([]);
    const p = createProject({ title: 'x', preset: 'documentary' });
    expect(validateSchema('manifest', p.manifest)).toEqual([]);
  });

  it('reports readable errors', () => {
    const issues = validateSchema(
      'shot',
      { id: 'bad id!', variants: [{ id: 'v', type: 'image' }] },
      'shots/x.json',
    );
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toMatch(/\/id: IDs may use letters/);
    expect(text).toMatch(/\/variants\/0: .*required property "asset"/);
    expect(issues.every((i) => i.file === 'shots/x.json')).toBe(true);
    const cue = validateSchema('timeline', {
      cues: [{ id: 'c', asset: 'a', target: { line: 'l', shot: 's' } }],
    });
    expect(cue.map((i) => i.message).join()).toMatch(/target must be exactly one of/);
    const src = validateSchema('assets', {
      assets: [{ id: 'a', name: 'a', kind: 'image', src: '../x.png' }],
    });
    expect(src.map((i) => i.message).join()).toMatch(/src must be "media\/<file>"/);
    expect(
      validateSchema('assets', {
        assets: [{ id: 'a', name: 'a', kind: 'image', src: 'media/../x.png' }],
      }),
    ).not.toEqual([]);
  });

  it('keeps Node-only code out of the browser entry', () => {
    const dir = join(ROOT, 'packages/format/src');
    for (const f of readdirSync(dir)) {
      if (f === 'node.ts') continue;
      expect({ f, node: /from 'node:/.test(readFileSync(join(dir, f), 'utf8')) }).toEqual({
        f,
        node: false,
      });
    }
  });
});
