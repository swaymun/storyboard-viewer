// Generates examples/minimal.sbd/ (placeholder art, tones, optional ffmpeg video) using the
// built format package. Run after `pnpm build`: `node scripts/make-example.mjs`.
// Output is deterministic (seeded IDs and art); the video needs ffmpeg and is skipped without it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raster } from './lib/raster.mjs';
import { noiseBurst, pad, phrase, rng, wav } from './lib/audio.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, process.argv[2] ?? 'examples/minimal.sbd');

// Seed the random IDs so regenerating produces the same files.
const seeded = rng(42);
globalThis.crypto.getRandomValues = (arr) => {
  for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(seeded() * 256);
  return arr;
};

const F = await import('../packages/format/dist/index.js');
const N = await import('../packages/format/dist/node.js');

const W = 640;
const H = 360;

// ---------------------------------------------------------------- art
function label(r, text, dark = true) {
  const s = 2;
  const w = Raster.textWidth(text, s);
  r.rect(10, H - 30, w + 16, 22, dark ? '#000000a0' : '#ffffffc0');
  r.text(text, 18, H - 26, s, dark ? '#ffffff' : '#222222');
}

function lighthouse(r, x, base, { lit = false, ink = null } = {}) {
  const tower = ink ?? '#e9e4da';
  const stripe = ink ? '#00000000' : '#b8423a';
  r.polygon(
    [
      [x - 28, base],
      [x + 28, base],
      [x + 18, base - 170],
      [x - 18, base - 170],
    ],
    tower,
  );
  for (const y of [base - 40, base - 100]) {
    r.polygon(
      [
        [x - 26 + (base - y) * 0.06, y],
        [x + 26 - (base - y) * 0.06, y],
        [x + 25 - (base - y - 25) * 0.06, y - 25],
        [x - 25 + (base - y - 25) * 0.06, y - 25],
      ],
      stripe,
    );
  }
  r.rect(x - 22, base - 182, 44, 12, ink ?? '#3a3f4b');
  r.rect(x - 15, base - 210, 30, 28, lit ? '#ffe9a8' : (ink ?? '#4a5160'));
  r.polygon(
    [
      [x - 20, base - 210],
      [x + 20, base - 210],
      [x, base - 232],
    ],
    ink ?? '#3a3f4b',
  );
  if (lit) r.circle(x, base - 196, 30, '#fff3c460');
}

function waves(r, y0, color) {
  for (let k = 0; k < 6; k++) {
    const y = y0 + k * 14;
    for (let x = -20; x < W; x += 60) r.ellipse(x + (k % 2) * 30, y, 26, 4, color);
  }
}

function openingColor() {
  const r = new Raster(W, H);
  r.verticalGradient('#2b2d5c', '#f29e6d', 0, 230);
  r.circle(470, 215, 34, '#ffd28a');
  r.verticalGradient('#24476b', '#0d1f33', 230, H);
  r.polygon(
    [
      [120, 260],
      [330, 260],
      [300, 230],
      [160, 222],
    ],
    '#2a2f38',
  );
  lighthouse(r, 230, 236);
  waves(r, 252, '#7fb2d940');
  label(r, '1 OPENING - COLOR');
  return r;
}

function openingSketch() {
  const r = new Raster(W, H, '#f4f1ea');
  const ink = '#55575c';
  r.line(0, 232, W, 232, 2, ink);
  r.circle(470, 205, 30, '#00000000');
  for (let a = 0; a < 360; a += 8) {
    const t = (a * Math.PI) / 180;
    r.line(
      470 + 30 * Math.cos(t),
      205 + 30 * Math.sin(t),
      470 + 31 * Math.cos(t + 0.15),
      205 + 31 * Math.sin(t + 0.15),
      2,
      ink,
    );
  }
  lighthouse(r, 230, 236, { ink: '#8a8c91' });
  for (let k = 0; k < 5; k++)
    r.line(40 + k * 110, 270 + (k % 2) * 20, 110 + k * 110, 266 + (k % 2) * 20, 2, ink);
  label(r, '1 OPENING - SKETCH', false);
  return r;
}

function interiorBg() {
  const r = new Raster(W, H);
  r.verticalGradient('#1b1f2b', '#2c2f3b');
  r.rect(400, 50, 150, 120, '#0e1a33');
  r.circle(500, 90, 3, '#ffffff');
  r.circle(440, 120, 2, '#ffffff');
  r.circle(520, 140, 2, '#dfe8ff');
  r.rect(470, 50, 6, 120, '#2c2f3b');
  r.rect(400, 106, 150, 6, '#2c2f3b');
  for (let k = 0; k < 7; k++)
    r.rect(40 + k * 40, 330 - k * 34, 160, 34, k % 2 ? '#3d3a36' : '#4a4640');
  label(r, '2 LANTERN ROOM - BG');
  return r;
}

function maya() {
  const r = new Raster(220, 320, null);
  r.polygon(
    [
      [70, 120],
      [150, 120],
      [175, 300],
      [45, 300],
    ],
    '#c7643f',
  );
  r.circle(110, 80, 40, '#e8b48f');
  r.polygon(
    [
      [68, 70],
      [110, 30],
      [155, 72],
      [150, 110],
      [140, 72],
      [80, 75],
      [72, 110],
    ],
    '#3a2318',
  );
  r.line(150, 140, 200, 190, 16, '#c7643f');
  r.circle(202, 194, 10, '#e8b48f');
  r.rect(80, 300, 26, 20, '#2b2b33');
  r.rect(118, 300, 26, 20, '#2b2b33');
  return r;
}

function matchbox() {
  const r = new Raster(120, 80, null);
  r.rect(4, 14, 112, 60, '#e4c45a');
  r.rect(4, 14, 112, 14, '#b3462e');
  r.text('MATCH', 30, 40, 3, '#5a2a1a');
  return r;
}

function matchCloseup() {
  const r = new Raster(W, H, '#0d0d12');
  r.circle(330, 150, 120, '#ff9b3a18');
  r.circle(330, 150, 70, '#ffb45a30');
  r.polygon(
    [
      [200, 360],
      [260, 230],
      [380, 220],
      [420, 360],
    ],
    '#d29a78',
  );
  r.line(320, 230, 330, 170, 6, '#e7d3a1');
  r.ellipse(331, 150, 14, 26, '#ff8a2a');
  r.ellipse(331, 156, 7, 14, '#fff1b8');
  label(r, '3 MATCH');
  return r;
}

function lampLit() {
  const r = new Raster(W, H);
  r.verticalGradient('#060b1c', '#14284a', 0, 240);
  for (let i = 0; i < 40; i++) r.circle((i * 97) % W, (i * 53) % 200, 1.2, '#ffffffa0');
  r.verticalGradient('#0f2a44', '#06121f', 240, H);
  r.polygon(
    [
      [340, 115],
      [W, 40],
      [W, 190],
    ],
    '#ffe08a55',
  );
  r.polygon(
    [
      [300, 115],
      [0, 60],
      [0, 150],
    ],
    '#ffe08a30',
  );
  r.polygon(
    [
      [220, 262],
      [420, 262],
      [400, 240],
      [240, 236],
    ],
    '#1b2028',
  );
  lighthouse(r, 320, 245, { lit: true });
  waves(r, 266, '#ffe9a830');
  label(r, '4 THE LAMP');
  return r;
}

// ---------------------------------------------------------------- audio
const SR = 16000;
function dialogueTrack() {
  const s = new Float32Array(Math.ceil(7 * SR));
  phrase(s, SR, 0.1, 2.0, { pitch: 150, syllables: 9, seed: 3 });
  phrase(s, SR, 2.5, 1.5, { pitch: 210, syllables: 6, seed: 5 });
  phrase(s, SR, 4.6, 2.0, { pitch: 150, syllables: 7, seed: 9 });
  return wav(s, SR);
}
function musicLoop() {
  const s = new Float32Array(8 * SR);
  pad(s, SR, 0, 4, [220, 277.18, 329.63]);
  pad(s, SR, 4, 4, [196, 246.94, 293.66]);
  return wav(s, SR);
}
function matchStrike() {
  const s = new Float32Array(Math.ceil(0.8 * SR));
  noiseBurst(s, SR, 0, 0.8);
  return wav(s, SR);
}

// ---------------------------------------------------------------- project
const script = `Title: The Keeper's Light
Credit: A minimal example storyboard
Author: Storyboard Viewer

EXT. LIGHTHOUSE - DUSK

Waves crash against black rocks. At the top of the tower, the lamp is dark.

MAYA (V.O.)
Every night for forty years, my grandfather lit the lamp.

INT. LANTERN ROOM - NIGHT

Maya, 30s, climbs the last step, out of breath. She holds a matchbox.

MAYA
(whispering)
Okay, Grandpa. Show me how.

She strikes a match. The flame flickers.

The lamp ROARS to life. Light sweeps across the sea.

MAYA (V.O.)
Some things are worth keeping.

> FADE OUT.
`;

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'media'), { recursive: true });

const files = {
  'media/opening-color.png': openingColor().png(),
  'media/opening-sketch.png': openingSketch().png(),
  'media/lantern-room.png': interiorBg().png(),
  'media/maya.png': maya().png(),
  'media/matchbox.png': matchbox().png(),
  'media/match.png': matchCloseup().png(),
  'media/lamp.png': lampLit().png(),
  'media/dialogue.wav': dialogueTrack(),
  'media/music.wav': musicLoop(),
  'media/match-strike.wav': matchStrike(),
};
for (const [rel, data] of Object.entries(files)) writeFileSync(join(out, rel), data);

let video = false;
try {
  const tmp = mkdtempSync(join(tmpdir(), 'sbd-example-'));
  const mp4 = join(tmp, 'lamp-sweep.mp4');
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-loop',
    '1',
    '-i',
    join(out, 'media/lamp.png'),
    '-vf',
    "zoompan=z='min(zoom+0.002,1.25)':d=75:s=640x360:fps=25,format=yuv420p",
    '-t',
    '3',
    '-c:v',
    'libx264',
    '-preset',
    'veryslow',
    '-crf',
    '30',
    '-movflags',
    '+faststart',
    '-an',
    mp4,
  ]);
  writeFileSync(join(out, 'media/lamp-sweep.mp4'), readFileSync(mp4));
  rmSync(tmp, { recursive: true, force: true });
  video = true;
} catch {
  console.warn('ffmpeg not available: skipping media/lamp-sweep.mp4');
}

let p = F.createProject({
  title: "The Keeper's Light",
  preset: 'film',
  script,
  now: new Date('2026-10-06T12:00:00Z'),
});
p = F.updateManifest(p, {
  description:
    'A four-shot example: script lines, image variants, a canvas composition, a split dialogue track, SFX and background music.',
  canvas: { width: 1280, height: 720 },
});

const img = (id, name, src, category, tags = []) => {
  const size = F.probeImageSize(files[src]);
  p = F.addAsset(p, {
    id,
    name,
    kind: 'image',
    category,
    tags,
    src,
    mime: 'image/png',
    ...size,
  }).project;
};
img('opening-color', 'Opening (color)', 'media/opening-color.png', 'location', [
  'exterior',
  'dusk',
]);
img('opening-sketch', 'Opening (sketch)', 'media/opening-sketch.png', 'location', [
  'exterior',
  'sketch',
]);
img('lantern-room', 'Lantern room', 'media/lantern-room.png', 'location', ['interior', 'night']);
img('maya', 'Maya', 'media/maya.png', 'character', ['maya', 'cutout']);
img('matchbox', 'Matchbox', 'media/matchbox.png', 'prop', ['match']);
img('match', 'Match close-up', 'media/match.png', 'prop', ['match', 'close-up']);
img('lamp', 'The lamp, lit', 'media/lamp.png', 'location', ['exterior', 'night']);
const aud = (id, name, src, category, tags = []) => {
  p = F.addAsset(p, {
    id,
    name,
    kind: 'audio',
    category,
    tags,
    src,
    mime: 'audio/wav',
    duration: Math.round(F.probeWavDuration(files[src]) * 1000) / 1000,
  }).project;
};
aud('dialogue', 'Dialogue (all lines, one take)', 'media/dialogue.wav', 'dialogue', [
  'maya',
  'placeholder',
]);
aud('music', 'Night theme (loop)', 'media/music.wav', 'music', ['loop']);
aud('match-strike', 'Match strike', 'media/match-strike.wav', 'sfx', ['match']);
if (video) {
  p = F.addAsset(p, {
    id: 'lamp-sweep',
    name: 'Lamp sweep (animatic clip)',
    kind: 'video',
    category: 'footage',
    tags: ['night'],
    src: 'media/lamp-sweep.mp4',
    mime: 'video/mp4',
    duration: 3,
    width: 640,
    height: 360,
    poster: 'media/lamp.png',
  }).project;
}

const L = p.ids.lines.map((l) => l.id);
const byText = (prefix) => p.ids.lines.find((l) => l.text.startsWith(prefix)).id;
const range = (a, b) => F.lineRange(p, byText(a), byText(b));

p = F.addShot(p, {
  id: 'opening',
  title: 'The dark lighthouse',
  fields: {
    camera: 'Extreme wide',
    movement: 'Static',
    lens: '24mm',
    transition: 'Fade in',
    notes: 'Hold on the dark lamp.',
  },
  lines: range('EXT. LIGHTHOUSE', 'Every night'),
  variants: [
    { id: 'color', type: 'image', name: 'Color', asset: 'opening-color' },
    { id: 'sketch', type: 'image', name: 'Sketch', asset: 'opening-sketch' },
  ],
}).project;
p = F.addShot(p, {
  id: 'climb',
  title: 'Maya reaches the top',
  fields: {
    camera: 'Medium wide',
    movement: 'Handheld',
    angle: 'Low',
    notes: 'Canvas variant: arrange Maya and the matchbox.',
  },
  lines: range('INT. LANTERN ROOM', 'Maya, 30s'),
  variants: [
    {
      id: 'layout',
      type: 'canvas',
      name: 'Layout',
      width: 1280,
      height: 720,
      background: '#1b1f2b',
      layers: [
        { id: 'bg', asset: 'lantern-room', name: 'Background', x: 0, y: 0, scale_x: 2, scale_y: 2 },
        { id: 'maya', asset: 'maya', name: 'Maya', x: 520, y: 150, scale_x: 1.6, scale_y: 1.6 },
        {
          id: 'box',
          asset: 'matchbox',
          name: 'Matchbox',
          x: 860,
          y: 430,
          rotation: -12,
          opacity: 0.95,
          filters: [{ type: 'brightness', value: 1.1 }],
        },
      ],
    },
  ],
}).project;
p = F.addShot(p, {
  id: 'match',
  title: 'The match',
  fields: { camera: 'Close-up', movement: 'Static', sound: 'Match strike', transition: 'Cut' },
  lines: range('(whispering)', 'She strikes a match'),
  variants: [{ id: 'closeup', type: 'image', name: 'Close-up', asset: 'match' }],
}).project;
p = F.addShot(p, {
  id: 'lamp',
  title: 'Light returns',
  fields: {
    camera: 'Wide',
    movement: 'Dolly',
    transition: 'Fade out',
    notes: 'Push in slowly as the beam sweeps.',
  },
  lines: range('The lamp ROARS', 'FADE OUT'),
  duration: 7,
  variants: [
    { id: 'still', type: 'image', name: 'Still', asset: 'lamp' },
    ...(video ? [{ id: 'clip', type: 'image', name: 'Animatic clip', asset: 'lamp-sweep' }] : []),
  ],
}).project;

p = {
  ...p,
  timeline: {
    tracks: [
      { id: 'dialogue', label: 'Dialogue' },
      { id: 'music', label: 'Music', gain: 0.8 },
      { id: 'sfx', label: 'SFX' },
    ],
    cues: [],
  },
};
p = F.addCue(p, {
  id: 'vo-1',
  asset: 'dialogue',
  in: 0,
  out: 2.2,
  target: { line: byText('Every night') },
  track: 'dialogue',
  label: 'Every night…',
}).project;
p = F.addCue(p, {
  id: 'maya-1',
  asset: 'dialogue',
  in: 2.4,
  out: 4.1,
  target: { line: byText('Okay, Grandpa') },
  track: 'dialogue',
  label: 'Okay, Grandpa…',
}).project;
p = F.addCue(p, {
  id: 'vo-2',
  asset: 'dialogue',
  in: 4.5,
  out: 6.7,
  target: { line: byText('Some things') },
  track: 'dialogue',
  label: 'Some things…',
}).project;
p = F.addCue(p, {
  id: 'strike',
  asset: 'match-strike',
  target: { line: byText('She strikes a match') },
  offset: 0.3,
  track: 'sfx',
  gain: 0.9,
}).project;
p = F.addCue(p, {
  id: 'theme',
  asset: 'music',
  target: { global: { start: 0 } },
  track: 'music',
  gain: 0.35,
  loop: true,
  fade_in: 1,
  fade_out: 2,
}).project;
void L;

await N.writeProjectToFolder(out, p, { touchModified: false });
const check = await N.openProjectPath(out);
const errors = check.issues.filter((i) => i.severity !== 'info');
if (errors.length) {
  console.error(F.formatIssues(errors));
  process.exit(1);
}
console.log(
  `wrote ${out} (${Object.keys(check.project.shots).length} shots, ${check.project.assets.assets.length} assets)`,
);
if (!existsSync(join(out, 'media/lamp-sweep.mp4'))) console.log('(no video asset)');
