/**
 * The extension contract, copied from the `angular-email-editor` package so the
 * two can be reconciled by deletion rather than rewrite once that package is
 * consumable here. Trimmed to what the line editors need: no slash menu.
 */

// 3rd Party
import { MarkSpec, NodeSpec, Schema } from 'prosemirror-model';
import { Command, Plugin } from 'prosemirror-state';
import { InputRule } from 'prosemirror-inputrules';

/** Passed to every extension factory once the schema has been built. */
export interface ExtensionContext {
  schema: Schema;
  /** All extensions of the editor, so aggregators can introspect them. */
  extensions: readonly Extension[];
}

/**
 * A command factory: called with user arguments, returns a ProseMirror
 * {@link Command} ready to run against the editor.
 */
export type CommandFactory = (...args: any[]) => Command;

interface BaseExtension {
  name: string;
  /** Named commands exposed on the editor, e.g. `editor.commands.toggleBold()`. */
  commands?: (ctx: ExtensionContext) => Record<string, CommandFactory>;
  /** Key bindings. Earlier extensions in the array win over later ones. */
  keymap?: (ctx: ExtensionContext) => Record<string, Command>;
  /** Markdown-style input rules, e.g. `**x**` becoming bold as you type. */
  inputRules?: (ctx: ExtensionContext) => InputRule[];
  /** Arbitrary ProseMirror plugins (decorations, paste handling, ...). */
  plugins?: (ctx: ExtensionContext) => Plugin[];
}

export interface NodeExtension extends BaseExtension {
  type: 'node';
  /** Marks this node as the document root. Exactly one extension must set it. */
  topNode?: boolean;
  spec: NodeSpec;
}

export interface MarkExtension extends BaseExtension {
  type: 'mark';
  spec: MarkSpec;
}

/** Behaviour-only extension: history, base keymap, send intent, ... */
export interface FunctionalExtension extends BaseExtension {
  type: 'extension';
}

export type Extension = NodeExtension | MarkExtension | FunctionalExtension;

export const defineNode = (extension: Omit<NodeExtension, 'type'>): NodeExtension => ({
  type: 'node',
  ...extension,
});

export const defineMark = (extension: Omit<MarkExtension, 'type'>): MarkExtension => ({
  type: 'mark',
  ...extension,
});

export const defineExtension = (
  extension: Omit<FunctionalExtension, 'type'>,
): FunctionalExtension => ({
  type: 'extension',
  ...extension,
});
