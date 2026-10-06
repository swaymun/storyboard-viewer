import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpSession, type McpOptions } from './mcp.js';

/** Runs the MCP server on stdin/stdout until the client disconnects. Logs go to stderr. */
export async function runStdio(opts: McpOptions): Promise<number> {
  const session = await createMcpSession(opts);
  const transport = new StdioServerTransport();
  const done = new Promise<number>((resolveExit) => {
    transport.onclose = () => resolveExit(0);
    const stop = () => void session.close().finally(() => resolveExit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    process.stdin.once('end', stop);
  });
  await session.server.connect(transport);
  opts.log?.(
    `sbd mcp ready${session.store() ? ` (${session.store()!.path})` : ''}${session.viewer() ? `, viewer at ${session.viewer()!.url}` : ''}`,
  );
  const code = await done;
  await session.close().catch(() => {});
  return code;
}
