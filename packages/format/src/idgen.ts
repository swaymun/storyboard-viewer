const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Pattern every SBD ID must match (also used for shot file names). */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** Random ID such as `s_k3j9a1`: prefix + `_` + `length` base36 chars, not in `taken`. */
export function newId(prefix: string, taken: { has(id: string): boolean }, length = 6): string {
  for (;;) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    let id = `${prefix}_`;
    for (const b of bytes) id += ALPHABET[b % 36];
    if (!taken.has(id)) return id;
  }
}

/** Turns a name into an ID-safe slug (`"Hero Shot #2"` → `hero-shot-2`). */
export function slugify(name: string, fallback = 'item'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}
