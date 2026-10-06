# Security

Storyboard Viewer runs on your own computer. Nothing is uploaded and there are no accounts.

## What the local server does

`sbd serve` and `sbd mcp --serve` start a small web server so your browser can show and edit a
storyboard.

- **Local only.** It listens on `127.0.0.1` (your own computer) by default. Other devices on your
  network cannot reach it unless you pass `--host` yourself; don't do that on untrusted networks.
- **Writes are guarded.** Saving, uploading media and linking files require a custom request
  header (`x-sbd-client`) and a same-origin `Origin`. Browsers do not let other websites send that
  header without permission the server never grants, so a web page you visit cannot change your
  storyboards.
- **Files it will serve.** Only files inside the storyboard folder, plus linked files (`file:`)
  that the storyboard's `assets.json` actually lists. Paths with `..` or absolute paths are
  refused.
- **Edits are validated.** Changes that would add errors are rejected, and files are written
  atomically (write to a temp file, then rename).
- **Packed `.sbd` files are saved in place** when served: the new file is written next to the
  old one and renamed over it, and the version from before the first save is kept as
  `<file>.bak`.

The MCP server talks to your agent over stdio (standard input/output), not over the network.
Your agent can do whatever the MCP tools allow on the storyboard it opened, including copying
files you point it to into the storyboard.

## Reporting a vulnerability

Please report security problems privately (a GitHub security advisory on the repository, or the
maintainers' contact on the repository profile) rather than in a public issue. Include steps to
reproduce. We will reply as soon as we can and credit you in the fix if you like.
