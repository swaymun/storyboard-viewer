/**
 * HLS (`.m3u8`) playback. Safari plays HLS natively; Chromium and Firefox need hls.js, which is
 * loaded on demand (its own chunk) only when an HLS source is actually shown.
 */
import { classifySrc } from '@storyboard-viewer/format';

type HlsModule = typeof import('hls.js/light');
let loading: Promise<HlsModule['default'] | null> | null = null;

export function isHlsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const info = classifySrc(url);
  return info?.kind === 'remote' ? info.hls : /\.m3u8(?:$|[?#])/i.test(url);
}

function loadHls(): Promise<HlsModule['default'] | null> {
  loading ??= import('hls.js/light')
    .then((m) => (m.default.isSupported() ? m.default : null))
    .catch(() => null);
  return loading;
}

/**
 * Points a media element at `url`. HLS URLs go through hls.js when the browser cannot play them
 * natively. Returns a cleanup function.
 */
export function setMediaSource(el: HTMLMediaElement, url: string | null): () => void {
  if (!url) {
    el.removeAttribute('src');
    return () => {};
  }
  if (!isHlsUrl(url) || el.canPlayType('application/vnd.apple.mpegurl')) {
    if (el.getAttribute('src') !== url) el.src = url;
    return () => {};
  }
  let disposed = false;
  let destroy = () => {};
  void loadHls().then((Hls) => {
    if (disposed) return;
    if (!Hls) {
      el.src = url; // let the browser try (and fail with its own error)
      return;
    }
    const hls = new Hls({ enableWorker: true });
    hls.loadSource(url);
    hls.attachMedia(el);
    destroy = () => hls.destroy();
  });
  return () => {
    disposed = true;
    destroy();
  };
}

/** Svelte action: `<video use:mediaSrc={url}>`. */
export function mediaSrc(el: HTMLMediaElement, url: string | null) {
  let cleanup = setMediaSource(el, url);
  let current = url;
  return {
    update(next: string | null) {
      if (next === current) return;
      current = next;
      cleanup();
      cleanup = setMediaSource(el, next);
    },
    destroy() {
      cleanup();
    },
  };
}
