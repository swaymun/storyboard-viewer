import { describe, expect, it } from 'vitest';
import {
  classifySrc,
  createProject,
  formatIssues,
  hasErrors,
  playabilityWarning,
  probeImageSize,
  probeWavDuration,
  validateProject,
  type SbdProject,
} from '../src/index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXAMPLE } from './helpers.js';

function broken(): SbdProject {
  const p = createProject({ title: 'Broken', preset: 'film', script: 'INT. A - DAY\n\nHello.\n' });
  return {
    ...p,
    ids: {
      ...p.ids,
      shots: [
        { id: 's1', lines: [p.ids.lines[0]!.id, 'l_missing'] },
        { id: 's2', lines: [] },
      ],
    },
    shots: {
      s1: {
        id: 's1',
        variants: [
          { id: 'v1', type: 'image', asset: 'nope' },
          {
            id: 'v1',
            type: 'canvas',
            layers: [{ id: 'x', asset: 'snd', filters: [{ type: 'wobble' }] }],
          },
        ],
        active_variant: 'v9',
        fields: { custom_thing: 'x' },
      },
      orphan: { id: 'orphan' },
    },
    assets: {
      assets: [
        { id: 'snd', name: 'Sound', kind: 'audio', src: 'media/missing.wav' },
        { id: 'mov', name: 'Mov', kind: 'video', src: 'file:/abs/clip.mov' },
        {
          id: 'snd',
          name: 'Dup',
          kind: 'audio',
          src: 'https://example.com/a.mp3',
          category: 'weird',
        },
      ],
    },
    timeline: {
      cues: [
        { id: 'c1', asset: 'nope', target: { line: 'l_x' } },
        { id: 'c2', asset: 'snd', in: 2, out: 1, target: { shot: 's9' } },
      ],
    },
  };
}

describe('validateProject', () => {
  it('finds referential problems', () => {
    const issues = validateProject(broken(), { hasFile: () => false, linkedExists: () => false });
    const codes = issues.map((i) => `${i.severity}:${i.code}`);
    for (const c of [
      'error:missing-line',
      'error:missing-shot-file',
      'warning:orphan-shot',
      'error:missing-asset',
      'error:duplicate-id',
      'error:wrong-kind',
      'warning:unknown-filter',
      'error:missing-variant',
      'info:custom-field',
      'error:missing-media',
      'warning:absolute-link',
      'warning:not-browser-safe',
      'info:unknown-category',
      'error:bad-range',
      'error:missing-shot',
    ]) {
      expect(codes).toContain(c);
    }
    expect(hasErrors(issues)).toBe(true);
    expect(formatIssues(issues)).toMatch(
      /^error +ids.json \/shots\/0\/lines\/1 +shot "s1" references unknown line "l_missing"$/m,
    );
  });

  it('stops at schema errors before referential checks', () => {
    const p = createProject({ title: 'x' });
    const issues = validateProject({ ...p, manifest: { ...p.manifest, format_version: 'one' } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('schema');
  });
});

describe('media helpers', () => {
  it('classifies sources', () => {
    expect(classifySrc('media/a/b.png')).toEqual({ kind: 'embedded', path: 'media/a/b.png' });
    expect(classifySrc('media/../x')).toBeNull();
    expect(classifySrc('file:../renders/My%20Clip.mp4')).toEqual({
      kind: 'linked',
      path: '../renders/My Clip.mp4',
      absolute: false,
    });
    expect(classifySrc('file:///Users/x/a.mp4')).toEqual({
      kind: 'linked',
      path: '/Users/x/a.mp4',
      absolute: true,
    });
    expect(classifySrc('https://x.com/live.m3u8?token=1')).toEqual({
      kind: 'remote',
      url: 'https://x.com/live.m3u8?token=1',
      hls: true,
    });
    expect(classifySrc('C:\\x.png')).toBeNull();
  });

  it('warns on formats browsers cannot play', () => {
    expect(playabilityWarning({ src: 'media/a.mp4', kind: 'video' })).toBeNull();
    expect(
      playabilityWarning({ src: 'media/a.mp4', kind: 'video', mime: 'video/mp4; codecs="hvc1"' }),
    ).toMatch(/HEVC/);
    expect(playabilityWarning({ src: 'file:a.mov', kind: 'video' })).toMatch(/QuickTime/);
    expect(playabilityWarning({ src: 'media/a.tiff', kind: 'image' })).toMatch(/TIFF/);
    expect(playabilityWarning({ src: 'media/a.xyz', kind: 'image' })).toMatch(/browser-safe/);
  });

  it('probes image sizes and WAV durations', () => {
    const png = new Uint8Array(readFileSync(join(EXAMPLE, 'media/maya.png')));
    expect(probeImageSize(png)).toEqual({ width: 220, height: 320 });
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"></svg>',
    );
    expect(probeImageSize(svg)).toEqual({ width: 64, height: 32 });
    const wav = new Uint8Array(readFileSync(join(EXAMPLE, 'media/match-strike.wav')));
    expect(probeWavDuration(wav)).toBeCloseTo(0.8, 2);
    expect(probeWavDuration(png)).toBeNull();
  });
});
