/**
 * Guides for the canvas editor: the classic title / action safe areas and the parts of a
 * vertical (9:16) frame that TikTok, Instagram Reels and YouTube Shorts cover with their own
 * buttons, captions and bars.
 *
 * The platform areas are APPROXIMATE: the apps change their layouts, and the exact areas differ by
 * phone, app version, ad vs. organic post and caption length. The fractions below follow the
 * commonly published guides for 1080 × 1920 (Meta's Reels guidance: keep the top 14 % and the
 * bottom 35 % free of key content; TikTok / Shorts creator guides: a right-hand button column
 * and a caption block of about the bottom 20 %). They are meant as a "keep text out of here"
 * hint, not as pixel-exact overlays.
 */

export type Platform = 'tiktok' | 'reels' | 'shorts';

export interface Zone {
  /** What covers this part of the frame. */
  label: string;
  /** Fractions of the frame (0…1). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlatformGuide {
  id: Platform;
  name: string;
  zones: Zone[];
}

export const PLATFORMS: readonly PlatformGuide[] = [
  {
    id: 'tiktok',
    name: 'TikTok',
    zones: [
      { label: 'TikTok top bar', x: 0, y: 0, w: 1, h: 0.07 },
      { label: 'TikTok buttons', x: 0.87, y: 0.38, w: 0.13, h: 0.4 },
      { label: 'TikTok caption & sound', x: 0, y: 0.8, w: 1, h: 0.2 },
    ],
  },
  {
    id: 'reels',
    name: 'Reels',
    zones: [
      { label: 'Reels top bar', x: 0, y: 0, w: 1, h: 0.14 },
      { label: 'Reels buttons', x: 0.88, y: 0.42, w: 0.12, h: 0.23 },
      { label: 'Reels caption & buttons', x: 0, y: 0.65, w: 1, h: 0.35 },
    ],
  },
  {
    id: 'shorts',
    name: 'Shorts',
    zones: [
      { label: 'Shorts top bar', x: 0, y: 0, w: 1, h: 0.06 },
      { label: 'Shorts buttons', x: 0.86, y: 0.4, w: 0.14, h: 0.38 },
      { label: 'Shorts title & channel', x: 0, y: 0.8, w: 1, h: 0.2 },
    ],
  },
];

/** Classic broadcast guides: action safe 90 %, title safe 80 % of the frame. */
export const SAFE_AREAS: ReadonlyArray<{ label: string; inset: number }> = [
  { label: 'Action safe', inset: 0.05 },
  { label: 'Title safe', inset: 0.1 },
];

export interface SnapLine {
  /** Canvas px. */
  at: number;
  label: string;
}

/**
 * Snap targets of the guides that are shown: frame edges and center always, safe areas when
 * `guides` is on, and the inner edges of the platform areas that are shown.
 */
export function guideTargets(
  size: { width: number; height: number },
  guides: boolean,
  platforms: readonly Platform[],
): { x: SnapLine[]; y: SnapLine[] } {
  const { width: W, height: H } = size;
  const x: SnapLine[] = [
    { at: 0, label: 'Frame edge' },
    { at: W / 2, label: 'Frame center' },
    { at: W, label: 'Frame edge' },
  ];
  const y: SnapLine[] = [
    { at: 0, label: 'Frame edge' },
    { at: H / 2, label: 'Frame center' },
    { at: H, label: 'Frame edge' },
  ];
  if (guides)
    for (const s of SAFE_AREAS) {
      x.push({ at: W * s.inset, label: s.label }, { at: W * (1 - s.inset), label: s.label });
      y.push({ at: H * s.inset, label: s.label }, { at: H * (1 - s.inset), label: s.label });
    }
  for (const p of PLATFORMS) {
    if (!platforms.includes(p.id)) continue;
    for (const z of p.zones) {
      // only edges that face the free part of the frame
      if (z.x > 0) x.push({ at: W * z.x, label: z.label });
      if (z.x + z.w < 1) x.push({ at: W * (z.x + z.w), label: z.label });
      if (z.y > 0) y.push({ at: H * z.y, label: z.label });
      if (z.y + z.h < 1) y.push({ at: H * (z.y + z.h), label: z.label });
    }
  }
  return { x, y };
}
