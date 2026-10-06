/** Loads font assets as `FontFace`s so the Assets tab can preview them. */
const loaded = new Map<string, Promise<boolean>>();

/** CSS font-family name used for a font asset. */
export const fontFamily = (assetId: string) => `sbd-font-${assetId.replace(/[^\w-]/g, '_')}`;

/** Registers the font once per URL; resolves false when the file cannot be loaded. */
export function ensureFont(assetId: string, url: string | null): Promise<boolean> {
  if (!url || typeof FontFace === 'undefined') return Promise.resolve(false);
  const key = `${assetId}|${url}`;
  let p = loaded.get(key);
  if (!p) {
    const face = new FontFace(fontFamily(assetId), `url("${url}")`);
    p = face
      .load()
      .then((f) => {
        document.fonts.add(f);
        return true;
      })
      .catch(() => false);
    loaded.set(key, p);
  }
  return p;
}
