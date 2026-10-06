#!/usr/bin/env node
// Writes the small hand-made Storyboarder scene used by the importer tests:
// packages/format/test/fixtures/storyboarder/lantern/ (lantern.storyboarder + images/).
// Deterministic; needs ffmpeg for the one JPEG posterframe. Run: node scripts/make-storyboarder-fixture.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phrase, wav } from './lib/audio.mjs';
import { Raster } from './lib/raster.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'packages/format/test/fixtures/storyboarder/lantern');
const IMG = join(DIR, 'images');
const W = 192;
const H = 108;

rmSync(DIR, { recursive: true, force: true });
mkdirSync(IMG, { recursive: true });
const put = (name, bytes) => writeFileSync(join(IMG, name), bytes);

// Board 1: modern layers (reference, fill, ink, notes) + posterframe.
const reference = new Raster(W, H, null);
reference.verticalGradient('#9fb8d8', '#e6eef8');
put('board-1-A1B2C-reference.png', reference.png());
const fill = new Raster(W, H, null);
fill.rect(70, 40, 52, 60, '#d9c9a8');
put('board-1-A1B2C-fill.png', fill.png());
const ink = new Raster(W, H, null);
ink.line(70, 40, 122, 40, 2, '#222');
ink.line(70, 40, 70, 100, 2, '#222');
ink.line(122, 40, 122, 100, 2, '#222');
ink.circle(96, 28, 10, '#222');
put('board-1-A1B2C-ink.png', ink.png());
const notes = new Raster(W, H, null);
notes.text('LOW ANGLE', 6, 6, 1, '#d02020');
put('board-1-A1B2C-notes.png', notes.png());
const poster = new Raster(W, H, '#ffffff');
poster.verticalGradient('#c7d4e6', '#eef3f9');
poster.rect(70, 40, 52, 60, '#d9c9a8');
poster.circle(96, 28, 10, '#222');
const posterPng = join(IMG, '.poster.png');
writeFileSync(posterPng, poster.png());
execFileSync('ffmpeg', [
  '-loglevel',
  'error',
  '-y',
  '-i',
  posterPng,
  '-q:v',
  '5',
  join(IMG, 'board-1-A1B2C-posterframe.jpg'),
]);
rmSync(posterPng);
put('board-1-A1B2C-thumbnail.png', poster.png()); // ignored by the importer

// Board 2: pre-1.6 scene, the main drawing lives in board.url.
const legacy = new Raster(W, H, '#ffffff');
legacy.ellipse(96, 60, 40, 24, '#f2b84b');
legacy.text('MAYA', 78, 90, 1, '#333');
put('board-2-D3E4F.png', legacy.png());

// Board 3: pencil layer file is missing on purpose; audio longer than the default timing.
const sr = 8000;
const a1 = new Float32Array(sr * 1);
phrase(a1, sr, 0.1, 0.8, { pitch: 210, syllables: 4, seed: 3 });
put('D3E4F-audio-1700000000000.wav', wav(a1, sr));
const a2 = new Float32Array(Math.round(sr * 2.6));
phrase(a2, sr, 0.2, 2.2, { pitch: 150, syllables: 8, seed: 5 });
put('G5H6I-audio-1700000000001.wav', wav(a2, sr));

const scene = {
  version: '3.0.0',
  aspectRatio: 1.7777777777777777,
  fps: 24,
  defaultBoardTiming: 2000,
  boards: [
    {
      uid: 'A1B2C',
      url: 'board-1-A1B2C.png',
      newShot: false,
      lastEdited: 1700000000000,
      layers: {
        reference: { url: 'board-1-A1B2C-reference.png', opacity: 0.5 },
        fill: { url: 'board-1-A1B2C-fill.png' },
        ink: { url: 'board-1-A1B2C-ink.png', opacity: 1 },
        notes: { url: 'board-1-A1B2C-notes.png' },
      },
      number: 1,
      shot: '1A',
      time: 0,
      duration: 1500,
      action: 'A lantern sways on a hook.\nWind rattles the shutters.',
      notes: 'Low angle, warm key light.',
    },
    {
      uid: 'D3E4F',
      url: 'board-2-D3E4F.png',
      newShot: false,
      lastEdited: 1700000000000,
      layers: {},
      number: 2,
      shot: '2A',
      time: 1500,
      duration: 3000,
      dialogue: 'MAYA (V.O.): We should go before the storm.',
      audio: { filename: 'D3E4F-audio-1700000000000.wav' },
    },
    {
      uid: 'G5H6I',
      url: 'board-3-G5H6I.png',
      newShot: true,
      lastEdited: 1700000000000,
      layers: { pencil: { url: 'board-3-G5H6I-pencil.png' } },
      number: 3,
      shot: '3A',
      time: 4500,
      dialogue: 'Hello? Is anyone there?',
      audio: { filename: 'G5H6I-audio-1700000000001.wav', duration: 2600 },
    },
  ],
};
writeFileSync(join(DIR, 'lantern.storyboarder'), `${JSON.stringify(scene, null, 2)}\n`);
console.log(`wrote ${DIR}`);
