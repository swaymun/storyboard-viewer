# The setup prompt

Copy everything inside the box below and paste it into **Claude Code** or **Codex** (the desktop
app or the terminal). Your agent will install Storyboard Viewer, connect itself to it, and open
your first storyboard. You will be asked to approve a few commands along the way.

It usually takes 2–5 minutes. You need an internet connection for the setup only.

```text
Please set up Storyboard Viewer for me. I may not be technical, so explain what you are doing in
plain, friendly words and ask before doing anything unusual.

Storyboard Viewer is a free, open-source storyboard app that runs on this computer. You (the
agent) edit storyboards through its MCP server, and I watch the changes appear in the viewer.
Repository: https://github.com/swaymun/storyboard-viewer

1. Check the tools. Run `node --version` and `git --version`.
   - Node.js must be version 20.19 or newer. If it is missing or older, help me install the LTS
     version from https://nodejs.org (or with Homebrew / winget / my package manager if I have
     one), then check again.
   - If git is missing, help me install it (on a Mac: `xcode-select --install`).
2. Pick a folder. Use ~/storyboard-viewer unless I say otherwise. If that folder already contains
   the project, use it and run `git pull` instead of cloning.
   Otherwise clone the repository address above: `git clone <repository> ~/storyboard-viewer`
3. Install and build (inside that folder). Use the pnpm version the project expects, without
   installing anything globally:
   `npx -y pnpm@8.15.6 install` then `npx -y pnpm@8.15.6 build`
   Then check the command line works: `node packages/cli/dist/cli.js --version`
4. Connect yourself to Storyboard Viewer (an MCP server named "storyboard"). Use the full,
   absolute path of the folder from step 2 in place of <REPO>:
   - If you are Claude Code:
     `claude mcp add storyboard --scope user -- node <REPO>/packages/cli/dist/cli.js mcp --serve`
   - If you are Codex:
     `codex mcp add storyboard -- node <REPO>/packages/cli/dist/cli.js mcp --serve`
   If the command's options look different, check `claude mcp add --help` or
   `codex mcp add --help` and adapt. If a server called "storyboard" already exists, ask me
   before replacing it.
5. Create my first storyboard. Ask me what I want to make (for example a short film, a
   documentary, an animation, a brand/motion video, or a vertical TikTok/Reels video) and its
   title, then create it in ~/Storyboards (make the folder if needed):
   `node <REPO>/packages/cli/dist/cli.js new ~/Storyboards/<short-name>.sbd --preset <preset> --title "<Title>"`
   Presets: film, documentary, animation, motion, vertical, blank.
6. Show me the viewer. The MCP connection from step 4 only becomes active in a new session, so
   for now start the viewer directly (keep it running in the background):
   `node <REPO>/packages/cli/dist/cli.js serve ~/Storyboards/<short-name>.sbd`
   It prints a link like http://localhost:4400/.
   - If you are running inside the Claude desktop app or the Codex desktop app and you can open
     pages in the in-app browser, open that link there so I can see the storyboard side by side
     with our chat.
   - Otherwise, give me the link and tell me to open it in Chrome, Edge or Safari.
7. Finish by telling me, in a few short sentences:
   - where Storyboard Viewer is installed and where my storyboard is saved;
   - that next time I can start a new chat and simply ask, for example: "Open my storyboard
     ~/Storyboards/<short-name>.sbd and show it to me", and you will use the storyboard tools and
     give me the viewer link (from get_viewer_url);
   - three example things I can ask for next, such as "Add five shots for the opening scene".
```

## What the prompt does, step by step

| Step | What happens                                                  | Why                                                       |
| ---- | ------------------------------------------------------------- | --------------------------------------------------------- |
| 1    | Checks for Node.js and git, helps install them if needed      | Storyboard Viewer is a JavaScript app; git downloads it   |
| 2    | Downloads the project into `~/storyboard-viewer`              | There is no installer yet, so it runs from its own folder |
| 3    | Installs the parts it needs and builds the app                | Turns the source code into the app you open in a browser  |
| 4    | Registers the "storyboard" MCP server with your agent         | So your agent can create and edit storyboards for you     |
| 5    | Creates your first storyboard in `~/Storyboards`              | A storyboard is a normal folder you own                   |
| 6    | Starts the viewer and opens it (in-app browser when possible) | So you can watch your agent's edits appear live           |
| 7    | Summarises where everything is and what to ask next           | So you know how to come back to it                        |

## Doing it by hand

Prefer typing the commands yourself? See [For developers](../README.md#for-developers) in the
README. Just want to look around first? The [browser app](../README.md#try-it-now) needs no setup. To remove the agent connection later: `claude mcp remove storyboard --scope user`
or `codex mcp remove storyboard`.
