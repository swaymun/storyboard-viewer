/** Fountain import/export helpers (Fountain → new project with suggested shots). */
import { parseFountain, type FountainElement } from './fountain.js';
import { createProject, type NewProjectOptions } from './project.js';
import { addShot } from './ops.js';
import type { SbdProject } from './types.js';

export type ShotSplit = 'scene' | 'paragraph' | 'none';

export interface ImportFountainOptions extends Omit<NewProjectOptions, 'script' | 'title'> {
  title?: string;
  /**
   * How to create initial shots: `paragraph` (default) = one shot per action paragraph or dialogue
   * block, the scene heading joins the first one; `scene` = one shot per scene; `none` = no shots.
   */
  split?: ShotSplit;
}

/** Groups anchorable lines into blank-line separated paragraphs (ordinals). */
function paragraphs(
  elements: readonly FountainElement[],
): Array<{ ordinals: number[]; scene: boolean }> {
  const out: Array<{ ordinals: number[]; scene: boolean }> = [];
  let prevEnd = -10;
  let current: { ordinals: number[]; scene: boolean } | undefined;
  for (const el of elements) {
    if (el.type === 'title_page' || el.type === 'note' || el.type === 'boneyard') continue;
    const contiguous = el.startLine === prevEnd + 1;
    if (!contiguous || !current) {
      current = { ordinals: [], scene: false };
      out.push(current);
    }
    if (el.ordinal !== undefined) current.ordinals.push(el.ordinal);
    if (el.type === 'scene_heading') current.scene = true;
    prevEnd = el.endLine;
  }
  return out.filter((p) => p.ordinals.length);
}

export function projectFromFountain(script: string, opts: ImportFountainOptions = {}): SbdProject {
  const doc = parseFountain(script);
  const title = opts.title ?? doc.titlePage['title']?.replace(/[*_]/g, '').trim() ?? 'Untitled';
  const po: NewProjectOptions = { title: title || 'Untitled', script };
  if (opts.preset) po.preset = opts.preset;
  if (opts.aspect_ratio) po.aspect_ratio = opts.aspect_ratio;
  if (opts.now) po.now = opts.now;
  let p = createProject(po);
  const split = opts.split ?? 'paragraph';
  if (split === 'none') return p;
  const ids = p.ids.lines.map((l) => l.id);
  const groups: number[][] = [];
  let pendingScene: number[] = [];
  for (const para of paragraphs(doc.elements)) {
    const sceneOnly =
      para.scene && para.ordinals.every((o) => doc.lines[o]!.type === 'scene_heading');
    const transitionOnly = para.ordinals.every((o) => doc.lines[o]!.type === 'transition');
    if (split === 'scene') {
      if (para.scene || !groups.length) groups.push([...para.ordinals]);
      else groups.at(-1)!.push(...para.ordinals);
      continue;
    }
    if (sceneOnly) {
      pendingScene.push(...para.ordinals);
      continue;
    }
    if (transitionOnly && groups.length && !pendingScene.length) {
      groups.at(-1)!.push(...para.ordinals);
      continue;
    }
    groups.push([...pendingScene, ...para.ordinals]);
    pendingScene = [];
  }
  if (pendingScene.length) groups.push(pendingScene);
  for (const g of groups) p = addShot(p, { lines: g.map((o) => ids[o]!) }).project;
  return p;
}

/** The script as plain Fountain (a title page is generated when the project has no script). */
export function exportFountain(p: SbdProject): string {
  if (p.script !== null) return p.script;
  return `Title: ${p.manifest.title}\n\n`;
}
