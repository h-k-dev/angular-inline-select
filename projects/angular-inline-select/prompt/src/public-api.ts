/*
 * Public API Surface of angular-inline-select/prompt
 *
 * Secondary entry point: apps that never import it carry zero ProseMirror
 * bytes. ProseMirror (prosemirror-model, -state, -view, -transform, -commands,
 * -keymap, -history, -inputrules) is an optional peer dependency of this
 * subpath only.
 *
 * Two layers: the line core (`line/`), a framework-free ProseMirror editor for
 * documents of lines stored as a plain string, which other dialects build on;
 * and the prompt dialect (`prompt/`) with its control.
 */

export * from './line/extension';
export * from './line/schema';
export * from './line/editor';
export * from './line/line-node';
export * from './line/numbering';
export * from './line/nodes/document';
export * from './line/nodes/text';
export * from './line/nodes/hard-break';
export * from './line/extensions/history';
export * from './line/extensions/base-keymap';

export * from './prompt/format';
export * from './prompt/codec';
export * from './prompt/kit';
export * from './prompt/render';
export * from './prompt/editor';
export * from './prompt/nodes/line';

export * from './angular-inline-prompt/angular-inline-prompt';
