# User guide

Everything about using Storyboard Viewer by hand. To get started, see the
[README](../README.md); for the file format, [SPEC.md](../SPEC.md).

- [Three ways to open it](#three-ways-to-open-it)
- [The tabs and menus](#the-tabs-and-menus)
- [The script editor](#the-script-editor)
- [Shots](#shots)
- [Audio](#audio)
- [Appearance](#appearance)
- [Saving and opening](#saving-and-opening)
- [Export and import](#export-and-import)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [The sbd command](#the-sbd-command)
- [Connecting other MCP clients](#connecting-other-mcp-clients)
- [More questions](#more-questions)

## Three ways to open it

| How                                                   | What you get                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Your agent** (`sbd mcp --serve`)                    | The agent edits, you watch. Changes save automatically; the viewer refreshes by itself.                       |
| **`sbd serve <storyboard>`**                          | The viewer on a `localhost` link for one storyboard, with live refresh and automatic saving.                  |
| **The browser app** (the hosted link, or any of them) | Open a `.sbd` file or folder, start a new one, or try an example. Files stay on your computer; works offline. |

In the browser app, a **folder** (Chrome or Edge) saves automatically. A **`.sbd` file** or a new
storyboard is kept in the browser until you press **Save** (Cmd/Ctrl+S), which asks where to
save it the first time (or downloads it in browsers that can't save in place).

## The tabs and menus

The viewer has three tabs. Press **1–3** to switch.

| Tab        | What it is for                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Story**  | **Script** view: write the script; select words and press **Make shot** (Cmd/Ctrl+Enter). **Board** view: one card per shot.      |
| **Canvas** | Compose a shot from layers. Drag to move, use the handles to scale and rotate, arrow keys to nudge, `[` `]` to change order.      |
| **Assets** | Import pictures, sounds, videos and fonts (drag and drop), give them categories and tags, link big files instead of copying them. |

The menu bar has **File** (new, save, exports, project settings, close), **Edit** (undo, redo,
copy IDs), **View** (tabs, Script/Board, Soundtrack, Animatic, Appearance), **Shot** (make a shot,
extend it to the selection, move, duplicate, delete, play) and **Help** (keyboard shortcuts, the
Fountain syntax guide). Press **F10** to reach it from the keyboard. Right-click (or
**Shift+F10**) a script line, a shot or an asset for its commands.

## The script editor

Write plain [Fountain](https://fountain.io), the screenplay format: a line starting with `INT.`
or `EXT.` is a scene heading, a name in capitals above a line makes it dialogue, `(quietly)` is a
parenthetical, `CUT TO:` a transition. It is formatted as a screenplay while you type.
**Help → Fountain syntax guide** opens a short cheat sheet beside the script (drag its edge to
resize it).

**Tab** helps like a screenwriting app: on an empty line it switches between Character, Scene
heading, Transition and Action; after a name or a line of dialogue it starts a parenthetical.
Tab never jumps out of the editor; press **Esc** then **Tab** to move on with the keyboard.

## Shots

**A shot is any piece of the script**: a few words, a whole line, several lines, or several shots
inside one line (the speaker, then "the cops", then "the cars"). Select words and press
**Cmd/Ctrl+Enter** (or the **Make shot** button by the selection). Each shot's words get a light
underline in its colour, and its card sits beside them. Click a shot's words to open its card.

- **Change what a shot covers:** hover it and drag the small handles at its ends (they snap to
  words; hold **Alt** for single letters). With the keyboard: **Esc**, then **Tab** reaches the
  handles, and **←**/**→** move them a word at a time.
- **Reorder:** drag a card (its script text moves with it), or **Alt+↑/↓**.
- **More commands** (right-click the script): extend a shot to the selection, add text to the
  previous or next shot, take text out of its shot, split a shot at the cursor, attach audio,
  play from there.
- **Shots without script text** (B-roll, titles) sit between lines: **Shift+Cmd/Ctrl+Enter**.
  Press **Enter** twice at the end of a shot to write on outside it. Text that belongs to no shot
  is fine.
- **A shot can be just a picture, just a sound, or both.** Its card shows only what it has; add a
  title, details, tags or a sound from the card's **+**. Details, tags and extra versions of the
  picture wait behind one quiet line ("7 details · 2 tags · 3 versions"): click it to see them.
- **Details are free text.** **Add detail** offers the usual ones (shot size, angle, lens…) or
  takes any new name, and suggests values you used before. Tag shots (`#night`, `#act-1`) and
  filter by tag.
- **Board view** shows the classic storyboard: drag shots to reorder, drag a line into another
  shot (or Alt+↑/↓), double-click a line to edit it in the script.

While the animatic plays (**Space**), the words being spoken are marked, with a thin line running
under them.

## Audio

Open a shot's **Audio** section to see its lines and their sound. To cut one long recording into
lines: click a line, press **P** to play, **I** and **O** to mark where the line starts and ends
(or drag on the waveform), then **A** to assign. The next line is selected (also in the next
shot) and its piece starts where the last one ended, so you can go through a whole take quickly.
Click a line's clip to trim it, change its volume, mute it or delete it.

**Soundtrack** (View menu, or the button in the playback bar) holds music and sounds under the
whole story, and the tracks: mute or solo a track while you listen, set its volume.

## Appearance

View → Appearance: System (follows your computer's light/dark setting; you choose which light
and dark theme), Paper, Darkroom, Neutral Pro, Neutral Pro Light, Maomao Dark/Light and Jinshi
Dark/Light. Printed sheets are always black on white.

## Saving and opening

**With your agent or `sbd serve`**, changes save automatically. If your agent changes something
while you are editing, you see an "Updated by agent" notice and both sets of changes are kept; if
you both changed the same thing, yours wins and you can switch to the agent's version with one
click.

**The start screen** lists the storyboards you opened recently, with a small picture each. From a
served storyboard, File → Open another storyboard gets you there. Storyboards opened with
`sbd serve` are remembered in a small file shared by every `sbd serve`
(`~/.config/storyboard-viewer/recent.json`, or `$XDG_CONFIG_HOME/storyboard-viewer/`; set
`SBD_CONFIG_DIR` to use another folder), so the list is the same whichever port you opened.
Picking one opens it in its running viewer, or starts one on the next free port. The browser app
keeps its own list in the browser.

## Export and import

The **File** menu has Export PDF (storyboard sheets with 3, 6, 9 or 12 shots per page), Export
animatic video (MP4, made by the browser), Export script (Fountain) and Export .sbd file (the
whole storyboard as one file). The `sbd` command below can also make PDFs and import
[Fountain](https://fountain.io) scripts and [Storyboarder](https://wonderunit.com/storyboarder/)
scenes.

## Keyboard shortcuts

Press **?** in the app for the full list.

| Key                                   | What it does                                                 |
| ------------------------------------- | ------------------------------------------------------------ |
| **Space**                             | Play / pause the animatic                                    |
| **J** / **K**                         | Next / previous shot                                         |
| **1** **2** **3**                     | Story, Canvas, Assets                                        |
| **Cmd/Ctrl+S**                        | Save                                                         |
| **Cmd/Ctrl+Z** / **Shift+Cmd/Ctrl+Z** | Undo / redo                                                  |
| **Cmd/Ctrl+Enter**                    | Make a shot from the selected words (or the line)            |
| **Shift+Cmd/Ctrl+Enter**              | Shot without script text after the cursor                    |
| **Alt+↑** / **Alt+↓**                 | Move the focused shot                                        |
| **Esc**, then **Tab**                 | Leave the script editor                                      |
| **P**, **I** / **O**, **A**           | Audio: play, mark in / out, assign to the line and go on     |
| **F10**                               | Go to the menu bar                                           |
| **Shift+F10** or Menu key             | Context menu of the focused item                             |
| Canvas: arrows, `[` `]`               | Nudge the layer (Shift: ×10), move it back / forward a layer |

## The sbd command

From the project folder, run `pnpm sbd <command>` (or `node packages/cli/dist/cli.js <command>`
from anywhere). `pnpm sbd <command> --help` explains each one.

| Command                                                 | What it does                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `sbd new <path> --preset <preset>`                      | New storyboard folder (presets: film, documentary, animation, motion, vertical, blank) |
| `sbd serve <path> [--open]`                             | Viewer on localhost with live refresh                                                  |
| `sbd mcp [path] [--serve]`                              | MCP server for agents (stdio)                                                          |
| `sbd validate <path>`                                   | Check a storyboard for problems                                                        |
| `sbd export-pdf <path> [--layout grid\|rows] [--per 6]` | Storyboard sheets as a PDF (uses your installed Chrome or Edge)                        |
| `sbd import-fountain <script.fountain>`                 | Storyboard from a Fountain script                                                      |
| `sbd export-fountain <path>`                            | The script as plain Fountain                                                           |
| `sbd import-storyboarder <scene.storyboarder>`          | Storyboard from a Storyboarder scene                                                   |
| `sbd pack <folder>` / `sbd unpack <file.sbd>`           | Folder ⇄ single shareable file                                                         |
| `sbd clean <folder> [--yes]`                            | List (or delete) media files nothing uses                                              |

The animatic video export is in the app only (File → Export animatic video): it uses the
browser's built-in video encoder.

## Connecting other MCP clients

Claude Code and Codex: see the [README](../README.md#for-developers). Any other MCP client (use
the absolute path of your copy):

```json
{
  "mcpServers": {
    "storyboard": {
      "command": "node",
      "args": ["/path/to/storyboard-viewer/packages/cli/dist/cli.js", "mcp", "--serve"]
    }
  }
}
```

With `--serve` the MCP server also runs the viewer for whichever storyboard the agent opens, and
the agent's `get_viewer_url` tool returns its link. You can also pass a storyboard path:
`… cli.js mcp ~/Storyboards/my-film.sbd --serve`. To remove the connection later:
`claude mcp remove storyboard --scope user` or `codex mcp remove storyboard`.

## More questions

**The viewer says "read-only".**
You opened a packed `.sbd` file through `sbd serve`. Unpack it (`sbd unpack my-film.sbd`) and
serve the folder, or choose "Edit a copy".

**Is it safe?**
`sbd serve` only listens on your own computer (localhost) and refuses writes from other
websites. The browser app reads and writes only the files and folders you pick. See
[SECURITY.md](../SECURITY.md).

**Can I host the browser app myself?**
Yes: it is a static site (`pnpm build`, then serve `apps/web/dist`). See
[CONTRIBUTING.md](../CONTRIBUTING.md#deploying-the-browser-app).
