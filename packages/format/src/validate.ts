/**
 * Validation: JSON Schema per file (via @cfworker/json-schema, no code generation, so it runs in
 * Node, browsers and service workers) plus referential integrity across files.
 */
import { shotSegments } from './spans.js';
import { Validator, type OutputUnit } from '@cfworker/json-schema';
import { classifySrc, playabilityWarning } from './media.js';
import { SCHEMAS, type SchemaName } from './schemas.gen.js';
import {
  KNOWN_FILTERS,
  layerKind,
  isGlobalTarget,
  isLineTarget,
  isRangeTarget,
  isShotTarget,
  type SbdProject,
} from './types.js';
import { hashText } from './hash.js';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  /** Stable machine-readable code, e.g. `schema`, `missing-asset`, `missing-media`. */
  code: string;
  message: string;
  /** Package-relative file the issue is about. */
  file?: string;
  /** JSON pointer inside the file (`/variants/0/asset`). */
  pointer?: string;
}

export const SCHEMA_FILES: Record<SchemaName, string> = {
  manifest: 'manifest.json',
  ids: 'ids.json',
  shot: 'shots/<id>.json',
  assets: 'assets.json',
  timeline: 'timeline.json',
};

const validators = new Map<SchemaName, Validator>();

function validatorFor(name: SchemaName): Validator {
  let v = validators.get(name);
  if (!v) {
    v = new Validator(SCHEMAS[name] as never, '2020-12', false);
    validators.set(name, v);
  }
  return v;
}

const STRUCTURAL = new Set(['properties', 'items', 'prefixItems', '$ref', 'allOf', 'then', 'if']);

function friendly(unit: OutputUnit): string {
  if (unit.keyword === 'oneOf' && unit.instanceLocation.endsWith('/target')) {
    return 'target must be exactly one of {"line": id}, {"shot": id}, {"range": [from, to]} or {"global": {"start": seconds}}';
  }
  if (unit.keyword === 'anyOf' && /\/(src|poster)$/.test(unit.instanceLocation)) {
    return 'src must be "media/<file>" (embedded), "file:<relative path>" (linked) or an http(s):// URL';
  }
  if (
    unit.keyword === 'pattern' &&
    /\/(id|asset|lines\/\d+|line|shot|preview)$/.test(unit.instanceLocation)
  ) {
    return 'IDs may use letters, digits, "_", "-" and "." (max 64 chars, must start with a letter or digit)';
  }
  return unit.error;
}

/** Validates one file's JSON against its schema. */
export function validateSchema(
  name: SchemaName,
  data: unknown,
  file = SCHEMA_FILES[name],
): Issue[] {
  const result = validatorFor(name).validate(data);
  if (result.valid) return [];
  const units = result.errors;
  // Drop structural wrappers and errors from inside oneOf/anyOf branches (their summary is kept).
  const branchRoots = units
    .filter((u) => u.keyword === 'oneOf' || u.keyword === 'anyOf')
    .map((u) => u.keywordLocation + '/');
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const u of units) {
    if (STRUCTURAL.has(u.keyword)) continue;
    if (
      u.keyword === 'additionalProperties' &&
      units.some((o) => o.instanceLocation.startsWith(u.instanceLocation + '/'))
    )
      continue;
    if (branchRoots.some((r) => u.keywordLocation.startsWith(r))) continue;
    const pointer = u.instanceLocation.replace(/^#/, '') || '/';
    const message = friendly(u);
    const key = `${pointer}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      severity: 'error',
      code: 'schema',
      message: `${pointer}: ${message}`,
      file,
      pointer,
    });
  }
  return issues;
}

export interface ValidateOptions {
  /** Whether a package file exists (`media/foo.png`). Omit to skip embedded-media checks. */
  hasFile?: (path: string) => boolean;
  /** Whether a linked `file:` source exists; undefined = unknown (skipped). */
  linkedExists?: (src: string) => boolean | undefined;
  /** Files present under `shots/` (to report orphans). */
  shotFiles?: string[];
}

/** Schema + referential-integrity validation of a whole project. Errors make the project invalid. */
export function validateProject(p: SbdProject, opts: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (
    severity: Severity,
    code: string,
    message: string,
    file?: string,
    pointer?: string,
  ) => {
    const issue: Issue = { severity, code, message };
    if (file !== undefined) issue.file = file;
    if (pointer !== undefined) issue.pointer = pointer;
    issues.push(issue);
  };

  issues.push(...validateSchema('manifest', p.manifest));
  issues.push(...validateSchema('ids', p.ids));
  issues.push(...validateSchema('assets', p.assets));
  issues.push(...validateSchema('timeline', p.timeline));
  for (const [id, shot] of Object.entries(p.shots)) {
    issues.push(...validateSchema('shot', shot, `shots/${id}.json`));
  }
  if (issues.some((i) => i.severity === 'error')) {
    // Referential checks assume the basic shapes are right.
    return issues;
  }

  const major = Number(p.manifest.format_version.split('.')[0]);
  if (major > 0) {
    add(
      'warning',
      'newer-version',
      `format_version ${p.manifest.format_version} is newer than this reader (0.x); unknown fields are ignored`,
      'manifest.json',
      '/format_version',
    );
  }

  // --- lines
  const lineIds = new Set<string>();
  p.ids.lines.forEach((l, i) => {
    if (lineIds.has(l.id))
      add('error', 'duplicate-id', `duplicate line ID "${l.id}"`, 'ids.json', `/lines/${i}/id`);
    lineIds.add(l.id);
    if (l.ordinal !== i)
      add(
        'warning',
        'line-ordinal',
        `line "${l.id}" has ordinal ${l.ordinal}, expected ${i}`,
        'ids.json',
        `/lines/${i}/ordinal`,
      );
  });
  if (p.script === null && p.ids.lines.length) {
    add(
      'warning',
      'no-script',
      'ids.json lists script lines but script.fountain is missing',
      'ids.json',
      '/lines',
    );
  }
  if (p.script !== null && p.ids.script_hash && p.ids.script_hash !== hashText(p.script)) {
    add(
      'info',
      'script-changed',
      'script.fountain changed since ids.json was written; line IDs were re-anchored',
      'ids.json',
      '/script_hash',
    );
  }

  // --- shots
  const shotIds = new Set<string>();
  const lineText = new Map(p.ids.lines.map((l) => [l.id, l.text]));
  const covered = new Map<string, Array<{ shot: string; from: number; to: number }>>();
  p.ids.shots.forEach((ref, i) => {
    if (shotIds.has(ref.id))
      add('error', 'duplicate-id', `duplicate shot ID "${ref.id}"`, 'ids.json', `/shots/${i}/id`);
    shotIds.add(ref.id);
    if (!p.shots[ref.id])
      add(
        'error',
        'missing-shot-file',
        `shot "${ref.id}" has no shots/${ref.id}.json`,
        'ids.json',
        `/shots/${i}`,
      );
    ref.lines.forEach((lid, j) => {
      if (!lineIds.has(lid)) {
        add(
          'error',
          'missing-line',
          `shot "${ref.id}" references unknown line "${lid}"`,
          'ids.json',
          `/shots/${i}/lines/${j}`,
        );
        return;
      }
    });
    // format 0.2 character spans
    for (const which of ['start', 'end'] as const) {
      const pt = ref[which];
      if (!pt) continue;
      const edge = which === 'start' ? ref.lines[0] : ref.lines.at(-1);
      if (pt.line !== edge) {
        add(
          'error',
          'span-line',
          `shot "${ref.id}" ${which} is on line "${pt.line}", which is not its ${which === 'start' ? 'first' : 'last'} line`,
          'ids.json',
          `/shots/${i}/${which}`,
        );
        continue;
      }
      const len = lineText.get(pt.line)?.length;
      if (len !== undefined && pt.offset > len)
        add(
          'warning',
          'span-offset',
          `shot "${ref.id}" ${which} offset ${pt.offset} is past the end of line "${pt.line}" (${len} characters)`,
          'ids.json',
          `/shots/${i}/${which}/offset`,
        );
    }
    if (
      ref.lines.length === 1 &&
      ref.start &&
      ref.end &&
      ref.start.line === ref.end.line &&
      ref.end.offset <= ref.start.offset
    )
      add(
        'error',
        'span-empty',
        `shot "${ref.id}" ends before it starts (offsets ${ref.start.offset}…${ref.end.offset})`,
        'ids.json',
        `/shots/${i}`,
      );
    for (const seg of shotSegments(ref, (id) => lineText.get(id))) {
      if (!lineIds.has(seg.line)) continue;
      const list = covered.get(seg.line) ?? [];
      const clash = list.find((x) => x.shot !== ref.id && seg.from < x.to && x.from < seg.to);
      const j = ref.lines.indexOf(seg.line);
      if (clash || (list.length && seg.from === seg.to && list.some((x) => x.shot !== ref.id)))
        add(
          'warning',
          'shared-line',
          `line "${seg.line}" is in shots "${(clash ?? list[0])!.shot}" and "${ref.id}"${seg.whole ? '' : ' (overlapping text)'}`,
          'ids.json',
          `/shots/${i}/lines/${j}`,
        );
      list.push({ shot: ref.id, from: seg.from, to: seg.to });
      covered.set(seg.line, list);
    }
  });
  for (const id of Object.keys(p.shots)) {
    if (!shotIds.has(id))
      add(
        'warning',
        'orphan-shot',
        `shots/${id}.json is not listed in ids.json shots`,
        `shots/${id}.json`,
      );
  }
  for (const f of opts.shotFiles ?? []) {
    const id = f.replace(/^shots\//, '').replace(/\.json$/, '');
    if (!p.shots[id]) add('warning', 'orphan-shot', `${f} is not part of the project`, f);
  }

  // --- assets
  const assets = new Map<string, (typeof p.assets.assets)[number]>();
  p.assets.assets.forEach((a, i) => {
    const ptr = `/assets/${i}`;
    if (assets.has(a.id))
      add('error', 'duplicate-id', `duplicate asset ID "${a.id}"`, 'assets.json', `${ptr}/id`);
    assets.set(a.id, a);
    const srcs: Array<[string, string]> = [[a.src, `${ptr}/src`]];
    if (a.poster) srcs.push([a.poster, `${ptr}/poster`]);
    a.variants?.forEach((v, j) => srcs.push([v.src, `${ptr}/variants/${j}/src`]));
    for (const [src, pointer] of srcs) {
      const info = classifySrc(src);
      if (!info) {
        add(
          'error',
          'bad-src',
          `asset "${a.id}": invalid src ${JSON.stringify(src)}`,
          'assets.json',
          pointer,
        );
        continue;
      }
      if (info.kind === 'embedded' && opts.hasFile && !opts.hasFile(info.path)) {
        add(
          'error',
          'missing-media',
          `asset "${a.id}": ${info.path} is missing from the package`,
          'assets.json',
          pointer,
        );
      }
      if (info.kind === 'linked') {
        if (info.absolute)
          add(
            'warning',
            'absolute-link',
            `asset "${a.id}": absolute file: path is not portable; use a path relative to the .sbd location`,
            'assets.json',
            pointer,
          );
        if (opts.linkedExists?.(src) === false)
          add(
            'error',
            'missing-media',
            `asset "${a.id}": linked file ${info.path} not found`,
            'assets.json',
            pointer,
          );
      }
      if (
        info.kind === 'remote' &&
        info.url.startsWith('http://') &&
        !/^http:\/\/(localhost|127\.0\.0\.1)/.test(info.url)
      ) {
        add(
          'warning',
          'insecure-url',
          `asset "${a.id}": http:// sources are blocked on https pages; prefer https://`,
          'assets.json',
          pointer,
        );
      }
    }
    const warn = playabilityWarning(a);
    if (warn)
      add(
        'warning',
        'not-browser-safe',
        `asset "${a.id}" (${a.name}): ${warn}`,
        'assets.json',
        `${ptr}/src`,
      );
    if (
      a.category &&
      p.manifest.categories &&
      !p.manifest.categories.some((c) => c.id === a.category)
    ) {
      add(
        'info',
        'unknown-category',
        `asset "${a.id}" uses category "${a.category}" not listed in manifest categories`,
        'assets.json',
        `${ptr}/category`,
      );
    }
  });

  // --- shot contents
  for (const [id, shot] of Object.entries(p.shots)) {
    const file = `shots/${id}.json`;
    if (shot.id !== id)
      add('error', 'shot-id-mismatch', `${file} has id "${shot.id}"`, file, '/id');
    const variantIds = new Set<string>();
    (shot.variants ?? []).forEach((v, i) => {
      const ptr = `/variants/${i}`;
      if (variantIds.has(v.id))
        add(
          'error',
          'duplicate-id',
          `shot "${id}": duplicate variant ID "${v.id}"`,
          file,
          `${ptr}/id`,
        );
      variantIds.add(v.id);
      if (v.type === 'image') {
        const a = assets.get(v.asset);
        if (!a)
          add(
            'error',
            'missing-asset',
            `shot "${id}" variant "${v.id}" references unknown asset "${v.asset}"`,
            file,
            `${ptr}/asset`,
          );
        else if (a.kind !== 'image' && a.kind !== 'video')
          add(
            'error',
            'wrong-kind',
            `shot "${id}" variant "${v.id}": asset "${a.id}" is ${a.kind}, expected image or video`,
            file,
            `${ptr}/asset`,
          );
      } else if (v.type === 'canvas') {
        if (v.preview && !assets.has(v.preview))
          add(
            'error',
            'missing-asset',
            `shot "${id}" variant "${v.id}" preview references unknown asset "${v.preview}"`,
            file,
            `${ptr}/preview`,
          );
        const layerIds = new Set<string>();
        v.layers.forEach((l, j) => {
          const lp = `${ptr}/layers/${j}`;
          if (layerIds.has(l.id))
            add(
              'error',
              'duplicate-id',
              `shot "${id}" variant "${v.id}": duplicate layer ID "${l.id}"`,
              file,
              `${lp}/id`,
            );
          layerIds.add(l.id);
          const kind = layerKind(l);
          if (kind === 'image') {
            const a = l.asset ? assets.get(l.asset) : undefined;
            if (!a)
              add(
                'error',
                'missing-asset',
                l.asset
                  ? `shot "${id}" layer "${l.id}" references unknown asset "${l.asset}"`
                  : `shot "${id}" layer "${l.id}" has no asset`,
                file,
                `${lp}/asset`,
              );
            else if (a.kind !== 'image' && a.kind !== 'video')
              add(
                'error',
                'wrong-kind',
                `shot "${id}" layer "${l.id}": asset "${a.id}" is ${a.kind}, expected image or video`,
                file,
                `${lp}/asset`,
              );
          } else if (kind === 'text') {
            if (l.font_asset) {
              const f = assets.get(l.font_asset);
              if (!f)
                add(
                  'error',
                  'missing-asset',
                  `shot "${id}" layer "${l.id}" uses unknown font asset "${l.font_asset}"`,
                  file,
                  `${lp}/font_asset`,
                );
              else if (f.kind !== 'font')
                add(
                  'error',
                  'wrong-kind',
                  `shot "${id}" layer "${l.id}": font_asset "${f.id}" is ${f.kind}, expected font`,
                  file,
                  `${lp}/font_asset`,
                );
            }
          } else if (kind !== 'slot') {
            add(
              'warning',
              'unknown-layer-kind',
              `layer "${l.id}": unknown kind "${kind}" will be ignored`,
              file,
              `${lp}/kind`,
            );
          }
          l.filters?.forEach((f, k) => {
            if (!(KNOWN_FILTERS as readonly string[]).includes(f.type))
              add(
                'warning',
                'unknown-filter',
                `layer "${l.id}": unknown filter "${f.type}" will be ignored`,
                file,
                `${lp}/filters/${k}/type`,
              );
          });
        });
      }
    });
    if (shot.active_variant && !variantIds.has(shot.active_variant)) {
      add(
        'error',
        'missing-variant',
        `shot "${id}": active_variant "${shot.active_variant}" does not exist`,
        file,
        '/active_variant',
      );
    }
    const defs = p.manifest.shot_fields;
    if (defs && shot.fields) {
      for (const key of Object.keys(shot.fields)) {
        if (!defs.some((d) => d.id === key))
          add(
            'info',
            'custom-field',
            `shot "${id}" uses custom field "${key}" not defined in manifest shot_fields`,
            file,
            `/fields/${key}`,
          );
      }
    }
  }

  // --- timeline
  const cueIds = new Set<string>();
  p.timeline.cues.forEach((c, i) => {
    const ptr = `/cues/${i}`;
    if (cueIds.has(c.id))
      add('error', 'duplicate-id', `duplicate cue ID "${c.id}"`, 'timeline.json', `${ptr}/id`);
    cueIds.add(c.id);
    const a = assets.get(c.asset);
    if (!a)
      add(
        'error',
        'missing-asset',
        `cue "${c.id}" references unknown asset "${c.asset}"`,
        'timeline.json',
        `${ptr}/asset`,
      );
    else if (a.kind !== 'audio' && a.kind !== 'video')
      add(
        'error',
        'wrong-kind',
        `cue "${c.id}": asset "${a.id}" is ${a.kind}, expected audio or video`,
        'timeline.json',
        `${ptr}/asset`,
      );
    if (c.in !== undefined && c.out !== undefined && c.out <= c.in)
      add(
        'error',
        'bad-range',
        `cue "${c.id}": out (${c.out}) must be greater than in (${c.in})`,
        'timeline.json',
        `${ptr}/out`,
      );
    if (a?.duration !== undefined && c.out !== undefined && c.out > a.duration + 0.05)
      add(
        'warning',
        'out-of-range',
        `cue "${c.id}": out (${c.out}s) is past the end of "${a.id}" (${a.duration}s)`,
        'timeline.json',
        `${ptr}/out`,
      );
    const t = c.target;
    if (isLineTarget(t) && !lineIds.has(t.line))
      add(
        'warning',
        'missing-line',
        `cue "${c.id}" targets unknown line "${t.line}" (skipped in playback; the line was probably deleted from the script)`,
        'timeline.json',
        `${ptr}/target/line`,
      );
    else if (isShotTarget(t) && !shotIds.has(t.shot))
      add(
        'error',
        'missing-shot',
        `cue "${c.id}" targets unknown shot "${t.shot}"`,
        'timeline.json',
        `${ptr}/target/shot`,
      );
    else if (isRangeTarget(t)) {
      t.range.forEach((lid, k) => {
        if (!lineIds.has(lid))
          add(
            'warning',
            'missing-line',
            `cue "${c.id}" range references unknown line "${lid}" (skipped in playback)`,
            'timeline.json',
            `${ptr}/target/range/${k}`,
          );
      });
    } else if (!isGlobalTarget(t) && !isLineTarget(t) && !isShotTarget(t)) {
      add(
        'error',
        'bad-target',
        `cue "${c.id}" has an invalid target`,
        'timeline.json',
        `${ptr}/target`,
      );
    }
  });

  return issues;
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** One line per issue, e.g. `error  assets.json /assets/0/src  missing-media: …`. */
export function formatIssues(issues: readonly Issue[]): string {
  return issues
    .map(
      (i) =>
        `${i.severity.padEnd(7)} ${[i.file, i.pointer].filter(Boolean).join(' ')}  ${i.message}`,
    )
    .join('\n');
}
