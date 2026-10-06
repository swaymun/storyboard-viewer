import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/index.js';
import { ROOT } from './helpers.js';

const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const promptBlock = (md: string) => /```text\n([\s\S]*?)\n```/.exec(md)?.[1];

describe('docs', () => {
  it('README and docs/SETUP_PROMPT.md carry the same setup prompt', () => {
    const readme = promptBlock(read('README.md'));
    expect(readme).toBeTruthy();
    expect(readme).toBe(promptBlock(read('docs/SETUP_PROMPT.md')));
  });

  it('the setup prompt points at the repository', () => {
    for (const f of ['README.md', 'docs/SETUP_PROMPT.md'])
      expect(promptBlock(read(f))).toContain(
        'Repository: https://github.com/swaymun/storyboard-viewer\n',
      );
  });

  it('the user guide command table lists every sbd command', () => {
    const guide = read('docs/GUIDE.md');
    for (const c of COMMANDS) expect(guide).toContain(`sbd ${c.name}`);
  });
});
