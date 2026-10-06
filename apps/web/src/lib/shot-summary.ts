import type { Shot } from '@storyboard-viewer/format';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Counts of what a compact card folds away. */
export function shotExtras(shot: Shot): { details: number; tags: number; versions: number } {
  return {
    details: Object.values(shot.fields ?? {}).filter((v) => v !== null && v !== '').length,
    tags: shot.tags?.length ?? 0,
    versions: shot.variants?.length ?? 0,
  };
}

/** "7 details · 2 tags · 3 versions" (versions only when there is more than one); '' if none. */
export function shotSummary(shot: Shot): string {
  const { details, tags, versions } = shotExtras(shot);
  return [
    details ? plural(details, 'detail') : '',
    tags ? plural(tags, 'tag') : '',
    versions > 1 ? plural(versions, 'version') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
