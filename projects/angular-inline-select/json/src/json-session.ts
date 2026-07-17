import {
  Component,
  DestroyRef,
  ElementRef,
  Signal,
  TemplateRef,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import { EDITABLE_DIALOG_DATA } from 'angular-inline-select';

import { EditorView } from '@codemirror/view';

import { createJsonEditorState } from './json-editor';

/**
 * Everything the session needs, passed through the dialog's `data` channel
 * (values, live SIGNALS from the owner, and the two settlement callbacks).
 */
export interface JsonSessionData {
  /** The editor's initial text — the editing form (pretty, bare keys). */
  seed: string;
  /** Live draft channel: called on every keystroke with the full text. */
  onDraftChange: (text: string) => void;

  /** Mat-form-field rule: the OWNER decides when errors show. */
  errorsVisible: Signal<boolean>;
  /** Fallback error texts (contract messages + the live parse error). */
  errorMessages: Signal<string[]>;
  /** Consumer-provided error template — takes over the error slot entirely. */
  errorTemplate: Signal<TemplateRef<unknown> | undefined>;
  /** Whether the draft semantically differs from the baseline. */
  isDirty: Signal<boolean>;

  /** Affix templates, rendered beside the editor. */
  prefixTemplate: Signal<TemplateRef<unknown> | undefined>;
  suffixTemplate: Signal<TemplateRef<unknown> | undefined>;

  /**
   * THE accept path — the owner's commit: canonicalizes the draft back to
   * strict JSON text (JSON.stringify) and settles the rest state, closing
   * the dialog on success. An invalid draft keeps the dialog open and the
   * error signals above light up instead.
   */
  close: (draft: string) => void;
  /** Discard the session (the owner reverts to the baseline and closes). */
  cancel: () => void;
}

/**
 * The JSON editing session — a self-contained component PORTALED by
 * `editable-dialog` (never rendered inline), so it and CodeMirror behind it
 * load lazily via `await import(…)` only when a session actually opens.
 */
@Component({
  selector: 'angular-inline-json-session',
  imports: [NgTemplateOutlet],
  templateUrl: './json-session.html',
  // The host box disappears (like the dialog container's): the editor line
  // and footer participate DIRECTLY in the dialog card's column flex — a
  // host box in between would be an unshrinkable flex item (min-height:auto
  // = content size) and push the footer's actions off screen.
  styles: ':host { display: contents; }',
})
export class JsonSession {
  protected data = inject(EDITABLE_DIALOG_DATA) as JsonSessionData;

  protected editorContainer = viewChild.required<ElementRef<HTMLElement>>('editorContainer');

  #view: EditorView | null = null;

  #mount = afterNextRender(() => {
    const container = this.editorContainer().nativeElement;

    // Read the app's ACTIVE scheme off the mount point (it inherits through
    // the overlay container) so CodeMirror's own base theme — caret,
    // tooltips, selection — flips with dark mode instead of assuming light.
    const dark = getComputedStyle(container).colorScheme.includes('dark');

    const state = createJsonEditorState(
      this.data.seed,
      { onChange: (text) => this.data.onDraftChange(text) },
      { dark },
    );

    this.#view = new EditorView({ state, parent: container });
    this.#view.focus();
  });

  #destroyView = inject(DestroyRef).onDestroy(() => this.#view?.destroy());

  /** Save: hand the CM document (the source of truth) to the owner's accept path. */
  protected save() {
    this.data.close(this.#view?.state.doc.toString() ?? this.data.seed);
  }

  protected discard() {
    this.data.cancel();
  }
}
