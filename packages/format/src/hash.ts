/** Normalizes a script line for hashing/comparison: NFC, trimmed, internal whitespace collapsed. */
export function normalizeLine(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/**
 * cyrb53 (public domain, by bryc): a fast, well-distributed 53-bit non-cryptographic hash.
 * Synchronous and dependency-free so it runs identically in Node and the browser.
 */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Hash stored in `ids.json` for a line: 14 hex chars of cyrb53 over the normalized text. */
export function hashLine(text: string): string {
  return cyrb53(normalizeLine(text)).toString(16).padStart(14, '0');
}

/** Hash of a whole file's text (no normalization), as stored in `ids.json` `script_hash`. */
export function hashText(text: string): string {
  return cyrb53(text).toString(16).padStart(14, '0');
}
