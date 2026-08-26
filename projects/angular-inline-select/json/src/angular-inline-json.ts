import {
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  inject,

  // Signals
  computed,
  output,
  model,
  viewChild,
  contentChild,
  input,
  effect,
  afterNextRender,
  afterRenderEffect,
  signal,
  untracked,
  linkedSignal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormValueControl, type ValidationError } from '@angular/forms/signals';

// Shared chrome — generic (dialog service/actions/affixes/clear bubble), not text-specific.
import {
  BubbleMenu,
  EDITABLE_SCOPE,
  EditableClearButton,
  EditableClearTemplate,
  type EditableClearContext,
  EditableDialog,
  EditableDialogRef,
  EditableErrorTemplate,
  EditablePrefix,
  EditableSuffix,
} from 'angular-inline-select';

import { printEditableJson } from './json-doc';
import { canonicalJson, parseJsonDraft } from './json-codec';
import {
  fallbackTruncate,
  truncateToVisualLines,
  type InlinePreviewGeometry,
} from './json-preview';
import type { JsonSessionData } from './json-session';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineJsonSaved {
  /** The value the session settled on — raw JSON text (DB-friendly), or the restored baseline. */
  value: string;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * Inline JSON: the committed value flows in the page as ordinary paragraph
 * text (a bounded, middle-ellipsed preview) and edits in a MODAL
 * `editable-dialog` hosting a CodeMirror JSON editor. The committed model is
 * always canonical strict JSON text — a plain string, MySQL/Postgres-
 * friendly, correctly typing primitives via native `JSON.parse`/`stringify`.
 *
 * Contract:
 * - The idle preview is NOT editable in place (unlike the plain-text field):
 *   it may already be a lossy, truncated summary of a huge value, so there is
 *   no coherent caret position to type into. Click, Enter, or Space opens
 *   the dialog — deliberately NOT the anchored in-place panel of the text
 *   family: a code editor wants a stable, centered (full-screen on touch)
 *   surface, not one glued to a text run.
 * - The editor accepts bare identifier keys (`role:`), everything else is
 *   strict — a trailing comma never commits. Commit canonicalizes through
 *   `JSON.stringify` (compact, double-quoted).
 */
@Component({
  selector: 'angular-inline-json',
  imports: [NgTemplateOutlet, BubbleMenu, EditableClearButton],
  templateUrl: './angular-inline-json.html',
  styleUrl: './angular-inline-json.scss',
  host: {
    class: 'editable-json',
    '[class.editable-json--editing]': 'editing()',
    '[class.editable-json--invalid]': 'errorsVisible()',
    '[style.display]': 'hidden() ? "none" : null',
    '(focus)': 'focus()',
  },
})
export class AngularInlineJson implements FormValueControl<string> {
  /** The idle preview block. Focusable, keyboard-activatable — clicking/Enter/Space elevates. */
  protected display = viewChild.required<ElementRef<HTMLElement>>('display');

  /** The in-flow field area (prefix + display + suffix) — the bubble's anchor. */
  protected fieldArea = viewChild.required<ElementRef<HTMLElement>>('fieldArea');

  /** The modal session host — MatDialog-shaped service, lazily fed the session component. */
  #dialog = inject(EditableDialog);

  // ---------------------------------------------------------------------------
  // Tab-to-accept scope (opt-in via an ancestor [editableScope])
  //
  // Registration only: the walk lands on the preview and `advanceMode:
  // 'edit'` opens the dialog — the one field where "just type" cannot start
  // the session. Tab INSIDE the dialog stays a text gesture (a modal is a
  // deliberate stop), so no keydown wiring here.
  // ---------------------------------------------------------------------------
  #scope = inject(EDITABLE_SCOPE, { optional: true });
  #hostEl = inject<ElementRef<HTMLElement>>(ElementRef);
  #scopeDestroyRef = inject(DestroyRef);

  #registerWithScope = afterNextRender(() => {
    const scope = this.#scope;
    if (!scope) return;

    const unregister = scope.register({
      host: this.#hostEl.nativeElement,
      entry: this.display().nativeElement,
      beginEdit: () => this.elevate(),
    });
    this.#scopeDestroyRef.onDestroy(unregister);
  });

  /** The committed value channel: raw JSON text (DB-friendly), never re-serialized on commit. */
  value = model('');

  /** Form Value Contract */
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  invalid = input(false);
  touched = input(false);
  hidden = input(false);
  touch = output<void>();

  /** Whether the field is elevated (an edit session is open). Two-way bindable. */
  editing = model<boolean>(false);

  placeholder = input<string>('null');

  /** Accessible name for the field (the preview has no native label association). */
  ariaLabel = input<string | undefined>(undefined);

  /** Idle-preview budget: hard cap on rendered VISUAL lines at the current width. */
  maxPreviewLines = input<number>(5);

  /** Affix templates — same dual channel (input or `ng-template[editablePrefix/Suffix]` content) as every inline control. */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected suffixTpl = computed(() => this.suffixTemplate() ?? this.contentSuffix()?.templateRef);

  /**
   * Consumer error content — the mat-error analogue. A TEMPLATE (not element
   * projection) because the session UI renders in a portaled dialog
   * component where `<ng-content>` cannot reach. Same dual channel as every
   * other slot: input for composition, `ng-template[editableError]` content
   * sugar for direct use.
   */
  errorTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentError = contentChild(EditableErrorTemplate);

  protected errorTpl = computed(() => this.errorTemplate() ?? this.contentError()?.templateRef);

  /**
   * THE consumer commit event — fires once per changed settlement with the
   * raw JSON text model.
   */
  savedModelChange = output<{ value: string }>();

  /**
   * The MACHINERY channel: exactly one emission per settled edit session —
   * Save, Discard, and clear alike, changed or not. Wrapping controls bind
   * this; app consumers should bind `savedModelChange`.
   */
  saved = output<InlineJsonSaved>();

  /**
   * The session baseline: follows the committed value while idle and freezes
   * for the duration of an edit session, exactly like the text field.
   */
  previous = linkedSignal<string, string>({
    source: () => this.value() ?? '',
    computation: (source, prev) => (this.editing() ? (prev?.value ?? '') : source),
  });

  isEmpty = computed(() => (this.value() ?? '') === '');

  /**
   * The canonical (strict, compact, double-quoted) reading of the session
   * baseline. An unparseable baseline (set externally) canonicalizes to
   * itself, so it still compares meaningfully against a fixed draft.
   */
  #canonicalBaseline = computed(() => canonicalJson(this.previous()) ?? this.previous());

  /**
   * Session-scoped dirty — SEMANTIC, not textual: the seeded reformat and
   * bare-key sugar never count as changes; only a draft that canonicalizes
   * differently (or does not parse at all) is dirty.
   */
  protected isDirty = computed(() => {
    const draft = canonicalJson(this.value() ?? '');
    return draft === null || draft !== this.#canonicalBaseline();
  });

  /** The draft parse — the same gate the commit path and the editor's lint diagnostic both run. */
  protected parseResult = computed(() => parseJsonDraft(this.value() ?? ''));
  protected parseFailed = computed(() => this.parseResult().error !== undefined);

  /**
   * The field dictates validity: the bound field's verdict, external errors,
   * OR an unparseable draft — a syntax error (trailing comma included) is
   * invalid on its own, with no external schema required to say so.
   */
  protected isInvalid = computed(
    () => this.invalid() || this.errors().length > 0 || this.parseFailed(),
  );

  #selfTouched = signal(false);
  #saveAttempted = signal(false);
  protected errorsVisible = computed(
    () => this.isInvalid() && (this.touched() || this.#selfTouched() || this.#saveAttempted()),
  );

  /** Contract error messages plus the live parse error (if any) while errors are visible. */
  protected errorMessages = computed(() => {
    const messages = this.errors()
      .filter((error) => !!error.message)
      .map((error) => error.message!);
    const parseError = this.parseResult().error;
    return parseError !== undefined ? [...messages, parseError] : messages;
  });

  // NOTE: unlike the text control — whose `editing` model has many writers
  // and needs an edge-detecting effect — every session here opens through
  // `#openSession()` and settles through `#handleSessionClosed()`, so the
  // per-session flags and the `touch` emission live at those choke points.

  /**
   * The in-flow display freezes at the session baseline while editing, so
   * live draft propagation through `value` never reflows the preview.
   */
  protected previewText = computed(() => (this.editing() ? this.previous() : (this.value() ?? '')));

  /**
   * What the preview flows as: the COMPACT canonical serialization — the
   * value presented exactly as stringified-JSON text, running inline with
   * the surrounding paragraph. An unparseable value (set externally) shows
   * its raw text so it can at least be recognized and fixed.
   */
  #previewSource = computed(() => {
    const text = this.previewText();
    if (text === '') return '';
    return canonicalJson(text) ?? text;
  });

  /**
   * The measured middle-ellipsis truncation for the CURRENT geometry, tagged
   * with the source it was computed from so a source change can never flash
   * a stale cut. `null` until the first post-render measurement (or where
   * measurement is impossible — SSR, jsdom).
   */
  #measuredPreview = signal<{ source: string; text: string } | null>(null);

  /** Bumped by the ResizeObserver when the containing block's width changes. */
  #measureTick = signal(0);

  /**
   * The rendered preview text: the measured visual-line truncation when one
   * exists for this source, else the measurement-free character-budget cut
   * (refined on the very next render pass).
   */
  protected displayedPreview = computed(() => {
    const source = this.#previewSource();
    if (source === '') return '';

    const measured = this.#measuredPreview();
    if (measured !== null && measured.source === source) return measured.text;

    return fallbackTruncate(source, this.maxPreviewLines());
  });

  /**
   * Re-measures after every render in which the source, the line budget, or
   * the container width (tick) changed. Runs in the render READ phase — all
   * layout reads, zero writes; the truncation itself is pure canvas-metric
   * arithmetic (pretext), so no reflow is ever forced here.
   */
  #measurePreviewEffect = afterRenderEffect({
    read: () => {
      const source = this.#previewSource();
      const maxLines = this.maxPreviewLines();
      this.#measureTick();

      untracked(() => {
        const text = source === '' ? null : this.#measurePreview(source, maxLines);
        this.#measuredPreview.set(text === null ? null : { source, text });
      });
    },
  });

  #measurePreview(source: string, maxLines: number): string | null {
    const geometry = this.#resolvePreviewGeometry();
    if (geometry === null) return null;

    try {
      return truncateToVisualLines(source, maxLines, geometry);
    } catch {
      return null; // no canvas text metrics (jsdom/SSR) — the fallback stands
    }
  }

  /**
   * The paragraph slot the preview flows in: the containing block's content
   * width (every wrapped line) and the width remaining on the line the
   * preview STARTS on (it begins mid-paragraph, after whatever copy precedes
   * it). The span's start position does not depend on its own content, so
   * measuring while the fallback text is rendered is sound.
   */
  #resolvePreviewGeometry(): InlinePreviewGeometry | null {
    const el = this.display().nativeElement;

    let block = el.parentElement;

    while (block !== null && getComputedStyle(block).display.startsWith('inline')) {
      block = block.parentElement;
    }

    if (block === null) return null;

    const blockStyle = getComputedStyle(block);
    const blockRect = block.getBoundingClientRect();
    const contentLeft =
      blockRect.left +
      (parseFloat(blockStyle.paddingLeft) || 0) +
      (parseFloat(blockStyle.borderLeftWidth) || 0);
    const contentRight =
      blockRect.right -
      (parseFloat(blockStyle.paddingRight) || 0) -
      (parseFloat(blockStyle.borderRightWidth) || 0);

    const lineWidth = contentRight - contentLeft;
    if (!(lineWidth > 48)) return null;

    this.#observeBlockResize(block);

    const startX = el.getClientRects()[0]?.left ?? contentLeft;
    const firstLineWidth = Math.max(contentRight - startX, 0);

    const style = getComputedStyle(el);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const letterSpacing = parseFloat(style.letterSpacing);

    return {
      firstLineWidth,
      lineWidth,
      font,
      letterSpacing: Number.isFinite(letterSpacing) ? letterSpacing : undefined,
    };
  }

  #resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => this.#measureTick.update((tick) => tick + 1));

  #observedBlock: Element | null = null;

  #observeBlockResize(block: Element) {
    if (this.#resizeObserver === null || this.#observedBlock === block) return;

    if (this.#observedBlock !== null) this.#resizeObserver.unobserve(this.#observedBlock);
    this.#resizeObserver.observe(block);
    this.#observedBlock = block;
  }

  // ---------------------------------------------------------------------------
  // Elevation: bounded preview → lazily-loaded session in the modal dialog
  // ---------------------------------------------------------------------------
  protected elevate() {
    if (this.editing() || this.disabled() || this.readonly()) return;

    // Pin the baseline: `previous` derives from `value` while idle — reading
    // it here syncs it to the committed value before `editing` freezes it.
    this.previous();

    this.editing.set(true);
  }

  /**
   * Click opens the session — UNLESS the user is selecting preview text.
   * The preview presents as ordinary paragraph text (the soul of inline),
   * and real text is selectable/copyable; a selection gesture must never
   * cost the user a dialog. Keyboard activation (below) always elevates.
   */
  protected handleActivateClick() {
    const displayEl = this.display().nativeElement;
    const selection = displayEl.ownerDocument.getSelection();

    if (
      selection !== null &&
      !selection.isCollapsed &&
      selection.anchorNode !== null &&
      displayEl.contains(selection.anchorNode)
    ) {
      return;
    }

    this.elevate();
  }

  /** Enter/Space activate the preview exactly like a click; Space must not scroll the page. */
  protected handleActivateKey(event: Event) {
    event.preventDefault();
    this.elevate();
  }

  #dialogRef: EditableDialogRef | null = null;
  #opening = false;

  /**
   * `editing` is the ONE session switch — every path (click, keyboard, an
   * external `editing.set(true)`) funnels through it, and this effect maps
   * it onto the dialog: open lazily on the rising edge, close the ref on the
   * falling one (e.g. a programmatic `reset()`).
   */
  #syncDialog = effect(() => {
    const open = this.editing();

    untracked(() => {
      if (open && this.#dialogRef === null && !this.#opening) void this.#openSession();
      else if (!open && this.#dialogRef !== null) this.#dialogRef.close();
    });
  });

  /**
   * Opens the session dialog. The session component — and CodeMirror behind
   * it — loads via `await import(…)`: consumers pay for the editor the first
   * time a session opens, not on page load.
   *
   * Opens reformatted into the EDITING form — pretty-printed, bare
   * identifier keys (`printEditableJson`) — when the stored text parses; an
   * unparseable stored value (set externally) opens as-is so it can be
   * fixed. Semantic dirty/commit comparison means the reformat never counts
   * as a change.
   */
  /**
   * The baseline captured as a PLAIN value at session open. `previous()` is
   * only frozen while `editing` is true — a programmatic `editing.set(false)`
   * unfreezes it BEFORE the close handler runs, collapsing it to the live
   * draft; reverting against it would silently leak the draft into the
   * committed model. This field survives that edge.
   */
  #sessionBaseline = '';

  async #openSession() {
    this.#opening = true;

    try {
      // Rising edge of EVERY open path (elevate or an external
      // `editing.set(true)`): a stale save attempt never flashes errors
      // onto the fresh draft.
      this.#saveAttempted.set(false);

      // `previous()` is frozen at the committed value here (editing is true).
      this.#sessionBaseline = this.previous();

      const draft = this.value() ?? '';
      const parsed = parseJsonDraft(draft);
      const seeded =
        parsed.error === undefined && parsed.value !== undefined
          ? printEditableJson(parsed.value)
          : draft;

      if (seeded !== draft) this.value.set(seeded);

      const { JsonSession } = await import('./json-session');

      // The import is an async gap: the session may have been cancelled
      // (editing flipped back) or the component destroyed while the editor
      // loaded — opening now would orphan a dialog nothing owns.
      if (this.#destroyed || !this.editing()) return;

      const data: JsonSessionData = {
        seed: seeded,
        onDraftChange: (text) => this.value.set(text),

        errorsVisible: this.errorsVisible,
        errorMessages: this.errorMessages,
        errorTemplate: this.errorTpl,
        isDirty: this.isDirty,

        prefixTemplate: this.prefixTpl,
        suffixTemplate: this.suffixTpl,

        close: (sessionDraft) => this.#acceptSession(sessionDraft),
        cancel: () => this.#dialogRef?.close(),
      };

      const ref = this.#dialog.open(JsonSession, {
        ariaLabel: this.ariaLabel() ?? 'Edit JSON',
        data,
      });

      this.#dialogRef = ref;

      // The settlement safety net: runs exactly once per session for EVERY
      // close path — accept, discard, Escape, scrim click, navigation.
      void ref.closed.then(() => this.#handleSessionClosed());
    } finally {
      this.#opening = false;
    }
  }

  #handleSessionClosed() {
    this.#dialogRef = null;

    // Destroy teardown: the owner is gone — no rollback, no emissions.
    if (this.#destroyed) return;

    // An interaction or an instruction? User paths (Save, Discard, Escape,
    // scrim, navigation) close the ref while `editing` is still true;
    // programmatic paths (`reset()`, an external `editing.set(false)`) flip
    // `editing` FIRST — so the value here IS the distinction.
    const userSettled = this.editing();

    if (this.accepted) {
      this.accepted = false;
    } else {
      this.revert();
    }

    if (!userSettled) return;

    this.editing.set(false);

    // The blur analogue (mat semantics), then focus returns to the in-flow
    // display for Tab continuity — user-driven settles only.
    this.#selfTouched.set(true);
    this.touch.emit();
    this.display().nativeElement.focus();
  }

  // ---------------------------------------------------------------------------
  // Commit / revert
  // ---------------------------------------------------------------------------
  accepted = false;

  /**
   * THE accept path — handed to the session as its `close(draft)` callback.
   * Canonicalizes the draft back to strict JSON text and settles the rest
   * state; an invalid draft (trailing comma included) keeps the dialog open
   * and reveals the errors instead.
   */
  #acceptSession(draft: string) {
    // Sync the live channel first — Save must judge exactly what was typed.
    if ((this.value() ?? '') !== draft) this.value.set(draft);

    // Mat-style submit attempt: an invalid draft doesn't commit — it reveals
    // the errors (through the signals the session renders) so the user can
    // react. Checked FIRST: an unparseable draft has no canonical form.
    if (this.isInvalid()) {
      this.#saveAttempted.set(true);
      this.#selfTouched.set(true);
      this.touch.emit();
      return;
    }

    // The committed form is CANONICAL strict JSON — compact, double-quoted —
    // regardless of how the draft was typed (bare keys, editor indentation).
    // That is what the model carries and what lands in the database.
    const canonical = canonicalJson(draft) ?? '';
    const baseline = this.previous();
    const changed = canonical !== this.#canonicalBaseline();

    if (!changed) {
      this.accepted = true;
      // The live channel holds the editing-form draft (seeded reformat, bare
      // keys); an unchanged close restores the untouched baseline text.
      if ((this.value() ?? '') !== baseline) this.value.set(baseline);
      this.#dialogRef?.close();
      this.saved.emit({ value: baseline, changed: false });
      return;
    }

    this.accepted = true;
    this.value.set(canonical);

    this.savedModelChange.emit({ value: canonical });
    this.saved.emit({ value: canonical, changed: true });
    this.#dialogRef?.close();
  }

  /**
   * Restores the baseline (dismissals: Discard, Escape, scrim click,
   * navigation, programmatic close). Uses the CAPTURED session baseline —
   * `previous()` may already have unfrozen on programmatic closes.
   */
  protected revert() {
    const draft = this.value() ?? '';
    const baseline = this.#sessionBaseline;

    if (draft !== baseline) this.value.set(baseline);
    if (this.editing()) this.saved.emit({ value: baseline, changed: false });
  }

  // ---------------------------------------------------------------------------
  // Clear affordance (the floating bubble lives in BubbleMenu)
  // ---------------------------------------------------------------------------
  /**
   * Consumer clear affordance — REPLACES the stock button inside the bubble.
   * See {@link EditableClearTemplate}: the context callback is what makes a
   * confirm-before-clear possible (clearing IS the commit).
   */
  clearTemplate = input<TemplateRef<EditableClearContext> | undefined>(undefined);

  private contentClear = contentChild(EditableClearTemplate);

  protected clearTpl = computed(() => this.clearTemplate() ?? this.contentClear()?.templateRef);

  /** The stock accessible name — the context's `label`, and the default button's. */
  protected readonly clearLabel = 'Clear value';

  /** Stable context object — an async confirmation calls into a live control. */
  protected readonly clearContext: EditableClearContext = {
    $implicit: () => this.clearValue(),
    clear: () => this.clearValue(),
    side: null,
    label: this.clearLabel,
    focus: () => this.focus(),
  };

  protected bubbleMenuCanShow = computed(
    () =>
      !this.required() &&
      !this.disabled() &&
      !this.readonly() &&
      !this.isEmpty() &&
      !this.editing(),
  );

  protected clearValue(event?: Event) {
    // Absent when a consumer's own affordance calls through the template
    // context — possibly long after its click (a confirmation dialog).
    event?.preventDefault();
    event?.stopPropagation();
    if (this.editing()) return;

    this.value.set('');
    this.savedModelChange.emit({ value: '' });
    this.saved.emit({ value: '', changed: true });

    this.#selfTouched.set(true);
    this.touch.emit();
  }

  // ---------------------------------------------------------------------------
  // FormUiControl contract
  // ---------------------------------------------------------------------------
  focus(options?: FocusOptions) {
    this.display().nativeElement.focus(options);
  }

  reset() {
    this.#selfTouched.set(false);
    this.#saveAttempted.set(false);

    if (!this.editing()) return;

    const baseline = this.previous();
    if ((this.value() ?? '') !== baseline) this.value.set(baseline);

    this.accepted = true; // suppress the revert — the reset already restored the baseline
    this.editing.set(false); // flipping first marks the close as programmatic: no touch, no focus steal
  }

  #destroyed = false;

  #cleanupOnDestroy = inject(DestroyRef).onDestroy(() => {
    this.#destroyed = true;
    // The dialog lives in the app-rooted overlay — without this it would
    // OUTLIVE a destroyed component (an @if removing the control) with dead
    // callbacks. Navigation disposal is covered by the overlay itself.
    this.#dialogRef?.close();
    this.#resizeObserver?.disconnect();
  });
}
