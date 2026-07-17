/*
 * Public API Surface of angular-inline-select/json
 *
 * Secondary entry point: apps that never import it carry zero CodeMirror
 * bytes. CodeMirror (@codemirror/state, /view, /language, /commands, /lint)
 * and @lezer/highlight are optional peer dependencies of this subpath only.
 */

export * from './json-doc';
export * from './json-codec';
export * from './json-preview';
export * from './angular-inline-json';
// Type-only: the session COMPONENT stays behind `await import(…)` so its
// CodeMirror payload loads on first open, never eagerly.
export type { JsonSessionData } from './json-session';
