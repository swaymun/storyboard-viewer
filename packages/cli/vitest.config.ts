import { defaultClientConditions, defaultServerConditions } from 'vite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Resolve @storyboard-viewer/format to its TypeScript sources so tests don't need a build.
export default defineConfig({
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  test: {
    include: ['test/**/*.test.ts'],
    // never touch the user's shared recent list (~/.config/storyboard-viewer/recent.json)
    env: { SBD_CONFIG_DIR: join(tmpdir(), `sbd-vitest-config-${process.pid}`) },
  },
});
