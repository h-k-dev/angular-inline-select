// Angular
import {
  Component,
  DestroyRef,
  ElementRef,
  inject,

  // Signals
  computed,
  effect,
  input,
  model,
  output,
  untracked,
} from '@angular/core';

// Forms
import type { FormValueControl, ValidationError } from '@angular/forms/signals';

// 3rd Party
import { EditorState, TextSelection } from 'prosemirror-state';

// Editables
import { LineEditor } from '../line/editor';
import { History } from '../line/extensions/history';
import { BaseKeymap } from '../line/extensions/base-keymap';
import { createPromptEditor } from '../prompt/editor';
import { promptExtensions } from '../prompt/kit';
import { serializePromptDoc } from '../prompt/codec';
import { renderPrompt } from '../prompt/render';

const EXTENSIONS = [...promptExtensions, History, BaseKeymap];

/**
 * A prompt field: Markdown lines — headings, bullets, numbered items, one
 * level of nesting — edited as shapes and stored as the text a language model
 * reads. See `prompt/format.ts` for the format.
 *
 * **Lazy by design.** A page may hold hundreds of these, and a ProseMirror view
 * is not free: every one registers a document-wide `selectionchange` listener,
 * a `MutationObserver` and its plugin state, so every caret move anywhere
 * would run through all of them. At rest this draws the prompt as static
 * lines (`prompt/render.ts`) from the same schema, into the same element,
 * styled by the same sheet — so a view can take the element over without the
 * row moving — and a view exists only while the field is in use:
 *
 * - a mouse mounts it on entering the field, so the press that follows lands
 *   on live text and the browser places the caret and drags a selection
 *   natively — mounting on the press itself is too late, its target is
 *   already the static copy;
 * - a touch or pen press mounts it, and the caret goes where the press ends;
 * - focus from the keyboard mounts it, the caret where it last was;
 * - leaving the field unmounts it, unless it still has focus — at most the
 *   focused field and the hovered one are ever live.
 *
 * The state a view leaves behind is kept, so undo reaches across a remount.
 *
 * An attribute selector with an empty template: the host *is* the editable,
 * and everything inside it belongs to ProseMirror or to the static copy, never
 * to Angular. The inside is styled globally by `.iusta-prompt`
 * (`_prompt.scss`); the box is the consumer's.
 */
@Component({
  selector: 'div[angular-inline-prompt]',
  exportAs: 'angularInlinePrompt',
  template: '',
  host: {
    // Attributes
    class: 'iusta-prompt',
    role: 'textbox',
    '[attr.tabindex]': 'disabled() ? -1 : 0',
    '[attr.data-placeholder]': 'placeholder()',

    // ARIA
    'aria-multiline': 'true',
    '[attr.aria-label]': 'ariaLabel() || null',
    '[attr.aria-placeholder]': 'placeholder() || null',
    '[attr.aria-readonly]': 'readonly() || null',
    '[attr.aria-disabled]': 'disabled() || null',
    '[attr.aria-invalid]': 'invalid() || null',

    // Listeners
    '(pointerover)': 'hover($event)',
    '(pointerleave)': 'leave()',
    '(pointerdown)': 'press($event)',
    '(pointerup)': 'release($event)',
    '(focus)': 'engage()',
    '(focusout)': 'blur()',
  },
})
export class AngularInlinePrompt implements FormValueControl<string> {
  #destroyRef = inject(DestroyRef);
  #host = inject<ElementRef<HTMLElement>>(ElementRef);

  placeholder = input<string>('');
  ariaLabel = input<string>('');

  // ---- FormValueControl contract — auto-wired by [formField] ----

  /** The prompt as stored: Markdown, never HTML. */
  readonly value = model<string>('');
  readonly disabled = input(false);
  readonly readonly = input(false);
  readonly invalid = input(false);
  readonly touched = input(false);
  readonly touch = output<void>();
  readonly errors = input<readonly ValidationError[]>([]);

  /** ProseMirror has one notion where the form has two: neither state types. */
  #canEdit = computed(() => !this.disabled() && !this.readonly());

  /** The live view, while there is one. */
  #editor: LineEditor | undefined;

  /** What the last view left behind, for undo across a remount. */
  #state: EditorState | undefined;

  /** The text the static copy shows, so an unchanged value does not redraw it. */
  #drawn: string | undefined;

  /** A touch or pen press that mounted the view: the caret goes where it ends. */
  #pressed = false;

  constructor() {
    /**
     * The value into the element. An effect on purpose: the target is DOM
     * this component draws itself, or an imperative library that owns its own
     * state — not Angular state mirrored into more Angular state.
     *
     * A live view takes the value through `setText`, which ignores an
     * identical one, so the writer's own keystroke echoing back never touches
     * the caret.
     */
    effect(() => {
      const value = this.value();
      untracked(() => (this.#editor ? this.#editor.setText(value) : this.#draw(value)));
    });

    /** A field that can no longer be edited gives its view up. */
    effect(() => {
      if (!this.#canEdit()) untracked(() => this.#unmount());
    });

    this.#destroyRef.onDestroy(() => this.#editor?.destroy());
  }

  /**
   * The live view, while there is one — for a host that runs commands, and
   * for tests. Not a signal: it comes and goes with the pointer, and nothing
   * should render from that.
   */
  editor(): LineEditor | undefined {
    return this.#editor;
  }

  /** Moves focus into the field — what `focusBoundControl` calls. */
  focus(): void {
    this.engage();
    this.#editor?.focus();
  }

  protected hover(event: PointerEvent): void {
    if (event.pointerType === 'mouse') this.#mount();
  }

  protected leave(): void {
    if (!this.#hasFocus()) this.#unmount();
  }

  protected press(event: PointerEvent): void {
    if (this.#editor || event.pointerType === 'mouse') return;
    this.#pressed = this.#mount();
  }

  protected release(event: PointerEvent): void {
    if (!this.#pressed || !this.#editor) return;
    this.#pressed = false;

    const { view } = this.#editor;
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (hit)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.pos)));
    view.focus();
  }

  /**
   * Focus from the keyboard, or a press the view was already there for. A
   * resumed view keeps the caret where it was left; a fresh one puts it at the
   * end, where a writer coming back to a prompt usually goes on.
   */
  protected engage(): void {
    if (this.#editor) return;

    const fresh = !this.#resumable();
    if (!this.#mount()) return;

    const { view } = this.#editor!;
    if (fresh) view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    view.focus();
  }

  protected blur(): void {
    // `focusout` fires before focus lands anywhere: wait for it to settle, so a
    // focus moving within the field is not taken for one leaving it.
    queueMicrotask(() => {
      if (this.#hasFocus()) return;
      this.touch.emit();
      if (!this.#host.nativeElement.matches(':hover')) this.#unmount();
    });
  }

  /**
   * The kept state, if it is still good: only for the text it holds — a value
   * written from outside since then starts the history over.
   */
  #resumable(): EditorState | undefined {
    const state = this.#state;
    return state && serializePromptDoc(state.doc) === this.value() ? state : undefined;
  }

  #hasFocus(): boolean {
    return this.#host.nativeElement.contains(document.activeElement);
  }

  /** Hands the element to a view. Returns whether one is live afterwards. */
  #mount(): boolean {
    if (this.#editor) return true;
    if (!this.#canEdit()) return false;

    const value = this.value();
    const resumable = this.#resumable();

    const editor = createPromptEditor({
      mount: this.#host.nativeElement,
      extensions: EXTENSIONS,
      state: resumable,
      onUpdate: (current) => this.value.set(current.getText()),
    });
    if (!resumable) editor.setText(value);

    this.#editor = editor;
    this.#drawn = undefined;
    return true;
  }

  /** Hands the element back to the static copy. */
  #unmount(): void {
    const editor = this.#editor;
    if (!editor) return;

    this.#state = editor.state;
    this.#editor = undefined;
    editor.destroy();
    this.#draw(this.value());
  }

  #draw(value: string): void {
    if (value === this.#drawn) return;
    renderPrompt(value, this.#host.nativeElement);
    this.#drawn = value;
  }
}
