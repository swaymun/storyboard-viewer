# SBD — Storyboard Document format, v0.3

Status: **draft 0.3.0** (2026-10-06; 0.1.0 and 0.2.0 files stay valid, see §10). The format is used by Storyboard Viewer, the `sbd` CLI and its
MCP server. It is content-agnostic: film, documentary, animation, short-form social video, motion
design and brand work all use the same structure.

Machine-readable definitions live in [`schema/`](schema/) (JSON Schema 2020-12). This document
explains them. When the two disagree, the schemas win for structure and this document wins for
meaning.

## 1. Design goals

1. **Plain files, friendly to people, agents and git.** JSON with two-space indentation, a plain
   Fountain script, media as ordinary files.
2. **The script stays pure Fountain.** It opens in any Fountain app. Shot boundaries (whole lines or
   character spans) and stable line IDs live _beside_ the script (`ids.json`), never inside it.
3. **Hand edits never break attachments.** If `script.fountain` is edited outside the tools, readers
   re-anchor line IDs (§5) so shots and audio cues stay attached.
4. **Two interchangeable forms.** A folder for editing, a zip for sharing.
5. **Forward compatible.** Readers ignore what they do not understand.

## 2. Two forms

| Form         | Looks like            | Use it for                                 |
| ------------ | --------------------- | ------------------------------------------ |
| **Unpacked** | a folder `story.sbd/` | editing (agents, CLI, git, hand edits)     |
| **Packed**   | a file `story.sbd`    | sharing, opening in the browser, archiving |

Both contain the same tree. `sbd pack` and `sbd unpack` convert between them losslessly. Tools may
edit either form; a tool that saves a packed file in place should write the new zip to a temporary
file next to it and rename it over the old one (so readers never see a half-written file), keep
media STOREd, and keep a backup of the previous version (the reference tools keep the version from
before their first save as `<file>.bak`).

### Packed layout (zip)

- The **first entry** is `mimetype`, stored uncompressed, no extra field, containing exactly
  `application/vnd.sbd+zip` (EPUB-style magic: bytes 30–37 of the file read `mimetype`, the content
  starts at byte 38).
- **Media and fonts are STOREd** (zip method 0, no compression) so a reader can cut the bytes out of
  the file (`Blob.slice`) and hand them to `<audio>`, `<video>` or `<img>` without unpacking, with
  seeking. Stored extensions: png jpg jpeg webp avif gif · mp3 m4a aac ogg oga opus wav flac weba ·
  mp4 m4v webm mov mkv · woff woff2 ttf otf.
- Everything else (JSON, Fountain, SVG, text) is DEFLATEd.
- Writers should sort entries after `mimetype` and use a fixed timestamp so identical projects pack
  to identical bytes.
- Not supported in 0.2: ZIP64 (> 4 GiB or > 65 535 entries), encryption, multi-disk archives.

## 3. File tree

```
story.sbd/
├── mimetype            packed form only: application/vnd.sbd+zip
├── manifest.json       required — title, preset, frame settings, categories, shot fields
├── script.fountain     optional — the script, plain Fountain
├── ids.json            shot order + line IDs (required when there is a script or any shot)
├── shots/
│   └── <shot-id>.json  one file per shot: fields, duration, visual variants
├── assets.json         asset registry (images, audio, video, fonts)
├── timeline.json       media cues
└── media/              embedded files (any sub-folders)
```

Missing optional files mean "empty": no `assets.json` = no assets, no `timeline.json` = no cues.
Package paths use `/`, never `..`, never start with `/`. Files whose name starts with `.` are not
part of the package (tools may use them for temp files).

### IDs

Every ID (shot, line, variant, layer, asset, cue) matches `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`.
Tools generate random IDs with a prefix (`s_k3j9a1`, `l_8h2kd0qz`, `v_…`, `ly_…`, `a_…`, `c_…`);
people and agents may choose readable ones (`opening`, `maya-portrait`). A shot ID is also its
file name. IDs are unique within their kind (variant and layer IDs within their shot/variant).

## 4. manifest.json

```json
{
  "format": "sbd",
  "format_version": "0.3.0",
  "title": "The Keeper's Light",
  "preset": "film",
  "aspect_ratio": "16:9",
  "canvas": { "width": 1920, "height": 1080 },
  "fps": 24,
  "default_shot_duration": 3,
  "categories": [{ "id": "character", "label": "Character", "kinds": ["image"] }],
  "shot_fields": [
    { "id": "camera", "label": "Shot size", "type": "select", "options": ["Wide", "Close-up"] },
    { "id": "notes", "label": "Notes", "type": "longtext" }
  ]
}
```

| Field                                | Meaning                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                             | always `"sbd"`                                                                                                                                  |
| `format_version`                     | semver of this spec the file follows (`0.3.0`; `0.1.0` and `0.2.0` files are read as they are)                                                  |
| `title`                              | required                                                                                                                                        |
| `description`, `authors`, `language` | optional metadata (`language` is BCP 47)                                                                                                        |
| `preset`                             | which preset created the project (§11); informational                                                                                           |
| `aspect_ratio`                       | frame ratio, `"16:9"`, `"9:16"`, `"2.39:1"`; default `16:9`                                                                                     |
| `canvas`                             | default canvas size in px for canvas variants; default 1920×1080                                                                                |
| `fps`                                | frames per second (for frame-based fields and exports); default 24                                                                              |
| `default_shot_duration`              | seconds for a shot with no duration, lines or cues; default 3                                                                                   |
| `categories`                         | asset categories the UI offers (`id`, `label`, optional `kinds`, `color`)                                                                       |
| `shot_fields`                        | fields shown for every shot: `id`, `label`, `type` (`text`, `longtext`, `number`, `boolean`, `select`), `options`, `placeholder`, `description` |
| `created`, `modified`, `generator`   | optional bookkeeping (ISO 8601 timestamps)                                                                                                      |

Assets may use categories and shots may use fields that are not listed; those are **custom**
values and must be preserved.

## 5. script.fountain and ids.json

### The script

`script.fountain` is a normal [Fountain 1.1](https://fountain.io/syntax) file. It is optional:
motion design or B-roll storyboards can have shots without any script.

### Lines

Each **non-blank physical line** of these element types is one _line_ with a stable ID:
`scene_heading`, `action`, `parenthetical`, `dialogue`, `transition`, `centered`, `lyrics`.
A three-line action paragraph is three lines; each line of a dialogue block is its own line.
**Character cues are not lines**: the character (and extension such as `V.O.`, `O.S.`, `CONT'D`)
is attached to the dialogue/parenthetical lines below it, so renaming a character never changes IDs.
Title page, sections, synopses, notes `[[…]]`, boneyard `/* */` and page breaks are not lines.

A line's **text** is the trimmed line with Fountain markers (`.`, `!`, `>`, `<`, `~`, `@`, `^`, scene
numbers), inline notes and boneyard removed; emphasis markers `*` `_` are kept.

### ids.json

```json
{
  "script_hash": "0a36ab2d7e9635",
  "shots": [
    {
      "id": "opening",
      "lines": ["l_962r8qxf", "l_5cr9a6ek"],
      "end": { "line": "l_5cr9a6ek", "offset": 20 }
    },
    {
      "id": "rocks",
      "lines": ["l_5cr9a6ek"],
      "start": { "line": "l_5cr9a6ek", "offset": 20 },
      "end": { "line": "l_5cr9a6ek", "offset": 31 }
    },
    { "id": "climb", "lines": [] }
  ],
  "lines": [
    {
      "id": "l_962r8qxf",
      "ordinal": 0,
      "hash": "029799f2c4741d",
      "text": "EXT. LIGHTHOUSE - DUSK",
      "type": "scene_heading"
    }
  ]
}
```

- `shots` — **the story order**, and for each shot the line IDs it covers (in script order; may be
  empty). Lines in no shot are _unassigned_ and shown separately.
- `start` / `end` (0.2, optional) — a shot may cover **any span of text**, not only whole lines:
  `start` is the first character of the shot in its first line, `end` the character after its
  last one in its last line (exclusive). Both are `{ "line": <line ID>, "offset": <integer> }`;
  `start.line` must be the first and `end.line` the last entry of `lines`. Offsets count UTF-16
  code units of the line's `text` (as stored in `lines` below: Fountain markers and inline notes
  are not counted, emphasis markers are). Omitted `start` = the start of the first line, omitted
  `end` = the end of the last line, so a shot without them covers whole lines exactly as in 0.1.
  Writers drop offsets that mean the whole line (0 and the line length).
  - One line may hold **several shots** (`"My cat did it. Let's rate them."` → one shot per
    sentence). A shot may also start in the middle of one line and end in the middle of another;
    its `lines` then list every line from the first to the last.
  - **Shots do not overlap.** Two shots may share a line when their character ranges do not
    overlap; overlapping text (or a whole line in two shots) is reported as a warning. Tools keep
    shots apart: giving a span to a shot takes that text out of other shots, and a shot that
    loses text in its middle keeps the part before (the rest becomes unassigned).
  - The example above: `opening` covers the scene heading and the first 20 characters of the
    next line ("Waves crash against "); `rocks` covers characters 20–31 of that line ("black
    rocks"); the rest of the line is in no shot. A reader that only knows 0.1 shows both shots on
    that whole line (and warns that the line is shared).
- `lines` — one `LineIdEntry` per line, ordered by `ordinal` (index among lines):
  `id`, `ordinal`, `hash` (cyrb53 of the NFC, whitespace-collapsed text, 14 hex chars), `text`,
  optional `type`.
- `script_hash` — cyrb53 of the whole `script.fountain` when `ids.json` was written (`null` when
  there is no script).

### Re-anchoring (hand edits)

When `script_hash` does not match the script, a reader re-anchors before using line IDs:

1. Unchanged lines in order keep their IDs (Myers diff on normalized text).
2. Identical text found elsewhere (moved lines) keeps its ID; the nearest position wins.
3. Edited lines between two unchanged anchors keep their ID when similarity ≥ 0.5; lines edited
   _and_ moved anywhere keep it at ≥ 0.7. Similarity = max(normalized Levenshtein, word Dice) on
   lower-cased text, minus 0.15 when the element type changed.
4. Everything else gets a new ID; IDs with no match are removed.
5. Shots drop removed lines and keep the rest in script order. A **new** line joins a shot when it
   sits between two lines of that shot, or right after a shot's last line (unless a new scene
   heading came first, or the shot ends before the end of that line), or before the first line of
   the script's first shot. Otherwise it stays unassigned.
6. Character spans (`start` / `end`) move with their line's text: offsets are mapped through a
   word-level diff of the old and new text of that line (text inserted exactly at a boundary stays
   outside the shot; a span that loses all its text leaves the shot without lines). A boundary on
   a removed line is dropped (the shot then covers whole lines there). Offsets past the end are
   clamped.
7. Cues targeting a removed line are reported (warning) and skipped during playback.

Readers re-anchor in memory; writers persist the new `ids.json` with the new `script_hash`. Edits
made through the tools (CLI, MCP, the app) preserve IDs exactly and never rely on similarity; they
map span boundaries through the exact text changes (same rule: typing right at a shot's edge stays
outside, typing inside it grows it, text that replaces part of a span belongs to it).

**Typing in an editor** (recommended for apps): a new line joins the shot above only when it is
in the same paragraph (no blank line in between), so pressing Enter twice at the end of a shot and
writing on starts outside it; text typed at the end of a whole-line shot's line stays in the shot.

## 6. shots/&lt;id&gt;.json

```json
{
  "id": "climb",
  "title": "Maya reaches the top",
  "fields": { "camera": "Medium wide", "movement": "Handheld", "mood": "tense" },
  "duration": 4.5,
  "tags": ["act-1"],
  "variants": [
    { "id": "sketch", "type": "image", "name": "Sketch", "asset": "climb-sketch" },
    {
      "id": "layout",
      "type": "canvas",
      "name": "Layout",
      "width": 1280,
      "height": 720,
      "background": "#1b1f2b",
      "layers": []
    }
  ],
  "active_variant": "layout"
}
```

| Field            | Meaning                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `id`             | equals the file name                                                                      |
| `title`, `tags`  | optional                                                                                  |
| `fields`         | values keyed by field ID: string, number, boolean or null. Unknown keys are custom fields |
| `duration`       | seconds; omit to derive it from lines and cues (§9)                                       |
| `variants`       | alternative visuals (sketch, render, alternate framing…)                                  |
| `active_variant` | the variant shown by default; defaults to the first                                       |

### Variants

- **Image variant** — `{ "id", "type": "image", "asset", "name"?, "notes"? }`. `asset` is an image
  (or a video, shown muted and looping).
- **Canvas variant** — a composition of layers:
  `{ "id", "type": "canvas", "width"?, "height"?, "background"?, "preview"?, "layers": [...] }`.
  Size defaults to `manifest.canvas`. `background` is a CSS color (default transparent).
  `preview` optionally names an image asset holding a flattened render (for apps that cannot
  composite).

### Layers

Layers are drawn **in array order, first = bottom** (z-order is the array order). Attributes follow
Konva's `Image` node, so editors can map them 1:1. A layer's `kind` (format 0.3) says what it draws:

| `kind`             | Draws                                                    | Needs           |
| ------------------ | -------------------------------------------------------- | --------------- |
| `image` or omitted | an image or video asset (every 0.1/0.2 layer)            | `asset`         |
| `text`             | on-screen text: captions, titles, hooks                  | `text`          |
| `slot`             | nothing in a finished frame: an empty, named placeholder | `width, height` |

Readers skip layers of a `kind` they do not know (validators warn).

Common fields:

| Field                | Default                    | Meaning                                                            |
| -------------------- | -------------------------- | ------------------------------------------------------------------ |
| `id`                 | required                   |                                                                    |
| `name`               | asset name / text          | label in layer lists (a slot's name, e.g. "Top", "B-roll")         |
| `x`, `y`             | 0                          | position of the layer origin (top-left before rotation), canvas px |
| `width`, `height`    | crop size, else asset size | unscaled display size (text: `width` is the wrap width)            |
| `scale_x`, `scale_y` | 1                          | negative flips                                                     |
| `rotation`           | 0                          | degrees clockwise around the origin                                |
| `opacity`            | 1                          | 0…1                                                                |
| `visible`, `locked`  | true, false                | `locked` is an editor hint                                         |
| `group`              | none                       | (0.3) layers with the same group ID belong together                |

**Image layers:** `asset` (image or video), `crop` = `{x, y, width, height}` source rectangle in
asset pixels, `filters` (below), and (0.3) `slot` when the picture was fitted into a layout slot.

Filters use **CSS filter semantics**: `blur` (px), `brightness`, `contrast`, `saturate`
(1 = unchanged), `grayscale`, `sepia`, `invert` (0…1), `hue_rotate` (degrees). Renderers ignore
unknown filter types (validators warn). Freehand drawing is out of scope.

**Text layers (0.3):** the box's top-left is `x`/`y` and its width `width`; lines wrap inside it
and the height follows from the lines. `rotation`, `scale_*` and `opacity` apply as for images.

| Field                 | Default         | Meaning                                                                                                                                 |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `text`                | required        | the text; `\n` starts a new line                                                                                                        |
| `font`                | `IBM Plex Sans` | font family. Apps should ship the families they offer (the reference app ships IBM Plex Sans, Montserrat, Courier Prime, IBM Plex Mono) |
| `font_asset`          | none            | a `font` asset to use instead of `font`                                                                                                 |
| `font_size`           | 64              | canvas px                                                                                                                               |
| `font_weight`         | 400             | 100–900                                                                                                                                 |
| `italic`, `uppercase` | false           |                                                                                                                                         |
| `color`               | `#ffffff`       | CSS color                                                                                                                               |
| `align`               | `center`        | `left`, `center`, `right`                                                                                                               |
| `line_height`         | 1.2             | multiple of `font_size`                                                                                                                 |
| `stroke`              | none            | `{color, width}` outline outside the glyphs (canvas px)                                                                                 |
| `shadow`              | none            | `{color, blur?, offset_x?, offset_y?}`                                                                                                  |
| `box`                 | none            | `{color, padding?, radius?}`: a box behind each line (padding default 0.3 × size, radius 0.2 × size)                                    |
| `style`               | none            | the caption style it was made from (`bold`, `boxed`, `lower-third`, `title`, `subtitle`); informational                                 |

**Slots (0.3)** come from layouts: named placeholders for pictures. An **empty slot** is a layer
`{ "kind": "slot", "name": "Top", "x", "y", "width", "height", "fit"? }`. Editors show it as a
labeled box; finished frames (cards, animatic, PDF, video) do not draw it. A **filled slot** is
an ordinary image layer whose `x/y/width/height/crop` already place the picture (so 0.1/0.2
readers draw it correctly), plus `slot`:

```json
{
  "id": "top",
  "asset": "cat-02-glass",
  "x": 0,
  "y": 0,
  "width": 1080,
  "height": 960,
  "crop": { "x": 0, "y": 320, "width": 720, "height": 640 },
  "slot": { "x": 0, "y": 0, "width": 1080, "height": 960, "name": "Top" }
}
```

`slot` = the slot's frame in canvas px, its `name`, and `fit`: `cover` (default — fill the
frame, cropping the overflow, centered) or `contain` (the whole picture, centered, letterboxed).
Editors re-fit the picture from `slot` (Fit / Fill, moving or resizing the slot) and turn it back
into an empty slot when the picture is removed.

**Groups (0.3)** are a shared `group` ID on layers (no nesting, no separate group object): editors
select, move and duplicate the members together; rendering is unchanged, so readers that ignore
`group` draw the same frame. A group of one is not a group.

## 7. assets.json

```json
{
  "assets": [
    {
      "id": "dialogue",
      "name": "Dialogue (all lines, one take)",
      "kind": "audio",
      "category": "dialogue",
      "tags": ["maya"],
      "src": "media/dialogue.wav",
      "mime": "audio/wav",
      "duration": 7
    }
  ]
}
```

| Field                        | Meaning                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `id`, `name`                 | required                                                                                                |
| `kind`                       | `image`, `audio`, `video` or `font`                                                                     |
| `category`, `tags`           | grouping and search (categories from the manifest, or custom)                                           |
| `src`                        | where the bytes are (below), required                                                                   |
| `mime`                       | MIME type, may include `codecs="…"`                                                                     |
| `duration`                   | seconds (audio/video)                                                                                   |
| `width`, `height`            | pixels (images/video)                                                                                   |
| `poster`                     | still image for a video (same forms as `src`)                                                           |
| `sha256`, `size`             | integrity and size in bytes                                                                             |
| `variants`                   | alternative renditions: `{src, mime?, width?, height?, label?, role?}` (`role`: alt, proxy, thumbnail…) |
| `notes`, `credit`, `license` | free text                                                                                               |

### Sources (`src`)

| Form         | Example                          | Meaning                                                                                                                                                                              |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Embedded** | `media/hero.webp`                | a file inside the package                                                                                                                                                            |
| **Linked**   | `file:../renders/shot-12.mp4`    | a local file, path **relative to the directory that contains the `.sbd`** (file or folder), so packing does not change it. Absolute `file:///…` works but is not portable (warning). |
| **Remote**   | `https://cdn.example.com/a.m3u8` | an http(s) URL; `.m3u8` = HLS stream                                                                                                                                                 |

Linked files are not inside a packed `.sbd`; browsers can only reach them through `sbd serve`.

### Browser-safe media

Use these so storyboards play everywhere (Chromium, Firefox, Safari). `sbd validate` warns about
anything else.

| Kind  | Use                                                                                            | Avoid (warning)                                |
| ----- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Image | WebP, AVIF, PNG, JPEG, GIF, SVG                                                                | TIFF, HEIC/HEIF, PSD                           |
| Audio | MP3, M4A/AAC, Opus (Ogg/WebM), WAV (PCM), FLAC                                                 | AIFF, WMA, AC-3                                |
| Video | MP4 with H.264 + AAC (`-movflags +faststart`), WebM with VP9/AV1 + Opus, HLS (`.m3u8`, remote) | MOV/ProRes, HEVC, MKV, AVI, WMV, FLV, MPEG-1/2 |
| Font  | WOFF2, WOFF, TTF, OTF                                                                          |                                                |

## 8. timeline.json

```json
{
  "tracks": [{ "id": "music", "label": "Music", "gain": 0.8 }],
  "cues": [
    {
      "id": "vo-1",
      "asset": "dialogue",
      "in": 0,
      "out": 2.2,
      "target": { "line": "l_vc0cyd78" },
      "track": "dialogue"
    },
    {
      "id": "maya-1",
      "asset": "dialogue",
      "in": 2.4,
      "out": 4.1,
      "target": { "line": "l_03jouxlm" },
      "track": "dialogue"
    },
    {
      "id": "theme",
      "asset": "music",
      "target": { "global": { "start": 0 } },
      "track": "music",
      "gain": 0.35,
      "loop": true,
      "fade_in": 1,
      "fade_out": 2
    }
  ]
}
```

A **cue** plays (part of) an audio or video asset against the story:

| Field                   | Default   | Meaning                                                                                                          |
| ----------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`, `asset`, `target` | required  |                                                                                                                  |
| `in`, `out`             | 0, end    | trim the source in seconds — one long recording can feed many cues                                               |
| `target`                |           | exactly one of `{"line": id}`, `{"shot": id}`, `{"range": [fromLine, toLine]}`, `{"global": {"start": seconds}}` |
| `offset`                | 0         | seconds after the target starts                                                                                  |
| `gain`                  | 1         | linear volume                                                                                                    |
| `track`                 | `default` | free label for mixing/muting (`dialogue`, `music`, `sfx`, `video`…)                                              |
| `fade_in`, `fade_out`   | 0         | seconds                                                                                                          |
| `loop`                  | false     | repeat `[in, out]` until the story ends (background music)                                                       |
| `label`                 |           | free text                                                                                                        |

`tracks` (optional) sets per-track `label`, `gain` and `muted`; cues may use tracks not listed.

## 9. Playback timing (animatic)

Shots play back to back in `ids.json` order.

- A **line** lasts as long as its longest line cue (`offset + (out − in)`, with `out` defaulting to
  the asset's duration). Without a cue it is estimated: scene heading 1.5 s, transition 1 s,
  parenthetical 0.8 s, otherwise `max(1.2, words / 2.6 + 0.4)` seconds.
- A **line split between shots** (0.2 character spans) shares its duration between them in
  proportion to the characters each covers (text in no shot does not count). A cue on that line
  starts with its first part and plays on across the following shots.
- A **shot** lasts `duration` when set (lines are compressed proportionally if they do not fit);
  otherwise the larger of the sum of its lines (or parts of lines) and its shot cues' extent, with
  a minimum of 1.5 s for shots with lines (0.3 s for a shot on part of a single line) and
  `default_shot_duration` for shots without.
- A cue starts at its target's start + `offset`: line → line start, shot → shot start, range → first
  line's start, global → `start`. It stops at `in…out` or at the end of the story.
- Unassigned lines do not play.

## 10. Versioning and compatibility

- `format_version` is semver. 0.x versions may change; from 1.0, minor versions only add.
- **Readers must ignore unknown fields** everywhere, and writers that modify a file should preserve
  unknown fields they read.
- Readers should warn (not fail) on a newer major version and still show what they understand.

### 0.2 → 0.3

- New, all optional: layer `kind` (`text`, `slot`), the text fields, `slot` on image layers, and
  `group` (§6). Layers without `kind` are image layers exactly as before.
- **0.1 and 0.2 files are valid 0.3 files.** Tools write `format_version` `0.3.0` when they
  create a project or first use one of these features.
- A 0.2 reader opening a 0.3 file draws image layers (filled slots included) correctly. It does
  not understand text and empty slot layers: their `asset` is missing, so it reports them as
  errors; that is why the version changes.

### 0.1 → 0.2

- New: optional `start` / `end` on `ids.json` shots (character spans, §5). Nothing else changed.
- **0.1 files are valid 0.2 files** and need no migration: shots without `start` / `end` cover
  whole lines. Tools write `format_version` `0.2.0` when they create a project or add the first
  span; a project without spans may keep `0.1.0`.
- A 0.1 reader opening a 0.2 file ignores `start` / `end` and treats those shots as whole lines.

## 11. Presets

Presets only pre-fill `categories`, `shot_fields`, `aspect_ratio`, `canvas` and `fps`; nothing is
restricted afterwards.

| Preset        | Categories                                                                    | Shot fields                                                                       |
| ------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `blank`       | image, footage, music, sfx, voiceover, other                                  | camera, notes                                                                     |
| `film`        | character, location/background, prop, footage, dialogue, music, sfx, other    | shot size, angle, movement, lens, transition, sound, notes                        |
| `documentary` | interview, B-roll, archival, graphics, location, voice-over, music, sfx       | source, lower third, on-screen text, source timecode, notes                       |
| `animation`   | character, background, prop, effects, dialogue, music, sfx                    | camera, action/pose, timing (frames), effects, transition, notes                  |
| `motion`      | logo/icon, typography, product, background, footage, voice-over, music, sfx   | on-screen text, motion, easing, transition, brand notes, notes                    |
| `vertical`    | talent, footage/B-roll, product, graphics, typography, voice-over, music, sfx | beat, on-screen text, framing, transition, sound, notes (9:16, 1080×1920, 30 fps) |

## 12. Validation

`sbd validate` (and the MCP `validate` tool) report:

- **errors** — schema violations; unknown asset/line/shot/variant IDs; duplicate IDs; a variant or
  layer using an audio asset; an image layer without `asset`; a text layer's `font_asset` that is
  missing or not a font; cues on images; `out ≤ in`; embedded files missing from `media/`;
  missing linked files; shot files missing; a span `start` / `end` not on the shot's first / last
  line (`span-line`); a span that ends before it starts (`span-empty`).
- **warnings** — formats outside the browser-safe list; absolute `file:` links; `http://` URLs;
  shared lines and overlapping spans (`shared-line`); span offsets past the end of their line
  (`span-offset`); orphan shot files; unknown filters; unknown layer kinds; cues past the end of their media; zip
  layout problems.
- **info** — custom fields and categories; the script was re-anchored.

Tools refuse edits that would add new errors.
