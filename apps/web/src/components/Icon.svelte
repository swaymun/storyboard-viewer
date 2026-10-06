<script lang="ts" module>
  // Small stroke icons (decorative; buttons carry their own labels).
  const PATHS = {
    play: 'M7 4.5v15l12-7.5z',
    pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
    prev: 'M15 18l-6-6 6-6',
    next: 'M9 18l6-6-6-6',
    skipBack: 'M6 5v14M18 6l-9 6 9 6z',
    skipFwd: 'M18 5v14M6 6l9 6-9 6z',
    file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    volume: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7',
    mute: 'M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6',
    film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
    alert: 'M12 3l10 18H2zM12 10v5M12 18v.01',
    close: 'M6 6l12 12M18 6L6 18',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
    plus: 'M12 5v14M5 12h14',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    copy: 'M9 9h11v11H9zM5 15V4h11',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    eyeOff:
      'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2',
    settings:
      'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15.1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.2V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    check: 'M5 12l5 5L20 7',
    save: 'M5 3h11l4 4v14H4V3zM8 3v6h8V3M8 21v-7h8v7',
    split: 'M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4',
    merge: 'M8 4v5a4 4 0 0 0 4 4 4 4 0 0 1 4 4v3M16 4v5a4 4 0 0 1-4 4',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
    upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
    link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
    scissors:
      'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.1 8.1L20 20M14.5 9.5L20 4M8.1 15.9l3.4-3.4',
    crop: 'M6 2v16h16M2 6h16v16',
    magnet: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4',
    frame: 'M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M8 8h8v8H8z',
    target: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    mark: 'M6 4v16M18 4v16M6 12h12',
    palette:
      'M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.8 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 11h.01M10 7h.01M15 7h.01',
    tag: 'M3 12V4h8l10 10-8 8zM7.5 8h.01',
    script: 'M6 3h9l4 4v14H6zM9 9h6M9 13h6M9 17h3',
    board: 'M3 4h8v7H3zM13 4h8v7h-8zM3 13h8v7H3zM13 13h8v7h-8z',
    shot: 'M4 6h12v12H4zM16 10l4-2v8l-4-2',
    filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={name === 'play' || name === 'pause' ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width={name === 'more' || name === 'grip' ? 3.2 : 1.8}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"><path d={PATHS[name]} /></svg
>
