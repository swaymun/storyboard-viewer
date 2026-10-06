# Example storyboards

Each folder ending in `.sbd` is a complete storyboard (the unpacked form of the
[.sbd format](../SPEC.md)). Open one from the repository folder after `pnpm install && pnpm build`:

```sh
pnpm sbd serve examples/<name>.sbd --open
```

Press **Space** to play it as an animatic with sound, or use the Story, Canvas and Assets tabs. To get a single shareable file: `pnpm sbd pack examples/<name>.sbd`.

| Storyboard                                                 | Preset            | Shots | What it is                                                                                                                                            |
| ---------------------------------------------------------- | ----------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`midnight-snack.sbd`](midnight-snack.sbd)                 | Film / Short      | 8     | Comedy: at 2 a.m. Theo tries to sneak cheesecake past a judgmental smart fridge. Three voices, each recorded as one take and split per line.          |
| [`salt-and-light.sbd`](salt-and-light.sbd)                 | Documentary       | 8     | The last salt farmers of a fictional bay. One long narration file split across lines, two interviews with lower thirds, B-roll and an archival shot. |
| [`cat-crimes.sbd`](cat-crimes.sbd)                         | Short-form (9:16) | 8     | TikTok-style video rating a cat's 3 a.m. crimes: hook, on-screen text, beats, one voice clip per line, beat and sound effects. Two lines are split into two shots each (format 0.2 sub-line shots). |
| [`fernlight-launch.sbd`](fernlight-launch.sbd)             | Motion / Brand    | 8     | Launch film for a fictional desk lamp. Canvas compositions from layered assets (background, product cutout, logo, sun icon) with filters.            |
| [`pips-kite.sbd`](pips-kite.sbd)                           | Animation         | 6     | A small robot and a sleepy owl fly a kite. Character cutouts reused as layers across shots, an alternate layout and a color key variant.             |
| [`minimal.sbd`](minimal.sbd)                               | Film / Short      | 4     | Tiny generated example used by the tests (`pnpm example` regenerates it).                                                                            |

## How they were made

They were built with the project's own tools, the same way an agent would: `sbd new --preset …`,
then the MCP server's edit tools (`add_asset`, `add_shot` with Fountain `script_text`,
`add_variant` with images or canvas `layers`, `add_cue`), then `sbd validate` and `sbd clean`.
In 0.4.0 two lines of `cat-crimes.sbd` were split into two shots each with `split_shot` (a
`text` inside the line), reusing that storyboard's own pictures.

- **Pictures:** generated with the image generation tool of the Codex CLI (`codex exec`), one
  prompt per picture with a style line repeated per storyboard; cutouts (characters, product,
  logo, icon) have transparent backgrounds. Saved as WebP (max 1280 px).
- **Voices:** [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) text-to-speech (`kokoro_mlx`),
  a different voice per character, MP3.
- **Music and sound effects:** synthesized from scratch with a small Python/numpy script (no
  samples), MP3.

All characters, places, brands and products are fictional. The media in these examples may be
reused under the project's [MIT license](../LICENSE).
