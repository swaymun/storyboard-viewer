/**
 * Example storyboards bundled with the app (apps/web/public/examples/, packed from examples/ by
 * `pnpm examples:web`) for the start screen's "Try an example". They open like a dropped .sbd
 * file: editable in the browser, saved or exported wherever you choose.
 */
export interface BundledExample {
  file: string;
  title: string;
  kind: string;
}

export const EXAMPLES: readonly BundledExample[] = [
  { file: 'cat-crimes.sbd', title: 'Rating My Cat’s 3 A.M. Crimes', kind: 'Vertical video' },
  { file: 'pips-kite.sbd', title: 'Pip’s Kite', kind: 'Animation' },
];

/** URL of a bundled example, relative to the app (works under any base path). */
export const exampleUrl = (e: BundledExample): string =>
  new URL(`examples/${e.file}`, document.baseURI).href;
