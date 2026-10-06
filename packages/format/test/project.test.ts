import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  blobSource,
  buildAnimatic,
  bytesSource,
  createProject,
  hashText,
  loadProject,
  packSbd,
  projectFromFountain,
  resolveLines,
  serializeProject,
  treeReader,
  unassignedLines,
  validateProject,
  zipReader,
} from '../src/index.js';
import { openProjectPath, readFolderTree, writeProjectToFolder } from '../src/node.js';
import { EXAMPLE } from './helpers.js';

const tmps: string[] = [];
function tmpCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sbd-test-'));
  tmps.push(dir);
  const dest = join(dir, 'story.sbd');
  cpSync(EXAMPLE, dest, { recursive: true });
  return dest;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('loading', () => {
  it('loads the example folder without errors or warnings', async () => {
    const r = await openProjectPath(EXAMPLE);
    expect(r.kind).toBe('folder');
    expect(r.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(r.reanchor).toBeUndefined();
    expect(r.project.ids.shots.map((s) => s.id)).toEqual(['opening', 'climb', 'match', 'lamp']);
    expect(unassignedLines(r.project)).toEqual([]);
  });

  it('serializes back to the exact same files', async () => {
    const r = await openProjectPath(EXAMPLE);
    for (const [path, text] of Object.entries(serializeProject(r.project))) {
      expect({ path, text: readFileSync(join(EXAMPLE, path), 'utf8') }).toEqual({ path, text });
    }
  });

  it('loads the same project from a packed zip (bytes and Blob)', async () => {
    const tree = await readFolderTree(EXAMPLE);
    const zip = packSbd(tree);
    const fromBytes = await loadProject(await zipReader(bytesSource(zip)));
    const fromBlob = await loadProject(await zipReader(blobSource(new Blob([zip as BlobPart]))));
    const fromFolder = await openProjectPath(EXAMPLE);
    expect(fromBytes.project).toEqual(fromFolder.project);
    expect(fromBlob.project).toEqual(fromFolder.project);
    expect(fromBlob.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('opens a packed .sbd file from disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sbd-zip-'));
    tmps.push(dir);
    const file = join(dir, 'story.sbd');
    writeFileSync(file, packSbd(await readFolderTree(EXAMPLE)));
    const r = await openProjectPath(file);
    expect(r.kind).toBe('packed');
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    await r.close();
  });

  it('reports missing media and missing manifest', async () => {
    const tree = await readFolderTree(EXAMPLE);
    delete tree['media/maya.png'];
    const r = await loadProject(treeReader(tree));
    expect(r.issues.some((i) => i.code === 'missing-media' && i.message.includes('maya.png'))).toBe(
      true,
    );
    delete tree['manifest.json'];
    await expect(loadProject(treeReader(tree))).rejects.toThrow(/manifest.json is missing/);
  });

  it('reports invalid JSON without crashing', async () => {
    const tree = await readFolderTree(EXAMPLE);
    tree['timeline.json'] = new TextEncoder().encode('{ nope');
    const r = await loadProject(treeReader(tree));
    expect(r.issues.some((i) => i.code === 'json' && i.file === 'timeline.json')).toBe(true);
  });
});

describe('re-anchoring on load', () => {
  it('keeps shot lines when the script is edited by hand', async () => {
    const dir = tmpCopy();
    const before = (await openProjectPath(dir)).project;
    const scriptPath = join(dir, 'script.fountain');
    let s = readFileSync(scriptPath, 'utf8');
    s = s
      .replace(
        'She strikes a match. The flame flickers.',
        'She strikes a match. The tiny flame flickers.',
      )
      .replace('Okay, Grandpa. Show me how.', 'Okay, Grandpa. Show me how.\nOne more time.')
      .replace(
        'Waves crash against black rocks. At the top of the tower, the lamp is dark.\n\n',
        '',
      );
    writeFileSync(scriptPath, s);
    const r = await openProjectPath(dir);
    expect(r.reanchor).toBeDefined();
    expect(r.issues.some((i) => i.code === 'reanchored')).toBe(true);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const lines = resolveLines(r.project);
    const strike = before.ids.lines.find((l) => l.text.startsWith('She strikes'))!.id;
    expect(lines.get(strike)?.text).toBe('She strikes a match. The tiny flame flickers.');
    const match = r.project.ids.shots.find((x) => x.id === 'match')!;
    // the new dialogue line was placed inside the "match" shot
    expect(match.lines.map((id) => lines.get(id)!.text)).toEqual([
      '(whispering)',
      'Okay, Grandpa. Show me how.',
      'One more time.',
      'She strikes a match. The tiny flame flickers.',
    ]);
    // the removed action line is gone from the opening shot
    expect(r.project.ids.shots[0]!.lines).toHaveLength(2);
    expect(r.project.ids.script_hash).toBe(hashText(s));
    // writing persists the new mapping; reloading does not re-anchor again
    await writeProjectToFolder(dir, r.project);
    const again = await openProjectPath(dir);
    expect(again.reanchor).toBeUndefined();
    expect(again.project.ids).toEqual(r.project.ids);
  });

  it('assigns IDs when a script is added to a project without ids', async () => {
    const p = createProject({ title: 'x', script: 'INT. ROOM - DAY\n\nA chair.\n' });
    expect(p.ids.lines.map((l) => l.text)).toEqual(['INT. ROOM - DAY', 'A chair.']);
    expect(p.ids.script_hash).toBe(hashText(p.script!));
  });
});

describe('writing', () => {
  it('only writes changed files and deletes removed shot files', async () => {
    const dir = tmpCopy();
    const { project } = await openProjectPath(dir);
    const shots = { ...project.shots };
    delete shots['match'];
    const next = {
      ...project,
      shots,
      ids: { ...project.ids, shots: project.ids.shots.filter((s) => s.id !== 'match') },
      timeline: {
        ...project.timeline,
        cues: project.timeline.cues.filter((c) => c.id !== 'maya-1' && c.id !== 'strike'),
      },
    };
    const res = await writeProjectToFolder(dir, next);
    expect(res.written.sort()).toEqual(['ids.json', 'manifest.json', 'timeline.json']);
    expect(res.deleted).toEqual(['shots/match.json']);
    expect(existsSync(join(dir, 'shots/match.json'))).toBe(false);
    const reloaded = await openProjectPath(dir);
    expect(reloaded.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(reloaded.project.manifest.modified).not.toBe(project.manifest.modified);
  });
});

describe('fountain import', () => {
  it('creates one shot per paragraph, scene headings joining the next paragraph', () => {
    const p = projectFromFountain(readFileSync(join(EXAMPLE, 'script.fountain'), 'utf8'));
    expect(p.manifest.title).toBe("The Keeper's Light");
    const lines = resolveLines(p);
    const texts = p.ids.shots.map((s) => s.lines.map((id) => lines.get(id)!.text));
    expect(texts[0]).toEqual([
      'EXT. LIGHTHOUSE - DUSK',
      'Waves crash against black rocks. At the top of the tower, the lamp is dark.',
    ]);
    expect(texts[1]).toEqual(['Every night for forty years, my grandfather lit the lamp.']);
    expect(texts.at(-1)).toEqual(['Some things are worth keeping.', 'FADE OUT.']);
    expect(validateProject(p).filter((i) => i.severity === 'error')).toEqual([]);
    const scenes = projectFromFountain(p.script!, { split: 'scene' });
    expect(scenes.ids.shots).toHaveLength(2);
  });
});

describe('animatic', () => {
  it('lays out shots, lines and cues', async () => {
    const { project } = await openProjectPath(EXAMPLE);
    const a = buildAnimatic(project);
    expect(a.shots.map((s) => s.id)).toEqual(['opening', 'climb', 'match', 'lamp']);
    for (let i = 1; i < a.shots.length; i++) expect(a.shots[i]!.start).toBe(a.shots[i - 1]!.end);
    const lamp = a.shots.find((s) => s.id === 'lamp')!;
    expect(lamp.end - lamp.start).toBeCloseTo(7, 5);
    const vo1 = a.cues.find((c) => c.id === 'vo-1')!;
    const voLine = a.shots[0]!.lines[2]!;
    expect(vo1.start).toBe(voLine.start);
    expect(voLine.estimated).toBe(false);
    expect(voLine.end - voLine.start).toBeCloseTo(2.2, 5);
    const theme = a.cues.find((c) => c.id === 'theme')!;
    expect(theme.start).toBe(0);
    expect(theme.end).toBe(a.duration);
    expect(theme.loop).toBe(true);
    const strike = a.cues.find((c) => c.id === 'strike')!;
    expect(strike.end - strike.start).toBeCloseTo(0.8, 2);
  });
});
