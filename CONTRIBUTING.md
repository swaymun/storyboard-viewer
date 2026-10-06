# Contributing to Storyboard Viewer

Thanks for helping! Bug reports, ideas, docs fixes and code are all welcome. Please be kind: this
project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Quick start

Requirements: Node.js 20.19+ (developed on Node 26), pnpm 8.15.6 (`npx pnpm@8.15.6` works too),
git. ffmpeg is optional (example generation, ffprobe metadata).

```sh
pnpm install
pnpm build          # format + cli (tsc) and the web app (vite), copied into packages/cli/web
pnpm test           # unit + integration tests (Vitest) in every package
pnpm lint           # oxlint + prettier --check + type checks (tsc, svelte-check)
npx playwright install chromium   # once, for the browser tests
pnpm test:e2e       # Playwright (Chromium) against `sbd serve` and a static copy; needs `pnpm build`
```

Day to day:

```sh
pnpm sbd serve examples/minimal.sbd --open        # the built app + an example storyboard
SBD_API=http://localhost:4400 pnpm dev            # Vite dev server, API proxied to that sbd serve
pnpm format                                       # prettier --write
```

## Scripts

| Script                        | What it does                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm build`                  | Build all packages                                                                    |
| `pnpm test` / `pnpm test:e2e` | Unit/integration tests / browser tests                                                |
| `pnpm lint` / `pnpm format`   | Check / fix style and types                                                           |
| `pnpm sbd <command>`          | Run the built CLI                                                                     |
| `pnpm example`                | Regenerate `examples/minimal.sbd` (deterministic; ffmpeg for the video)               |
| `pnpm screenshots`            | Regenerate README screenshots in `docs/images/` (`-- --story <path>` for another one) |
| `pnpm gen:schemas`            | Re-embed `schema/*.schema.json` into the format package                               |
| `pnpm fixture:storyboarder`   | Regenerate the Storyboarder import test fixture                                       |
| `pnpm examples:web`           | Re-pack the browser app's bundled examples (`apps/web/public/examples/`)              |
| `pnpm deploy:web`             | Build the web app and deploy it to Cloudflare Workers (see below)                     |

## How the code is organised

```
schema/              JSON Schemas of the .sbd files (source of truth for structure)
SPEC.md              the format, in words
packages/format/     @storyboard-viewer/format — browser-safe core
  src/fountain.ts      Fountain parser with source positions
  src/reanchor.ts      keeps line IDs stable when the script is edited by hand
  src/project.ts       load/serialize a project, derived views
  src/ops.ts           pure edit operations (used by the app, the server and MCP)
  src/spans.ts         shots on part of a line: segments, mapping through edits, carving
  src/merge.ts         three-way merge (agent edits + unsaved app edits)
  src/animatic.ts      playback timing shared by player and exports
  src/validate.ts      schema + reference checks
  src/zip.ts           packed .sbd (mimetype first, media stored for Blob slicing)
  src/storyboarder.ts  Storyboarder import
  src/node.ts          Node-only helpers (folders, files)
packages/cli/        @storyboard-viewer/cli — the `sbd` binary
  src/commands.ts      CLI commands
  src/server.ts        local HTTP server: app, project API, media with Range, SSE live refresh
  src/store.ts         validated, atomic edits on disk + change events
  src/mcp.ts           MCP tools for agents
  src/export-pdf.ts    PDF via the app's print view in headless Chromium
apps/web/            Svelte 5 PWA (no SvelteKit)
  src/lib/state.svelte.ts   app state: load, edit, undo, save, merge
  src/lib/sources/          where a project comes from: sbd serve, a folder, a .sbd file
  src/components/           Story (Script/Board), Canvas (Konva), Assets, shot Audio sections,
                            Soundtrack panel, menu bar, context menus, dialogs, print view
  src/lib/audio-editor.svelte.ts  shared audio editing (I / O / A workflow) for cards + panel
  src/lib/shot-actions.ts   shot commands shared by cards, context menus and the Shot menu
  src/lib/script-editor/    the script editor: shot marks and handles, Tab keys, actions
  src/lib/animatic-export.ts  WebCodecs video export (Mediabunny, lazy-loaded)
e2e/                 Playwright tests (two `sbd serve` instances on temp copies + a static server)
examples/            sample storyboards
scripts/             example/fixture/screenshot generators
```

Key ideas:

- **One edit path.** Every change is a pure function `(project, input) → project` in
  `packages/format/src/ops.ts`. The app applies ops and saves the changed files; the server and
  MCP apply the same ops through `ProjectStore.edit` (validation, atomic writes, events).
- **Line IDs are stable.** Tool edits map IDs exactly; hand edits are re-anchored by diffing.
- **Live refresh.** `sbd serve` watches the folder and sends Server-Sent Events; the app reloads
  and merges with unsaved local edits.

More background and the decisions behind them are in [PLAN.md](PLAN.md).

## UI principles

- **Freeform over forms.** Prefer free text with suggestions to fixed choices. Shot details,
  tags, tracks and asset categories are text inputs; preset and previously used values appear
  as suggestions (`SuggestInput.svelte`, a combobox with its own popup).
- **Avoid dropdowns.** No `<select>` and no `<datalist>` (people miss its suggestions). For a few
  fixed choices show them all side by side (`Segmented.svelte`); for many, use suggestions or a
  picker dialog. `src/lib/ui-principles.test.ts` fails if a `<select>` or `<datalist>` comes back.
- **Less is more.** Show only what has a value (empty details are hidden), don't repeat a title
  or a label that the layout already makes clear, keep cards about as tall as their script.
- **Every command has a home.** Commands live in the menu bar (with their shortcut shown) and in
  the context menu of the thing they act on (right-click, Shift+F10, Menu key). Share the
  command lists (e.g. `shotMenuItems`) instead of building new ones.
- **Keyboard and themes.** Everything works from the keyboard (focus stays on the thing you
  moved); colours come from theme tokens only (`themes.test.ts` checks).

## Pull requests

- Keep changes focused; add or update tests next to the code you change.
- `pnpm lint`, `pnpm test` and `pnpm test:e2e` should pass (CI runs them).
- User-facing changes: update the README (plain language, short sentences) and
  [CHANGELOG.md](CHANGELOG.md). Format changes: update `schema/`, `SPEC.md` and run
  `pnpm gen:schemas`.
- UI: keep keyboard access, labels and the stable `id` / `data-*` hooks that agents and tests use.

## Deploying the browser app

The hosted copy is the built web app (`apps/web/dist`) as static files on Cloudflare Workers.
The config is [`wrangler.jsonc`](wrangler.jsonc) at the repository root (static assets with a
single-page-app fallback, no Worker script).

```sh
npx wrangler login       # once
pnpm deploy:web          # builds apps/web, then `npx wrangler@4 deploy`
pnpm deploy:web:dry      # the same with --dry-run (no login needed)
```

Pushes to `main` deploy automatically: the `deploy` job in `.github/workflows/ci.yml` runs
`pnpm deploy:web` after the tests pass. It needs the repository secret `CLOUDFLARE_API_TOKEN`
(a Cloudflare API token from the "Edit Cloudflare Workers" template) and the repository variable
`CLOUDFLARE_ACCOUNT_ID`; without the token the job is skipped.

Without `sbd serve` the app never calls `/api` (`sbd serve` marks the index.html it serves), so
any static host works: serve `apps/web/dist` with a fallback to `index.html`. `e2e/hosted.spec.ts`
tests this setup. The "Try an example" files come from the committed `examples/`: after changing
one, run `pnpm build && pnpm examples:web` and commit `apps/web/public/examples/`.

## Reporting bugs

[Open an issue](https://github.com/swaymun/storyboard-viewer/issues/new/choose) with the
templates. Include what you did, what you expected, what happened, your browser and
OS, and (if you can) a small `.sbd` that shows the problem.
