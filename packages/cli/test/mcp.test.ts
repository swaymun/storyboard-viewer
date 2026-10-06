import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { packSbd } from '@storyboard-viewer/format';
import { openProjectPath, readFolderTree } from '@storyboard-viewer/format/node';
import { createMcpSession, ProjectStore, startServer, type McpOptions } from '../src/index.js';
import { EXAMPLE, exampleCopy, getJson } from './helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).toReversed()) await c();
});

async function connect(opts: McpOptions = {}) {
  const session = await createMcpSession(opts);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([session.server.connect(a), client.connect(b)]);
  cleanups.push(
    () => client.close(),
    () => session.close(),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    const textOut = res.content[0]!.text;
    let json: Record<string, any> | undefined;
    try {
      json = JSON.parse(textOut);
    } catch {
      json = undefined;
    }
    return { isError: res.isError ?? false, text: textOut, json: json as Record<string, any> };
  };
  return { session, client, call };
}

describe('MCP server', () => {
  it('lists all tools with descriptions', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of [
      'open_storyboard',
      'get_storyboard',
      'list_shots',
      'get_shot',
      'add_shot',
      'update_shot',
      'move_shot',
      'remove_shot',
      'set_lines',
      'add_asset',
      'add_variant',
      'set_active_variant',
      'add_cue',
      'update_cue',
      'remove_cue',
      'validate',
      'get_viewer_url',
      'update_variant',
      'list_layouts',
      'apply_layout',
      'fill_slot',
      'add_text_layer',
      'add_layer',
      'update_layer',
      'remove_layer',
    ])
      expect(names).toContain(n);
    for (const t of tools) expect(t.description!.length).toBeGreaterThan(20);
  });

  it('asks to open a storyboard first', async () => {
    const { call } = await connect();
    const r = await call('list_shots');
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/open_storyboard/);
  });

  it('opens and reads a storyboard', async () => {
    const { call } = await connect();
    const o = await call('open_storyboard', { path: EXAMPLE });
    expect(o.isError).toBe(false);
    expect(o.json.title).toBe("The Keeper's Light");
    expect(o.json.shots.map((s: { id: string }) => s.id)).toEqual([
      'opening',
      'climb',
      'match',
      'lamp',
    ]);
    const list = await call('list_shots');
    const match = list.json.shots[2];
    expect(match.lines[0]).toMatchObject({
      type: 'parenthetical',
      character: 'MAYA',
      text: '(whispering)',
    });
    const shot = await call('get_shot', { shot_id: 'climb' });
    expect(shot.json.variants[0].layers).toHaveLength(3);
    const script = await call('get_script');
    expect(script.json.lines.every((l: { shot: string | null }) => l.shot)).toBe(true);
    const v = await call('validate');
    expect(v.json.valid).toBe(true);
  });

  it('runs a full editing session and writes to disk', async () => {
    const ex = exampleCopy();
    cleanups.push(ex.cleanup);
    const { call } = await connect({ path: ex.dir });

    const added = await call('add_shot', {
      id: 'gulls',
      title: 'Gulls',
      after: 'climb',
      fields: { camera: 'Wide', mood: 'calm' },
      script_text: 'Gulls circle the tower.',
    });
    expect(added.isError).toBe(false);
    expect(added.json.shot.lines[0].text).toBe('Gulls circle the tower.');
    const newLine = added.json.new_lines[0].id;
    expect(readFileSync(join(ex.dir, 'script.fountain'), 'utf8')).toContain(
      'Gulls circle the tower.',
    );
    expect(existsSync(join(ex.dir, 'shots/gulls.json'))).toBe(true);

    const asset = await call('add_asset', {
      path: join(EXAMPLE, 'media/opening-sketch.png'),
      name: 'Gull sketch',
      category: 'location',
      tags: ['birds'],
    });
    expect(asset.isError).toBe(false);
    expect(asset.json.asset).toMatchObject({
      name: 'Gull sketch',
      kind: 'image',
      width: 640,
      height: 360,
      src: 'media/gull-sketch.png',
    });
    expect(existsSync(join(ex.dir, 'media/gull-sketch.png'))).toBe(true);
    const assetId = asset.json.asset.id;

    const linked = await call('add_asset', {
      path: join(EXAMPLE, 'media/lamp-sweep.mp4'),
      mode: 'link',
      id: 'ext-clip',
    });
    expect(linked.json.asset.src).toMatch(/^file:.*lamp-sweep\.mp4$/);

    const variant = await call('add_variant', {
      shot_id: 'gulls',
      asset_id: assetId,
      name: 'Sketch',
    });
    expect(variant.json.shot.active_variant).toBe(variant.json.variant_id);
    const canvas = await call('add_variant', {
      shot_id: 'gulls',
      layers: [
        { asset: 'lantern-room', scale_x: 2, scale_y: 2 },
        { asset: assetId, x: 100, opacity: 0.5 },
      ],
      activate: false,
    });
    expect(canvas.isError).toBe(false);
    const active = await call('set_active_variant', {
      shot_id: 'gulls',
      variant_id: canvas.json.variant_id,
    });
    expect(active.json.active_variant).toBe(canvas.json.variant_id);

    const cue = await call('add_cue', {
      asset_id: 'dialogue',
      line_id: newLine,
      in: 0.5,
      out: 1.5,
      track: 'dialogue',
    });
    if (cue.isError) throw new Error(cue.text);
    expect(cue.json.cue).toMatchObject({
      asset: 'dialogue',
      in: 0.5,
      out: 1.5,
      target: { line: newLine },
    });
    const upd = await call('update_cue', {
      cue_id: cue.json.cue.id,
      gain: 0.7,
      shot_id: 'gulls',
      label: null,
    });
    if (upd.isError) throw new Error(upd.text);
    expect(upd.json.cue).toMatchObject({ gain: 0.7, target: { shot: 'gulls' } });
    const bad = await call('add_cue', { asset_id: 'dialogue', line_id: newLine, shot_id: 'gulls' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/exactly one target/);
    expect((await call('remove_cue', { cue_id: cue.json.cue.id })).isError).toBe(false);

    const upShot = await call('update_shot', {
      shot_id: 'gulls',
      fields: { mood: null, notes: 'Hold' },
      duration: 2,
    });
    expect(upShot.json.shot.fields).toEqual({ camera: 'Wide', notes: 'Hold' });
    const moved = await call('move_shot', { shot_id: 'gulls', index: 0 });
    expect(moved.json.order[0]).toBe('gulls');
    // the shot's lines moved with it: its line is now the first line of the script
    const afterMove = await call('get_script', {});
    expect(afterMove.json.lines[0]).toMatchObject({ id: newLine, shot: 'gulls' });
    const orderOnly = await call('move_shot', {
      shot_id: 'gulls',
      index: 1,
      move_lines: false,
    });
    expect(orderOnly.json.order[1]).toBe('gulls');
    expect((await call('get_script', {})).json.lines[0].id).toBe(newLine);
    await call('move_shot', { shot_id: 'gulls', index: 0 });

    const ins = await call('insert_lines', { text: 'MAYA\nHello up there.', after_line: newLine });
    expect(ins.json.new_lines[0]).toMatchObject({
      type: 'dialogue',
      character: 'MAYA',
      text: 'Hello up there.',
    });
    const upLine = await call('update_line', {
      line_id: newLine,
      text: 'Gulls wheel around the tower.',
    });
    expect(upLine.json.line.text).toBe('Gulls wheel around the tower.');
    const lines = await call('set_lines', { shot_id: 'gulls', line_ids: [newLine] });
    expect(lines.json.shot.lines).toHaveLength(1);
    const rmLines = await call('remove_lines', { line_ids: [ins.json.new_lines[0].id] });
    expect(rmLines.json.removed).toHaveLength(1);

    const rmShot = await call('remove_shot', { shot_id: 'gulls' });
    expect(rmShot.json.order).toEqual(['opening', 'climb', 'match', 'lamp']);
    expect(existsSync(join(ex.dir, 'shots/gulls.json'))).toBe(false);

    const inUse = await call('remove_asset', { asset_id: 'maya' });
    expect(inUse.isError).toBe(true);
    expect(inUse.text).toMatch(/still used/);

    const v = await call('validate');
    expect(v.json.valid).toBe(true);
  });

  it('makes shots on parts of a line (text / offsets), splits and reports them', async () => {
    const ex = exampleCopy();
    cleanups.push(ex.cleanup);
    const { call } = await connect({ path: ex.dir });
    const script = await call('get_script');
    const line = script.json.lines.find((l: { text: string }) => l.text.startsWith('Waves crash'))
      .id as string;

    const rocks = await call('add_shot', { id: 'rocks', line_ids: [line], text: 'black rocks' });
    expect(rocks.isError).toBe(false);
    expect(rocks.json.shot.span.text).toBe('black rocks');
    const lamp = await call('add_shot', {
      id: 'lamp-dark',
      line_ids: [line],
      start_offset: 'Waves crash against black rocks. '.length,
    });
    expect(lamp.json.shot.span.text).toBe('At the top of the tower, the lamp is dark.');
    // the line now holds parts of three shots (opening keeps "Waves crash against ")
    const after = await call('get_script');
    const entry = after.json.lines.find((l: { id: string }) => l.id === line);
    expect(entry.shots.map((x: { shot: string }) => x.shot)).toEqual([
      'opening',
      'rocks',
      'lamp-dark',
    ]);
    expect(entry.shots[1]).toMatchObject({ from: 20, to: 31 });

    const moved = await call('set_lines', {
      shot_id: 'rocks',
      line_ids: [line],
      text: 'Waves crash',
    });
    expect(moved.json.shot.span.text).toBe('Waves crash');
    const missing = await call('set_lines', { shot_id: 'rocks', line_ids: [line], text: 'whales' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/not in line/);

    const split = await call('split_shot', {
      shot_id: 'lamp-dark',
      line_id: line,
      text: 'the lamp',
      new_id: 'lamp-on',
    });
    expect(split.isError).toBe(false);
    expect(split.json.new_shot.span.text).toBe('the lamp is dark.');
    expect(split.json.shot.span.text).toBe('At the top of the tower, ');

    // the files: format 0.2, offsets in ids.json, valid
    const ids = JSON.parse(readFileSync(join(ex.dir, 'ids.json'), 'utf8'));
    expect(ids.shots.find((x: { id: string }) => x.id === 'lamp-on')).toMatchObject({
      lines: [line],
      start: { line, offset: 'Waves crash against black rocks. At the top of the tower, '.length },
    });
    const manifest = JSON.parse(readFileSync(join(ex.dir, 'manifest.json'), 'utf8'));
    expect(manifest.format_version).toBe('0.2.0');
    const v = await call('validate');
    expect(v.json.valid).toBe(true);

    // an agent edit of the line keeps every shot on its words
    const upd = await call('update_line', {
      line_id: line,
      text: 'Cold waves crash against black rocks. At the top of the tower, the old lamp is dark.',
    });
    expect(upd.isError).toBe(false);
    const shots = await call('list_shots');
    const span = (id: string) =>
      shots.json.shots.find((x: { id: string }) => x.id === id).span?.text;
    expect(span('lamp-on')).toBe('the old lamp is dark.');
    expect(span('lamp-dark')).toBe('At the top of the tower, ');
  });

  it('lays out a vertical shot: layout, slots, captions, layers', async () => {
    const work = mkdtempSync(join(tmpdir(), 'sbd-mcp-'));
    cleanups.push(() => rmSync(work, { recursive: true, force: true }));
    const { call } = await connect();
    const path = join(work, 'reel.sbd');
    expect(
      (await call('open_storyboard', { path, create: true, preset: 'vertical' })).isError,
    ).toBe(false);
    const pic = (await call('add_asset', { path: join(EXAMPLE, 'media/maya.png'), id: 'maya' }))
      .json;
    expect(pic.ok).toBe(true);
    await call('add_asset', { path: join(EXAMPLE, 'media/lamp.png'), id: 'lamp' });
    await call('add_shot', { id: 'hook', title: 'Hook' });
    const layouts = (await call('list_layouts')).json;
    expect(layouts.frame).toEqual({ width: 1080, height: 1920 });
    expect(layouts.layouts.map((l: { id: string }) => l.id)).toContain('split');
    expect(layouts.caption_styles.map((c: { id: string }) => c.id)).toContain('bold');

    const applied = await call('apply_layout', {
      shot_id: 'hook',
      layout: 'split',
      images: ['lamp'],
    });
    expect(applied.isError).toBe(false);
    const vid = applied.json.variant_id;
    const slots = applied.json.shot.variants[0].layers;
    expect(slots.map((l: { id: string }) => l.id)).toEqual(['top', 'bottom']);
    expect(slots[0]).toMatchObject({ asset: 'lamp', slot: { name: 'Top' } });
    expect(slots[1]).toMatchObject({ kind: 'slot', name: 'Bottom' });

    const filled = await call('fill_slot', { shot_id: 'hook', slot: 'Bottom', asset_id: 'maya' });
    expect(filled.isError).toBe(false);
    expect(filled.json.layers[1]).toMatchObject({ id: 'bottom', asset: 'maya' });

    const caption = await call('add_text_layer', {
      shot_id: 'hook',
      text: 'My cat did WHAT?',
      style: 'bold',
      position: 'top',
    });
    expect(caption.isError).toBe(false);
    expect(caption.json.layer).toMatchObject({ kind: 'text', font: 'Montserrat', style: 'bold' });
    const textId = caption.json.layer.id;

    const upd = await call('update_layer', {
      shot_id: 'hook',
      layer_id: textId,
      changes: { color: '#ffe600', stroke: null },
      index: 0,
    });
    expect(upd.isError).toBe(false);
    expect(upd.json.layers[0]).toMatchObject({ id: textId, color: '#ffe600' });
    expect(upd.json.layers[0].stroke).toBeUndefined();

    const rm = await call('remove_layer', { shot_id: 'hook', layer_ids: [textId] });
    expect(rm.json.layers).toHaveLength(2);
    const bad = await call('add_layer', { shot_id: 'hook', layer: { kind: 'text' } });
    expect(bad.isError).toBe(true);
    const ren = await call('update_variant', {
      shot_id: 'hook',
      variant_id: vid,
      name: 'Reaction',
      background: '#000000',
    });
    expect(ren.json.shot.variants[0]).toMatchObject({ name: 'Reaction', background: '#000000' });
    const v = await call('validate');
    expect(v.json.valid).toBe(true);
    const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8'));
    expect(manifest.format_version).toBe('0.3.0');
  });

  it('edits a packed .sbd in place (same atomic re-pack as the viewer)', async () => {
    const ex = exampleCopy();
    cleanups.push(ex.cleanup);
    const file = join(ex.work, 'story-packed.sbd');
    writeFileSync(file, packSbd(await readFolderTree(ex.dir)));
    const original = readFileSync(file);
    const { call } = await connect();
    const o = await call('open_storyboard', { path: file });
    expect(o.json.form).toMatch(/packed/);
    const r = await call('update_shot', { shot_id: 'climb', title: 'Edited packed' });
    expect(r.isError).toBe(false);
    const a = await call('add_asset', { path: join(EXAMPLE, 'media/lamp.png'), id: 'lamp-2' });
    expect(a.isError).toBe(false);
    expect(a.json.asset.src).toBe('media/lamp.png'.replace('lamp', 'lamp-2'));
    const reopened = await openProjectPath(file);
    await reopened.close();
    expect(reopened.project.shots['climb']!.title).toBe('Edited packed');
    expect(reopened.files).toContain('media/lamp-2.png');
    expect(readFileSync(`${file}.bak`)).toEqual(original);
    expect((await call('validate')).json.valid).toBe(true);
  });

  it('rejects edits that would break the storyboard and keeps files unchanged', async () => {
    const ex = exampleCopy();
    cleanups.push(ex.cleanup);
    const { call } = await connect({ path: ex.dir });
    const before = readFileSync(join(ex.dir, 'ids.json'), 'utf8');
    const r = await call('update_shot', { shot_id: 'nope', title: 'x' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Unknown shot "nope"/);
    const v = await call('add_variant', { shot_id: 'opening', asset_id: 'dialogue' });
    expect(v.isError).toBe(true);
    expect(v.text).toMatch(/not saved|expected image/);
    expect(readFileSync(join(ex.dir, 'ids.json'), 'utf8')).toBe(before);
  });

  it('creates a new storyboard and serves the viewer from the same process (--serve)', async () => {
    const ex = exampleCopy();
    cleanups.push(ex.cleanup);
    const { call, session } = await connect({ serve: { port: 0 } });
    const dir = join(ex.work, 'new.sbd');
    const o = await call('open_storyboard', {
      path: dir,
      create: true,
      title: 'Fresh',
      preset: 'documentary',
    });
    expect(o.isError).toBe(false);
    expect(o.json.preset).toBe('documentary');
    const url = await call('get_viewer_url');
    expect(url.json.url).toMatch(/^http:\/\/localhost:\d+\/$/);
    const health = await getJson(`${url.json.url}api/health`);
    expect(health.path).toBe(session.store()!.path);
    const add = await call('add_shot', {
      title: 'Interview',
      fields: { source: 'Interview', lower_third: 'Dr. Ada' },
    });
    expect(add.isError).toBe(false);
    const project = await getJson(`${url.json.url}api/project`);
    expect(project.project.ids.shots).toHaveLength(1);
  });
});

describe('--serve port fallback', () => {
  it('uses the next free port when the preferred one is taken', async () => {
    const ex = exampleCopy();
    cleanups.push(ex.cleanup);
    const blocker = await startServer(ProjectStore.open(ex.dir), {
      port: 0,
      webRoot: null,
      register: false,
    });
    cleanups.push(() => blocker.close());
    const { call } = await connect({ serve: { port: blocker.port } });
    expect((await call('open_storyboard', { path: ex.dir })).isError).toBe(false);
    const url = (await call('get_viewer_url')).json.url as string;
    expect(Number(new URL(url).port)).toBeGreaterThan(blocker.port);
  });
});

describe('get_viewer_url', () => {
  it('finds an `sbd serve` running in another process (registry in the temp dir)', async () => {
    const ex = exampleCopy();
    cleanups.push(ex.cleanup);
    const srv = await startServer(ProjectStore.open(ex.dir), { port: 0, webRoot: null });
    cleanups.push(() => srv.close());
    const { call } = await connect({ path: ex.dir });
    expect((await call('get_viewer_url')).json.url).toBe(srv.url);
  });
});

describe('sbd mcp over stdio (built CLI)', () => {
  const cli = join(EXAMPLE, '../../packages/cli/dist/cli.js');
  it.skipIf(!existsSync(cli))('answers tool calls over stdio', async () => {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'mcp', EXAMPLE],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test', version: '0.0.0' });
    await client.connect(transport);
    cleanups.push(() => client.close());
    const res = (await client.callTool({ name: 'get_storyboard', arguments: {} })) as {
      content: Array<{ text: string }>;
    };
    expect(JSON.parse(res.content[0]!.text).title).toBe("The Keeper's Light");
  });
});
