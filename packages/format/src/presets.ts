/**
 * Presets only pre-fill manifest categories, shot fields and frame defaults. They never restrict
 * what a project may contain.
 */
import { FORMAT_VERSION, type CategoryDef, type Manifest, type ShotFieldDef } from './types.js';

export type PresetId = 'blank' | 'film' | 'documentary' | 'animation' | 'motion' | 'vertical';

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  /** Short examples of what the preset suits (for pickers). */
  examples: string;
  aspect_ratio: string;
  canvas: { width: number; height: number };
  fps: number;
  categories: CategoryDef[];
  shot_fields: ShotFieldDef[];
}

const cat = (id: string, label: string, kinds: CategoryDef['kinds']): CategoryDef => ({
  id,
  label,
  kinds,
});

const SHOT_SIZES = [
  'Extreme wide',
  'Wide',
  'Full',
  'Medium wide',
  'Medium',
  'Medium close-up',
  'Close-up',
  'Extreme close-up',
  'Insert',
  'Over the shoulder',
  'POV',
];
const MOVES = ['Static', 'Pan', 'Tilt', 'Dolly', 'Truck', 'Crane', 'Handheld', 'Zoom', 'Tracking'];
const TRANSITIONS = ['Cut', 'Dissolve', 'Fade in', 'Fade out', 'Wipe', 'Match cut', 'Smash cut'];

const notes: ShotFieldDef = { id: 'notes', label: 'Notes', type: 'longtext' };

export const PRESETS: Record<PresetId, Preset> = {
  blank: {
    id: 'blank',
    label: 'Blank',
    description: 'Minimal setup: generic categories and a notes field.',
    examples: 'Anything. Start simple and add fields later.',
    aspect_ratio: '16:9',
    canvas: { width: 1920, height: 1080 },
    fps: 24,
    categories: [
      cat('image', 'Image', ['image']),
      cat('footage', 'Footage', ['video']),
      cat('music', 'Music', ['audio']),
      cat('sfx', 'Sound effect', ['audio']),
      cat('voiceover', 'Voice-over', ['audio']),
      cat('custom', 'Other', ['image', 'audio', 'video', 'font']),
    ],
    shot_fields: [{ id: 'camera', label: 'Camera' }, notes],
  },
  film: {
    id: 'film',
    label: 'Film / Short',
    description: 'Narrative film or short: shot size, movement, lens, transitions.',
    examples: 'Short films, music videos, scenes from a feature.',
    aspect_ratio: '16:9',
    canvas: { width: 1920, height: 1080 },
    fps: 24,
    categories: [
      cat('character', 'Character', ['image']),
      cat('location', 'Location / background', ['image', 'video']),
      cat('prop', 'Prop', ['image']),
      cat('footage', 'Footage', ['video']),
      cat('dialogue', 'Dialogue', ['audio']),
      cat('music', 'Music', ['audio']),
      cat('sfx', 'Sound effect', ['audio']),
      cat('custom', 'Other', ['image', 'audio', 'video', 'font']),
    ],
    shot_fields: [
      { id: 'camera', label: 'Shot size', type: 'select', options: SHOT_SIZES },
      { id: 'angle', label: 'Angle', placeholder: 'Eye level, low, high, Dutch…' },
      { id: 'movement', label: 'Movement', type: 'select', options: MOVES },
      { id: 'lens', label: 'Lens', placeholder: '35mm' },
      { id: 'transition', label: 'Transition', type: 'select', options: TRANSITIONS },
      { id: 'sound', label: 'Sound' },
      notes,
    ],
  },
  documentary: {
    id: 'documentary',
    label: 'Documentary',
    description: 'Interviews, B-roll and archival with voice-over and lower thirds.',
    examples: 'Documentaries, explainers, video essays, interviews.',
    aspect_ratio: '16:9',
    canvas: { width: 1920, height: 1080 },
    fps: 25,
    categories: [
      cat('interview', 'Interview', ['video', 'image']),
      cat('b_roll', 'B-roll', ['video', 'image']),
      cat('archival', 'Archival', ['video', 'image', 'audio']),
      cat('graphics', 'Graphics', ['image']),
      cat('location', 'Location', ['image']),
      cat('voiceover', 'Voice-over', ['audio']),
      cat('music', 'Music', ['audio']),
      cat('sfx', 'Sound effect', ['audio']),
    ],
    shot_fields: [
      {
        id: 'source',
        label: 'Source',
        type: 'select',
        options: ['Interview', 'B-roll', 'Archival', 'Graphics', 'Reconstruction'],
      },
      { id: 'lower_third', label: 'Lower third' },
      { id: 'on_screen_text', label: 'On-screen text' },
      { id: 'timecode', label: 'Source timecode', placeholder: '01:02:03:04' },
      notes,
    ],
  },
  animation: {
    id: 'animation',
    label: 'Animation',
    description: 'Animated film: poses, action, timing in frames, effects.',
    examples: 'Animated shorts, cartoons, 2D/3D animation, pitch boards.',
    aspect_ratio: '16:9',
    canvas: { width: 1920, height: 1080 },
    fps: 24,
    categories: [
      cat('character', 'Character', ['image']),
      cat('background', 'Background', ['image']),
      cat('prop', 'Prop', ['image']),
      cat('effects', 'Effects', ['image', 'video']),
      cat('dialogue', 'Dialogue', ['audio']),
      cat('music', 'Music', ['audio']),
      cat('sfx', 'Sound effect', ['audio']),
    ],
    shot_fields: [
      { id: 'camera', label: 'Camera', type: 'select', options: SHOT_SIZES },
      { id: 'action', label: 'Action / pose', type: 'longtext' },
      { id: 'frames', label: 'Timing (frames)', type: 'number' },
      { id: 'fx', label: 'Effects' },
      { id: 'transition', label: 'Transition', type: 'select', options: TRANSITIONS },
      notes,
    ],
  },
  motion: {
    id: 'motion',
    label: 'Motion / Brand',
    description: 'Motion design and brand videos: on-screen text, motion, easing.',
    examples: 'Product launches, logo reveals, ads, title sequences.',
    aspect_ratio: '16:9',
    canvas: { width: 1920, height: 1080 },
    fps: 30,
    categories: [
      cat('logo', 'Logo / icon', ['image']),
      cat('typography', 'Typography', ['font']),
      cat('product', 'Product', ['image', 'video']),
      cat('background', 'Background', ['image', 'video']),
      cat('footage', 'Footage', ['video']),
      cat('voiceover', 'Voice-over', ['audio']),
      cat('music', 'Music', ['audio']),
      cat('sfx', 'Sound effect', ['audio']),
    ],
    shot_fields: [
      { id: 'on_screen_text', label: 'On-screen text' },
      {
        id: 'motion',
        label: 'Motion',
        type: 'longtext',
        placeholder: 'Logo scales in, text slides up',
      },
      {
        id: 'easing',
        label: 'Easing',
        type: 'select',
        options: ['Linear', 'Ease in', 'Ease out', 'Ease in-out', 'Spring'],
      },
      { id: 'transition', label: 'Transition', type: 'select', options: TRANSITIONS },
      { id: 'brand_notes', label: 'Brand notes' },
      notes,
    ],
  },
  vertical: {
    id: 'vertical',
    label: 'Short-form vertical',
    description: 'Vertical 9:16 video for TikTok, Reels and Shorts: hook, beats, captions.',
    examples: 'TikTok, Instagram Reels, YouTube Shorts, stories.',
    aspect_ratio: '9:16',
    canvas: { width: 1080, height: 1920 },
    fps: 30,
    categories: [
      cat('talent', 'Talent / creator', ['image', 'video']),
      cat('footage', 'Footage / B-roll', ['video', 'image']),
      cat('product', 'Product', ['image', 'video']),
      cat('graphics', 'Graphics / stickers', ['image']),
      cat('typography', 'Typography', ['font']),
      cat('voiceover', 'Voice-over', ['audio']),
      cat('music', 'Music / trending sound', ['audio']),
      cat('sfx', 'Sound effect', ['audio']),
    ],
    shot_fields: [
      {
        id: 'beat',
        label: 'Beat',
        type: 'select',
        options: ['Hook', 'Setup', 'Value', 'Twist', 'Payoff', 'Call to action'],
      },
      { id: 'on_screen_text', label: 'On-screen text', placeholder: 'Wait for it…' },
      {
        id: 'camera',
        label: 'Framing',
        type: 'select',
        options: ['Selfie', 'Close-up', 'Medium', 'Wide', 'Overhead', 'POV', 'Screen recording'],
      },
      {
        id: 'transition',
        label: 'Transition',
        type: 'select',
        options: ['Jump cut', 'Cut', 'Whip pan', 'Zoom', 'Match cut', 'Hand cover', 'None'],
      },
      { id: 'sound', label: 'Sound / music cue' },
      notes,
    ],
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export function isPresetId(id: string): id is PresetId {
  return Object.hasOwn(PRESETS, id);
}

export interface NewManifestOptions {
  title: string;
  preset?: PresetId;
  aspect_ratio?: string;
  now?: Date;
}

/** Builds a manifest pre-filled from a preset. */
export function manifestFromPreset(opts: NewManifestOptions): Manifest {
  const preset = PRESETS[opts.preset ?? 'blank'];
  const iso = (opts.now ?? new Date()).toISOString();
  let canvas = { ...preset.canvas };
  const aspect = opts.aspect_ratio ?? preset.aspect_ratio;
  if (opts.aspect_ratio) canvas = canvasForAspect(aspect);
  return {
    format: 'sbd',
    format_version: FORMAT_VERSION,
    title: opts.title,
    preset: preset.id,
    aspect_ratio: aspect,
    canvas,
    fps: preset.fps,
    default_shot_duration: 3,
    categories: structuredClone(preset.categories),
    shot_fields: structuredClone(preset.shot_fields),
    created: iso,
    modified: iso,
  };
}

/** Canvas size for an aspect ratio, keeping the long edge at 1920 px. */
export function canvasForAspect(aspect: string): { width: number; height: number } {
  const [w, h] = aspect.split(':').map(Number) as [number, number];
  if (!(w > 0 && h > 0)) return { width: 1920, height: 1080 };
  return w >= h
    ? { width: 1920, height: Math.round((1920 * h) / w) }
    : { width: Math.round((1920 * w) / h), height: 1920 };
}

/** Parses "16:9" into a number (width / height); 16/9 when invalid. */
export function aspectValue(aspect: string | undefined): number {
  const [w, h] = (aspect ?? '16:9').split(':').map(Number) as [number, number];
  return w > 0 && h > 0 ? w / h : 16 / 9;
}
