// 3rd Party
import { Command } from 'prosemirror-state';

// Editables
import { LineEditor } from './editor';
import { CommandFactory } from './extension';

/**
 * Every format a dialect may offer, by kind — one table for all of them, so
 * a key means the same thing in every editor, a toolbar shows the key the
 * editor binds, and a toolbar's button runs the command the key runs. A
 * dialect binds the kinds it has (`formatKeys`) to its own way of doing them
 * — one paints delimiters, another toggles a mark — and names its command as
 * the table does, so `runFormat` finds it.
 */
export type FormatKind =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'link'
  | 'code'
  | 'mono'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'bullet'
  | 'number'
  | 'quote';

export interface FormatBinding {
  /** The command's name on the editor (`editor.commands`). */
  command: string;
  /** What the command is called with. */
  args?: readonly unknown[];
  /** Its keys, ProseMirror's spelling. The first is the one a toolbar shows. */
  keys: readonly string[];
}

/** Google Docs' heading keys: Mod-Alt and the depth. */
export const headingKey = (depth: number): string => `Mod-Alt-${depth}`;

const heading = (depth: number): FormatBinding => ({
  command: 'toggleHeading',
  args: [depth],
  keys: [headingKey(depth)],
});

// Each letter key twice: with Caps Lock on, the letter arrives in capitals.
export const FORMAT_BINDINGS: Record<FormatKind, FormatBinding> = {
  bold: { command: 'toggleBold', keys: ['Mod-b', 'Mod-B'] },
  italic: { command: 'toggleItalic', keys: ['Mod-i', 'Mod-I'] },
  underline: { command: 'toggleUnderline', keys: ['Mod-u', 'Mod-U'] },
  // Mod-Shift-X is what Slack, Discord and Teams use; Mod-S belongs to Save.
  strike: { command: 'toggleStrike', keys: ['Mod-Shift-x', 'Mod-Shift-X'] },
  // Notion's, Slack's and Google Docs' link key; the command asks for the
  // address (a dialect's own field), it does not make the link itself.
  link: { command: 'promptLink', keys: ['Mod-k', 'Mod-K'] },
  // Notion's and Linear's binding; Mod-Shift-C belongs to the dev tools.
  code: { command: 'toggleCode', keys: ['Mod-e', 'Mod-E'] },
  // WhatsApp's own binding for monospace.
  mono: { command: 'toggleMono', keys: ['Mod-Shift-m', 'Mod-Shift-M'] },
  heading1: heading(1),
  heading2: heading(2),
  heading3: heading(3),
  heading4: heading(4),
  // Slack's and Google Docs' shapes: bullets on 8 (the asterisk's key),
  // numbers on 7, a quote on 9.
  bullet: { command: 'toggleBullet', keys: ['Mod-Shift-8'] },
  number: { command: 'toggleNumber', keys: ['Mod-Shift-7'] },
  quote: { command: 'toggleQuote', keys: ['Mod-Shift-9'] },
};

/** A format's command under the table's name — what a dialect's `commands` spreads in. */
export function formatCommand<F extends CommandFactory>(kind: FormatKind, factory: F): Record<string, F> {
  return { [FORMAT_BINDINGS[kind].command]: factory };
}

/** A format's keys bound to `command` — what a dialect's keymap spreads in. */
export function formatKeys(kind: FormatKind, command: Command): Record<string, Command> {
  return Object.fromEntries(FORMAT_BINDINGS[kind].keys.map((key) => [key, command]));
}

/** Runs a format's command on the editor — what a toolbar's button does.
    False when the editor's dialect has no such command. */
export function runFormat(editor: LineEditor, kind: FormatKind): boolean {
  const { command, args = [] } = FORMAT_BINDINGS[kind];
  return editor.commands[command]?.(...args) ?? false;
}

/** The tags each mark is spelled with in HTML, the first the one it is written as. */
export const MARK_TAGS = {
  bold: ['strong', 'b'],
  italic: ['em', 'i'],
  underline: ['u'],
  strike: ['s', 'strike', 'del'],
} as const satisfies Record<string, readonly [string, ...string[]]>;
