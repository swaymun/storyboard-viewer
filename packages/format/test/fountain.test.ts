import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFountain, stripEmphasis, type FountainElement } from '../src/index.js';

const sample = readFileSync(new URL('./fixtures/sample.fountain', import.meta.url), 'utf8');

const brief = (els: FountainElement[]) => els.map((e) => [e.type, e.text]);

describe('parseFountain – sample script', () => {
  const doc = parseFountain(sample);

  it('parses the title page', () => {
    expect(doc.titlePage).toEqual({
      title: 'The Last Lighthouse',
      credit: 'Written by',
      author: 'Storyboard Viewer contributors',
      'draft date': '2026-10-06',
      contact: 'hello@example.com\nSomewhere by the sea',
    });
    const contact = doc.elements.find((e) => e.key === 'contact')!;
    expect([contact.startLine, contact.endLine]).toEqual([4, 6]);
  });

  it('classifies every element', () => {
    const body = doc.elements.filter((e) => e.type !== 'title_page');
    expect(brief(body)).toEqual([
      ['section', 'ACT ONE'],
      ['synopsis', "Mara returns to the lighthouse she swore she'd never see again."],
      ['action', 'FADE IN:'],
      ['scene_heading', 'EXT. CLIFFSIDE ROAD - DUSK'],
      ['action', 'Wind whips the grass flat. A battered hatchback crawls up the road.'],
      ['action', 'Its headlights catch the LIGHTHOUSE, dark against a bruised sky.'],
      ['note', 'Drone shot? Check budget.'],
      ['character', 'MARA'],
      ['dialogue', 'My father kept the light burning for forty years.'],
      ['dialogue', 'He said the sea never forgives a dark night.'],
      ['scene_heading', 'INT. LIGHTHOUSE - KITCHEN - NIGHT'],
      ['action', 'Dust. Mara sets a box on the table. *Very* carefully.'],
      ['character', 'MARA'],
      ['parenthetical', '(to herself)'],
      ['dialogue', 'Okay. Okay.'],
      ['dialogue', 'Just one night.'],
      ['boneyard', ''],
      ['action', 'A KNOCK at the door. Mara freezes.'],
      ['character', 'JONAS'],
      ['dialogue', "Mara? It's Jonas. From the harbor."],
      ['character', 'MARA'],
      ['dialogue', 'Go away, Jonas.'],
      ['scene_heading', 'FLASHBACK - THE LAMP ROOM'],
      ['action', 'SILENCE.'],
      ['lyrics', "The keeper's song, the keeper's song"],
      ['centered', 'THE END'],
      ['transition', 'CUT TO:'],
      ['page_break', ''],
      ['transition', 'SMASH CUT TO BLACK.'],
    ]);
  });

  it('keeps scene numbers, sections, extensions, dual dialogue and inline notes', () => {
    const scenes = doc.elements.filter((e) => e.type === 'scene_heading');
    expect(scenes.map((s) => s.sceneNumber)).toEqual(['1', '2', undefined]);
    expect(doc.elements.find((e) => e.type === 'section')!.depth).toBe(1);
    const vo = doc.elements.filter((e) => e.extension === 'V.O.');
    expect(vo.map((e) => e.type)).toEqual(['character', 'dialogue', 'dialogue']);
    expect(vo.every((e) => e.character === 'MARA')).toBe(true);
    expect(doc.elements.find((e) => e.dual)!.text).toBe('MARA');
    const knock = doc.elements.find((e) => e.text.startsWith('A KNOCK'))!;
    expect(knock.notes).toEqual(['sound design: three slow knocks']);
  });

  it('records exact source positions for every element', () => {
    const lines = sample.split('\n');
    for (const el of doc.elements) {
      expect(el.raw).toBe(sample.slice(el.start, el.end));
      expect(el.endLine).toBeGreaterThanOrEqual(el.startLine);
    }
    // single-line elements start at the beginning of their line and cover it entirely
    for (const el of doc.elements.filter((e) => e.startLine === e.endLine && e.type !== 'note')) {
      expect(el.raw).toBe(lines[el.startLine]);
    }
    const bone = doc.elements.find((e) => e.type === 'boneyard')!;
    expect(lines[bone.startLine]).toBe('/* Cut for length:');
    expect(lines[bone.endLine]).toBe('*/');
  });

  it('assigns consecutive ordinals to anchorable lines only', () => {
    expect(doc.lines.map((l) => l.ordinal)).toEqual(doc.lines.map((_, i) => i));
    expect(doc.lines.some((l) => l.type === 'character' || l.type === 'note')).toBe(false);
    expect(doc.lines).toHaveLength(20);
    // boneyard content never becomes a line
    expect(doc.lines.some((l) => l.text.includes('logbook'))).toBe(false);
  });
});

describe('parseFountain – rules', () => {
  it('handles CRLF and CR line endings with correct offsets', () => {
    const src = 'INT. ROOM - DAY\r\n\r\nHe sits.\rShe stands.';
    const doc = parseFountain(src);
    expect(brief(doc.lines)).toEqual([
      ['scene_heading', 'INT. ROOM - DAY'],
      ['action', 'He sits.'],
      ['action', 'She stands.'],
    ]);
    expect(doc.lines.map((l) => l.startLine)).toEqual([0, 2, 3]);
    for (const l of doc.lines) expect(src.slice(l.start, l.end)).toBe(l.raw);
  });

  it('requires a blank line before scene headings and characters', () => {
    const doc = parseFountain('He walks.\nINT. HOUSE - DAY\nBOB\nHi.');
    expect(doc.lines.every((l) => l.type === 'action')).toBe(true);
  });

  it('does not treat an uppercase line followed by a blank line as a character', () => {
    const doc = parseFountain('\nBOOM!\n\nThe wall collapses.');
    expect(brief(doc.lines)).toEqual([
      ['action', 'BOOM!'],
      ['action', 'The wall collapses.'],
    ]);
  });

  it('supports forced elements', () => {
    const doc = parseFountain('.OPENING\n\n@McCLANE\nYippee.\n\n!INT. NOT A HEADING\n\n>FADE OUT.');
    expect(doc.elements.map((e) => [e.type, e.text])).toEqual([
      ['scene_heading', 'OPENING'],
      ['character', 'McCLANE'],
      ['dialogue', 'Yippee.'],
      ['action', 'INT. NOT A HEADING'],
      ['transition', 'FADE OUT.'],
    ]);
  });

  it('keeps dialogue open across a two-space line', () => {
    const doc = parseFountain('\nDEALER\nTen.\n  \nFour.\n\nShe leaves.');
    expect(brief(doc.elements)).toEqual([
      ['character', 'DEALER'],
      ['dialogue', 'Ten.'],
      ['dialogue', 'Four.'],
      ['action', 'She leaves.'],
    ]);
  });

  it('strips inline boneyard and multi-line notes from line text', () => {
    const src = 'He runs /* fast */ home. [[a note\nthat spans lines]]\nShe follows.';
    const doc = parseFountain(src);
    expect(brief(doc.lines)).toEqual([
      ['action', 'He runs  home.'],
      ['action', 'She follows.'],
    ]);
    expect(doc.lines[0]!.notes).toEqual(['a note\nthat spans lines']);
    expect(doc.lines[1]!.startLine).toBe(2);
    expect(doc.elements.filter((e) => e.type === 'note')).toHaveLength(0);
  });

  it('treats [[ with an empty line before ]] as literal text', () => {
    const doc = parseFountain('A [[broken\n\nnote]] here.');
    expect(doc.lines.map((l) => l.text)).toEqual(['A [[broken', 'note]] here.']);
  });

  it('handles an unterminated boneyard', () => {
    const doc = parseFountain('Before.\n\n/* never closed\nINT. GONE');
    expect(brief(doc.lines)).toEqual([['action', 'Before.']]);
    expect(doc.elements.at(-1)!.type).toBe('boneyard');
  });

  it('only treats known keys on the first line as a title page', () => {
    const doc = parseFountain('INT: not a title page\n\nAction.');
    expect(doc.titlePage).toEqual({});
    expect(doc.lines[0]!.text).toBe('INT: not a title page');
  });

  it('handles non-Latin character names', () => {
    const doc = parseFountain('\nЗОЯ\nПривет.');
    expect(doc.elements.map((e) => e.type)).toEqual(['character', 'dialogue']);
  });

  it('parses empty input', () => {
    const doc = parseFountain('');
    expect(doc.elements).toEqual([]);
    expect(doc.lines).toEqual([]);
  });
});

describe('stripEmphasis', () => {
  it('removes markers and keeps escapes', () => {
    expect(stripEmphasis('***Bold italic*** and _under_ \\*star\\*')).toBe(
      'Bold italic and under *star*',
    );
  });
});
