<script lang="ts">
  // Storyboard sheets for printing / PDF. Rendered instead of the editor while print mode is on
  // (File → Export PDF, or `?print=1` from `sbd export-pdf`). Sizes are in millimetres so the
  // screen preview matches the printed page.
  import {
    activeVariant,
    aspectValue,
    buildAnimatic,
    shotSegments,
    stripEmphasis,
    type Asset,
    type ResolvedLine,
    type Shot,
    type ShotRef,
  } from '@storyboard-viewer/format';
  import { tick } from 'svelte';
  import {
    formatSeconds,
    gridShape,
    pageOrientation,
    printParams,
    PRINT_FOOTER,
    type PrintOptions,
  } from '../lib/print';
  import { app } from '../lib/state.svelte';
  import Composition from './Composition.svelte';

  let {
    options,
    chrome = true,
    onOptions,
    onClose,
  }: {
    options: PrintOptions;
    chrome?: boolean;
    onOptions?: () => void;
    onClose?: () => void;
  } = $props();

  const PAPER = { letter: [279.4, 215.9], a4: [297, 210] } as const;
  const MARGIN = 10; // mm, all sides
  const FOOTER = 6; // mm reserved at the bottom of each sheet for page info

  const project = $derived(app.project!);
  const manifest = $derived(project.manifest);
  const aspect = $derived(aspectValue(manifest.aspect_ratio));
  const orientation = $derived(pageOrientation(options));
  const page = $derived.by(() => {
    const [long, short] = PAPER[options.paper];
    const [w, h] = orientation === 'landscape' ? [long, short] : [short, long];
    return { w, h, cw: w - 2 * MARGIN, ch: h - 2 * MARGIN - FOOTER };
  });
  const animatic = $derived(buildAnimatic(project));
  const timing = $derived(new Map(animatic.shots.map((s) => [s.id, s.end - s.start])));

  interface Item {
    ref: ShotRef;
    shot: Shot;
    number: number;
  }
  const items = $derived<Item[]>(
    project.ids.shots
      .map((ref, i) => ({ ref, shot: project.shots[ref.id]!, number: i + 1 }))
      .filter((x) => x.shot),
  );

  const fieldDefs = $derived(
    (manifest.shot_fields ?? []).filter((f) => f.id !== 'notes').map((f) => [f.id, f.label]),
  );

  function fieldRows(shot: Shot): Array<[string, string]> {
    const values = shot.fields ?? {};
    const known = new Set(fieldDefs.map(([id]) => id));
    const out: Array<[string, string]> = [];
    for (const [id, label] of fieldDefs) {
      const v = values[id!];
      if (v !== undefined && v !== null && v !== '') out.push([label!, String(v)]);
    }
    for (const [id, v] of Object.entries(values)) {
      if (id === 'notes' || known.has(id) || v === null || v === '') continue;
      out.push([id.replace(/_/g, ' '), String(v)]);
    }
    return out;
  }

  interface Line {
    id: string;
    type: string;
    text: string;
    cue: string | null;
  }
  function lines(ref: ShotRef): Line[] {
    const out: Line[] = [];
    let prev: ResolvedLine | undefined;
    const textOf = (id: string) => (app.lines.get(id) as ResolvedLine | undefined)?.text;
    // only the words the shot covers (a shot may be part of a line)
    for (const seg of shotSegments(ref, textOf)) {
      const id = seg.line;
      const l = app.lines.get(id) as ResolvedLine | undefined;
      if (!l) continue;
      const el = l.element;
      let cue: string | null = null;
      if (el?.character && seg.from === 0) {
        const same =
          prev?.element?.character === el.character && prev.element.endLine + 1 === el.startLine;
        if (!same) cue = el.extension ? `${el.character} (${el.extension})` : el.character;
      }
      const words = l.text.slice(seg.from, seg.to).trim();
      const text = seg.whole
        ? l.text
        : `${seg.from > 0 ? '…' : ''}${words}${seg.to < l.text.length ? '…' : ''}`;
      out.push({ id, type: l.type ?? 'action', text: stripEmphasis(text), cue });
      prev = l;
    }
    return out;
  }

  // --- layout
  const grid = $derived.by(() => {
    const { cols, rows } = gridShape(options.perPage, aspect);
    const gap = 5;
    const header = 9;
    const cellW = (page.cw - gap * (cols - 1)) / cols;
    const cellH = (page.ch - header - gap * (rows - 1)) / rows;
    const textShare = options.lines || options.fields || options.notes ? 0.62 : 0.86;
    let frameW = cellW;
    let frameH = frameW / aspect;
    const maxH = (cellH - 5) * textShare;
    if (frameH > maxH) {
      frameH = maxH;
      frameW = frameH * aspect;
    }
    return { cols, rows, gap, header, cellW, cellH, frameW, frameH };
  });
  const rowFrame = $derived.by(() => {
    let w = page.cw * (aspect < 1 ? 0.3 : 0.46);
    let h = w / aspect;
    const maxH = page.ch * 0.42;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    return { w, h };
  });
  const pages = $derived.by(() => {
    if (options.layout !== 'grid') return [items];
    const per = grid.cols * grid.rows;
    const out: Item[][] = [];
    for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
    return out.length ? out : [[]];
  });

  const totalPages = $derived((options.titlePage ? 1 : 0) + pages.length);

  const pageCss = $derived.by(() => {
    // Flowing (rows) layout: page numbers come from CSS page margin boxes.
    const boxes =
      options.layout === 'rows'
        ? `@bottom-left { content: ${JSON.stringify(manifest.title).replace(/</g, '\\3c ')}; font: 7pt system-ui, sans-serif; color: ${PRINT_FOOTER}; }` +
          `@bottom-right { content: counter(page) " / " counter(pages); font: 7pt system-ui, sans-serif; color: ${PRINT_FOOTER}; }`
        : '';
    return (
      `@page { size: ${options.paper} ${orientation}; margin: ${MARGIN}mm; ${boxes} }` +
      `@media print { html, body { background: var(--print-paper) !important; } }`
    );
  });

  // --- media (images and video posters; canvases use the DOM compositor)
  function frameAsset(shot: Shot): { asset?: Asset; video?: boolean } | null {
    const v = activeVariant(shot);
    if (!v) return null;
    if (v.type === 'image') {
      const a = app.assets.get(v.asset);
      if (a?.kind === 'video' && a.poster) return { asset: { ...a, kind: 'image', src: a.poster } };
      return { asset: a, video: a?.kind === 'video' };
    }
    return null;
  }

  // --- readiness: every image decoded, every video has a frame (for `sbd export-pdf`)
  let root = $state<HTMLElement>();
  let ready = $state(false);
  $effect(() => {
    void project;
    void options;
    ready = false;
    let cancelled = false;
    void (async () => {
      await tick();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const el = root;
      if (!el) return;
      const waits: Promise<unknown>[] = [];
      for (const img of el.querySelectorAll('img')) waits.push(img.decode().catch(() => {}));
      for (const v of el.querySelectorAll('video')) {
        if (v.readyState >= 2) continue;
        waits.push(
          new Promise((r) => {
            v.addEventListener('loadeddata', r, { once: true });
            v.addEventListener('error', r, { once: true });
          }),
        );
      }
      // text layers redraw once their fonts are in
      waits.push(
        (async () => {
          for (let i = 0; i < 100; i++) {
            if (!el.querySelector('canvas.text-canvas:not([data-fonts="loaded"])')) return;
            await new Promise((r) => setTimeout(r, 50));
          }
        })(),
      );
      await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 15000))]);
      if (document.fonts?.ready) await document.fonts.ready;
      if (!cancelled) ready = true;
    })();
    return () => {
      cancelled = true;
    };
  });

  const today = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  function printNow() {
    window.print();
  }

  const shareUrl = $derived(`${location.pathname}?${printParams(options)}${location.hash}`);
</script>

<svelte:head>
  {@html `<style>${pageCss}</style>`}
</svelte:head>

{#snippet frame(item: Item, w: number, h: number)}
  {@const v = activeVariant(item.shot)}
  {@const fa = frameAsset(item.shot)}
  <div class="frame" style:width="{w}mm" style:height="{h}mm">
    {#if v?.type === 'canvas'}
      <Composition variant={v} />
    {:else if fa?.asset && app.mediaUrl(fa.asset.src)}
      {#if fa.video}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={app.mediaUrl(fa.asset.src)} muted preload="auto" playsinline></video>
      {:else}
        <img src={app.mediaUrl(fa.asset.src)} alt={item.shot.title ?? `Shot ${item.number}`} />
      {/if}
    {:else}
      <span class="blank">No image</span>
    {/if}
  </div>
{/snippet}

{#snippet details(item: Item)}
  {#if options.fields}
    {@const rows = fieldRows(item.shot)}
    {#if rows.length}
      <dl class="fields">
        {#each rows as [label, value] (label)}
          <div>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        {/each}
      </dl>
    {/if}
  {/if}
  {#if options.lines}
    {@const ls = lines(item.ref)}
    {#if ls.length}
      <div class="script">
        {#each ls as l (l.id)}
          {#if l.cue}<p class="cue">{l.cue}</p>{/if}
          <p class="line {l.type}">{l.text}</p>
        {/each}
      </div>
    {/if}
  {/if}
  {#if options.notes && item.shot.fields?.['notes']}
    <p class="notes">{item.shot.fields['notes']}</p>
  {/if}
{/snippet}

{#snippet heading(item: Item)}
  <div class="heading">
    <span class="num">{item.number}</span>
    <span class="title">{item.shot.title ?? ''}</span>
    <span class="dur">{formatSeconds(timing.get(item.ref.id) ?? 0)}</span>
  </div>
{/snippet}

<div class="print-mode" class:chrome>
  {#if chrome}
    <div class="toolbar no-print" role="toolbar" aria-label="Print preview">
      <strong>Print preview</strong>
      <span class="muted"
        >{options.layout === 'grid' ? `${options.perPage} shots per page` : 'One row per shot'} ·
        {options.paper === 'a4' ? 'A4' : 'Letter'} · {totalPages} page{totalPages > 1
          ? 's'
          : ''}</span
      >
      <span class="spacer"></span>
      <button type="button" class="btn" id="print-options" onclick={() => onOptions?.()}
        >Options…</button
      >
      <button type="button" class="btn primary" id="print-now" disabled={!ready} onclick={printNow}
        >{ready ? 'Print / Save as PDF' : 'Loading images…'}</button
      >
      <button type="button" class="btn" id="print-close" onclick={() => onClose?.()}
        >Close preview</button
      >
    </div>
    <p class="hint no-print muted">
      In the print dialog choose <strong>Save as PDF</strong>. Tip: if printing does not open here
      (some in-app browsers block it), open
      <a href={shareUrl} target="_blank" rel="noopener">this page</a> in Chrome, Edge or Safari.
    </p>
  {/if}

  <div
    class="sheets"
    bind:this={root}
    data-print-ready={ready ? 'true' : 'false'}
    data-pages={totalPages}
    style:--page-w="{page.w}mm"
    style:--page-h="{page.h}mm"
    style:--margin="{MARGIN}mm"
  >
    {#if options.titlePage}
      <section class="sheet title-page" aria-label="Title page">
        <div class="title-block">
          <p class="kicker">Storyboard</p>
          <h1>{manifest.title}</h1>
          {#if manifest.description}<p class="desc">{manifest.description}</p>{/if}
          {#if manifest.authors?.length}<p class="authors">by {manifest.authors.join(', ')}</p>{/if}
        </div>
        <dl class="facts">
          <div>
            <dt>Shots</dt>
            <dd>{items.length}</dd>
          </div>
          <div>
            <dt>Running time</dt>
            <dd>{formatSeconds(animatic.duration)}</dd>
          </div>
          <div>
            <dt>Frame</dt>
            <dd>{manifest.aspect_ratio ?? '16:9'} · {manifest.fps ?? 24} fps</dd>
          </div>
          <div>
            <dt>Printed</dt>
            <dd>{today}</dd>
          </div>
        </dl>
        <footer class="foot">
          <span>{manifest.title}</span><span>1 / {totalPages}</span>
        </footer>
      </section>
    {/if}

    {#if options.layout === 'grid'}
      {#each pages as shots, pi (pi)}
        <section class="sheet grid-page" aria-label="Page {pi + 1}">
          <header class="page-head" style:height="{grid.header}mm">
            <strong>{manifest.title}</strong>
            {#if shots.length}
              <span>Shots {shots[0]!.number}–{shots.at(-1)!.number} of {items.length}</span>
            {/if}
          </header>
          <div
            class="grid"
            style:grid-template-columns="repeat({grid.cols}, {grid.cellW}mm)"
            style:grid-template-rows="repeat({grid.rows}, {grid.cellH}mm)"
            style:gap="{grid.gap}mm"
          >
            {#each shots as item (item.ref.id)}
              <article class="cell" data-shot-id={item.ref.id}>
                {@render heading(item)}
                {@render frame(item, grid.frameW, grid.frameH)}
                <div class="text">{@render details(item)}</div>
              </article>
            {/each}
          </div>
          <footer class="foot">
            <span>{manifest.title}</span><span
              >{pi + 1 + (options.titlePage ? 1 : 0)} / {totalPages}</span
            >
          </footer>
        </section>
      {/each}
    {:else}
      <section class="sheet rows-page flow" aria-label="Shots">
        {#each items as item (item.ref.id)}
          <article class="row" data-shot-id={item.ref.id}>
            <div class="left" style:width="{rowFrame.w}mm">
              {@render heading(item)}
              {@render frame(item, rowFrame.w, rowFrame.h)}
            </div>
            <div class="text">{@render details(item)}</div>
          </article>
        {/each}
      </section>
    {/if}
  </div>
</div>

<style>
  .print-mode {
    min-height: 100%;
    background: var(--print-desk);
    color: var(--print-ink);
    padding-bottom: 40px;
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--surface);
    color: var(--fg);
    border-bottom: 1px solid var(--border);
  }
  .spacer {
    flex: 1;
  }
  .hint {
    max-width: 900px;
    margin: var(--space-3) auto 0;
    padding: 0 var(--space-4);
    font-size: 12px;
    color: var(--print-muted);
  }
  .sheets {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding-top: 16px;
    font-family: var(--font-sans);
    font-size: 8.5pt;
    line-height: 1.3;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    position: relative;
    width: var(--page-w);
    min-height: var(--page-h);
    padding: var(--margin);
    background: var(--print-paper);
    color: var(--print-ink);
    box-shadow: 0 2px 12px var(--print-shadow);
    display: flex;
    flex-direction: column;
  }
  .sheet:not(.flow) {
    height: var(--page-h);
    overflow: hidden;
  }
  .foot {
    position: absolute;
    left: var(--margin);
    right: var(--margin);
    bottom: calc(var(--margin) - 2mm);
    display: flex;
    justify-content: space-between;
    font-size: 7pt;
    color: var(--print-faint);
  }
  .flow .foot {
    display: none;
  }
  /* Title page */
  .title-page {
    justify-content: center;
  }
  .title-block {
    margin: auto 0 0;
  }
  .kicker {
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 9pt;
    color: var(--print-accent);
    margin: 0 0 4mm;
  }
  .title-page h1 {
    font-size: 30pt;
    line-height: 1.1;
    margin: 0 0 4mm;
  }
  .desc {
    font-size: 12pt;
    color: var(--print-ink-3);
    max-width: 160mm;
    margin: 0 0 3mm;
  }
  .authors {
    font-size: 11pt;
    color: var(--print-ink-3);
    margin: 0;
  }
  .facts {
    display: flex;
    gap: 12mm;
    margin: 14mm 0 auto;
    padding-top: 5mm;
    border-top: 0.3mm solid var(--print-rule);
  }
  .facts dt {
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--print-faint);
  }
  .facts dd {
    margin: 1mm 0 0;
    font-size: 11pt;
  }
  /* Grid pages */
  .page-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    font-size: 8pt;
    color: var(--print-muted);
  }
  .page-head strong {
    color: var(--print-ink);
  }
  .grid {
    display: grid;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 1.2mm;
    min-height: 0;
    overflow: hidden;
  }
  .cell .text {
    min-height: 0;
    overflow: hidden;
    /* Long text is cut at the cell edge: fade the last line instead of slicing it. */
    mask-image: linear-gradient(to bottom, var(--print-fade) calc(100% - 3.5mm), transparent);
  }
  .heading {
    display: flex;
    align-items: baseline;
    gap: 2mm;
    font-size: 8pt;
  }
  .num {
    font-weight: 700;
  }
  .heading .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--print-ink-2);
  }
  .dur {
    color: var(--print-faint);
    font-variant-numeric: tabular-nums;
  }
  .frame {
    position: relative;
    flex: none;
    background: var(--print-frame-bg);
    border: 0.25mm solid var(--print-frame);
    overflow: hidden;
    display: grid;
    align-items: center;
  }
  .frame img,
  .frame video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .blank {
    text-align: center;
    color: var(--print-faintest);
    font-size: 8pt;
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6mm 3mm;
    margin: 0 0 1mm;
    font-size: 7.5pt;
  }
  .fields div {
    display: flex;
    gap: 1mm;
  }
  .fields dt {
    color: var(--print-faint);
  }
  .fields dt::after {
    content: ':';
  }
  .fields dd {
    margin: 0;
  }
  .script p {
    margin: 0 0 0.6mm;
  }
  .script .cue {
    margin: 1mm 0 0;
    text-align: center;
    font-weight: 600;
    font-size: 7.5pt;
    letter-spacing: 0.03em;
  }
  .script .dialogue,
  .script .parenthetical {
    text-align: center;
    padding: 0 6%;
  }
  .script .parenthetical {
    color: var(--print-muted);
  }
  .script .scene_heading {
    font-weight: 700;
    text-transform: uppercase;
  }
  .script .transition {
    text-align: right;
    text-transform: uppercase;
  }
  .script .centered {
    text-align: center;
  }
  .notes {
    margin: 1mm 0 0;
    font-style: italic;
    color: var(--print-muted);
    white-space: pre-line;
  }
  /* Rows layout */
  .rows-page {
    gap: 5mm;
  }
  .row {
    display: flex;
    gap: 6mm;
    padding-bottom: 5mm;
    border-bottom: 0.25mm solid var(--print-rule-soft);
    break-inside: avoid;
  }
  .row .left {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 1.2mm;
  }
  .row .text {
    flex: 1;
    padding-top: 5mm;
    font-size: 9pt;
  }
  .row .script .dialogue,
  .row .script .parenthetical {
    padding: 0 12%;
  }

  @media print {
    .print-mode {
      background: var(--print-paper);
      padding: 0;
    }
    .no-print {
      display: none !important;
    }
    .sheets {
      display: block;
      padding: 0;
    }
    .sheet {
      width: auto;
      min-height: 0;
      padding: 0;
      box-shadow: none;
    }
    .sheet:not(.flow) {
      height: calc(var(--page-h) - 2 * var(--margin));
      break-after: page;
    }
    .sheet:last-child {
      break-after: auto;
    }
    .foot {
      left: 0;
      right: 0;
      bottom: 0;
    }
    .frame {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
