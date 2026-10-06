/**
 * Builds a Fountain paragraph for one script element, forcing the element type with Fountain's
 * markers (`.`, `!`, `>`, `@`) when plain text would be read as something else. Used by editors
 * ("add line" with a type picker) together with `insertScriptLines`.
 */
import { parseFountain, type FountainElementType } from './fountain.js';

export type ComposeType =
  'action' | 'scene_heading' | 'dialogue' | 'parenthetical' | 'transition' | 'centered';

export interface ComposeInput {
  type: ComposeType;
  /** Line text (dialogue: one or more lines; parenthetical: the words inside the brackets). */
  text: string;
  /** Character name for dialogue / parenthetical. */
  character?: string;
  /** Character extension such as `V.O.` or `O.S.`. */
  extension?: string;
  /** Optional parenthetical shown before the dialogue (`whispering`). */
  parenthetical?: string;
}

const firstType = (text: string): FountainElementType | undefined =>
  parseFountain(`${text}\n`).elements[0]?.type;

const clean = (s: string) => s.replace(/\r\n?/g, '\n').trim();
const stripParens = (s: string) =>
  clean(s)
    .replace(/^\(+|\)+$/g, '')
    .trim();

/** Fountain text for the element. Throws when required parts are missing. */
export function composeFountain(input: ComposeInput): string {
  const text = clean(input.text);
  switch (input.type) {
    case 'scene_heading': {
      if (!text) throw new Error('Scene heading text is empty');
      const line = text.split('\n')[0]!;
      return firstType(line) === 'scene_heading' ? line : `.${line.replace(/^\.+/, '')}`;
    }
    case 'transition': {
      if (!text) throw new Error('Transition text is empty');
      const line = text.split('\n')[0]!;
      return firstType(line) === 'transition' ? line : `> ${line.replace(/^>\s*/, '')}`;
    }
    case 'centered': {
      if (!text) throw new Error('Text is empty');
      return `> ${text.split('\n')[0]!.replace(/^>\s*|\s*<$/g, '')} <`;
    }
    case 'action': {
      if (!text) throw new Error('Action text is empty');
      const lines = text.split('\n').filter((l) => l.trim());
      const parsed = parseFountain(`${lines.join('\n')}\n`).lines;
      const ok = parsed.length === lines.length && parsed.every((e) => e.type === 'action');
      return ok ? lines.join('\n') : lines.map((l) => `!${l.replace(/^!/, '')}`).join('\n');
    }
    case 'dialogue':
    case 'parenthetical': {
      const name = clean(input.character ?? '').replace(/^@/, '');
      if (!name) throw new Error('Character name is empty');
      const ext = stripParens(input.extension ?? '');
      let cue = name.toUpperCase() + (ext ? ` (${ext.toUpperCase()})` : '');
      const paren =
        input.type === 'parenthetical'
          ? stripParens(input.text)
          : stripParens(input.parenthetical ?? '');
      const dialogue = input.type === 'parenthetical' ? '' : text;
      if (!paren && !dialogue) throw new Error('Dialogue text is empty');
      const body = [paren ? `(${paren})` : '', ...dialogue.split('\n').map((l) => l.trim())]
        .filter(Boolean)
        .join('\n');
      if (firstType(`${cue}\n${body}`) !== 'character') cue = `@${cue}`;
      return `${cue}\n${body}`;
    }
  }
}
