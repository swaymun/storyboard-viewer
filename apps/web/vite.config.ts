import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defaultClientConditions } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Resolve workspace packages to their TypeScript sources (see the "source" export condition).
  resolve: { conditions: ['source', ...defaultClientConditions] },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        name: 'Storyboard Viewer',
        short_name: 'Storyboard',
        description: 'View and edit .sbd storyboards, offline.',
        theme_color: '#1b1e24',
        background_color: '#111317',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        file_handlers: [{ action: '.', accept: { 'application/vnd.sbd+zip': ['.sbd'] } }] as never,
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        // The local server's API and media must always hit the network (live refresh, Range).
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Bundled examples ("Try an example") are cached once opened, so they work offline too.
        runtimeCaching: [
          {
            urlPattern: /\/examples\/[^/?]+\.sbd$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'sbd-examples' },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // `SBD_API=http://localhost:4400 pnpm dev` proxies /api to a running `sbd serve`.
    proxy: process.env['SBD_API'] ? { '/api': process.env['SBD_API'] } : {},
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
