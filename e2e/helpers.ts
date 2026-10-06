import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const STORY = join(ROOT, 'e2e/.tmp/story.sbd');
/** Copy served by the second server (editing tests). */
export const EDIT_STORY = join(ROOT, 'e2e/.tmp/edit.sbd');
export const EXAMPLE = join(ROOT, 'examples/minimal.sbd');
export const CLI = join(ROOT, 'packages/cli/dist/cli.js');

/**
 * Calls one MCP tool through `sbd mcp <story>` over stdio (raw JSON-RPC, like an agent's client).
 */
export async function mcpCall(
  tool: string,
  args: Record<string, unknown>,
  story = STORY,
): Promise<{ isError?: boolean; text: string }> {
  const child = spawn(process.execPath, [CLI, 'mcp', story], { stdio: ['pipe', 'pipe', 'pipe'] });
  const send = (msg: object) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  let buf = '';
  const result = new Promise<{ isError?: boolean; text: string }>((resolve, reject) => {
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const msg = JSON.parse(line) as {
          id?: number;
          result?: { content: Array<{ text: string }>; isError?: boolean };
          error?: { message: string };
        };
        if (msg.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: tool, arguments: args },
          });
        } else if (msg.id === 2) {
          if (msg.error) reject(new Error(msg.error.message));
          else resolve({ isError: msg.result!.isError, text: msg.result!.content[0]!.text });
        }
      }
    });
    child.on('error', reject);
  });
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '0' },
    },
  });
  try {
    return await result;
  } finally {
    child.kill();
  }
}

/**
 * Selects text in the script editor: from `from.words` (or the line start) in line `from.line` to
 * the end of `to.words` (or the line end) in line `to.line`, through the DOM selection that
 * CodeMirror follows.
 */
export async function selectInScript(
  page: import('@playwright/test').Page,
  from: { line: string; words?: string },
  to: { line: string; words?: string } = from,
): Promise<void> {
  await page.locator(`.cm-line[data-line-id="${from.line}"]`).click();
  await page.evaluate(
    ([a, aw, b, bw]) => {
      const point = (id: string, words: string | null, end: boolean): [Node, number] => {
        const line = document.querySelector(`.cm-line[data-line-id="${id}"]`)!;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        const nodes: Array<[Node, number]> = [];
        let text = '';
        while (walker.nextNode()) {
          nodes.push([walker.currentNode, text.length]);
          text += walker.currentNode.textContent ?? '';
        }
        let pos = words === null ? (end ? text.length : 0) : text.indexOf(words);
        if (words !== null && end) pos += words.length;
        for (let i = nodes.length - 1; i >= 0; i--) {
          const [n, at] = nodes[i]!;
          if (at < pos || (at === pos && !end) || i === 0) return [n, pos - at];
        }
        return [line, 0];
      };
      const r = document.createRange();
      r.setStart(...point(a!, aw ?? null, false));
      r.setEnd(...point(b!, bw ?? null, true));
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
    },
    [from.line, from.words ?? null, to.line, to.words ?? null] as const,
  );
  await page.waitForTimeout(50);
}
