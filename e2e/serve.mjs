// Copies examples/minimal.sbd to e2e/.tmp/<name>.sbd (default: story) and serves it with the built CLI.
// Usage: node e2e/serve.mjs <port> [name]
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, 'e2e/.tmp');
const cli = join(root, 'packages/cli/dist/cli.js');
if (!existsSync(cli) || !existsSync(join(root, 'packages/cli/web/index.html'))) {
  console.error('Build first: pnpm build');
  process.exit(1);
}
const name = process.argv[3] ?? 'story';
const story = join(tmp, `${name}.sbd`);
// Each server keeps its shared recent list in its own temp config folder, never the user's.
const config = join(tmp, `config-${name}`);
rmSync(config, { recursive: true, force: true });
rmSync(story, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
cpSync(join(root, 'examples/minimal.sbd'), story, { recursive: true });
const child = spawn(process.execPath, [cli, 'serve', story, '--port', process.argv[2] ?? '4471'], {
  stdio: 'inherit',
  env: { ...process.env, SBD_CONFIG_DIR: config },
});
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
