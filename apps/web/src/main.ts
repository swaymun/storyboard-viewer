import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './App.svelte';
import { player } from './lib/player.svelte';
import { folderSource, zipSource } from './lib/sources/local';
import { app } from './lib/state.svelte';
import { startUpdater } from './lib/sw-update';
import { updateNotice } from './lib/update-notice.svelte';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
// text layers (captions): Montserrat as the display face
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-800.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/courier-prime/latin-400.css';
import '@fontsource/courier-prime/latin-400-italic.css';
import '@fontsource/courier-prime/latin-700.css';
import './themes.css';
import './app.css';
import { theme } from './lib/theme.svelte';

theme.init();

const target = document.getElementById('app');
if (!target) throw new Error('#app element missing');

export default mount(App, { target });

// New versions: reload by themselves when nothing is unsaved, else offer Reload (sw-update.ts).
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  updateNotice.updater = startUpdater({
    registerSW,
    work: {
      get unsaved() {
        return app.unsaved;
      },
      get saving() {
        return app.saving;
      },
      get openLocal() {
        return !!app.project && app.source?.kind !== 'server';
      },
      save: () => app.save(),
    },
    notify: (show) => (updateNotice.show = show),
  });

// Installed PWA: open .sbd files passed by the OS ("Open with Storyboard Viewer").
interface LaunchParams {
  files: FileSystemFileHandle[];
}
const launchQueue = (
  window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }
).launchQueue;
launchQueue?.setConsumer(async (params) => {
  const handle = params.files[0];
  if (handle) await app.openFile(await handle.getFile(), handle);
});

// Read-only handle for tests, debugging and computer-use agents (state, not an API contract).
(window as unknown as { __sbd: unknown }).__sbd = {
  app,
  player,
  theme,
  updates: updateNotice,
  version: __APP_VERSION__,
  sources: { folderSource, zipSource },
};
