// Angular
import {
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  TemplateRef,

  // Signals
  afterNextRender,
  computed,
  contentChild,
  effect,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DOCUMENT, NgComponentOutlet, NgTemplateOutlet } from '@angular/common';

// Forms
import { FormValueControl, type ValidationError } from '@angular/forms/signals';

// CDK
import {
  CdkConnectedOverlay,
  CdkConnectedOverlayConfig,
  ConnectedOverlayPositionChange,
  OverlayModule,
} from '@angular/cdk/overlay';
import { A11yModule, _IdGenerator } from '@angular/cdk/a11y';

// Editables
import {
  getSelectionOffsets,
  setCaretOffset,
  replayEdit,
  filterChars,
  alignCaret,
  caretOffsetNearPoint,
  type SelectionOffsets,
} from './caret';
import { EDITABLE_SCOPE } from '../utils/editable-scope/editable-scope';
import {
  watchHoverScope,
  type EditableHoverScopePress,
} from '../utils/editable-hover-scope/editable-hover-scope';
import { EditablePrefix, EditableSuffix } from './editable-affix';
import { EditableHint } from './editable-hint';
import { EditableMenu } from './editable-menu';
import { BubbleMenu } from '../bubble-menu/bubble-menu';
import {
  EditableClearButton,
  EditableClearTemplate,
  type EditableClearContext,
} from '../bubble-menu/editable-clear';
import {
  EditableActionsTemplate,
  type EditableActionsContext,
} from '../bubble-menu/editable-actions';
import {
  EDITABLE_PANEL_ACTIONS,
  EDITABLE_PANEL_ACTIONS_CONTEXT,
  EditablePanelActionsTemplate,
  type EditablePanelActionsContext,
  type EditablePanelActionsTemplateContext,
} from './editable-panel-actions';
import { EditableTextIntl } from './editable-text-intl';
import { makeSlashMenu } from './slash-menu';
import { watchContentEnd } from './content-end';
import {
  panelCeiling,
  panelPositions,
  PANEL_PADDING_FALLBACK,
  PANEL_VIEWPORT_MARGIN,
  resolvePanelPadding,
} from './panel-geometry';
import {
  compileCharFilter,
  insertPlainText,
  passDraft,
  SUPPORTS_PLAINTEXT_ONLY,
} from './draft-pass';
import { makeTextErrorState } from './text-error-state';

interface ValueNormalizationDetails {
  value: string;
  changed: boolean;
}

/** How a single-line display paints text wider than its container: ellipsize, or wrap. */
export type InlineTextWrapBehavior = 'wrap' | 'noWrap';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineTextSaved {
  /** The value the session settled on — the committed value or the restored baseline. */
  value: string;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/** Trims leading/trailing whitespace only — interior spaces and line breaks are content. */
export function normalizeString(value: string): string {
  return value.trim();
}

/**
 * Inline text: a static in-flow text that elevates into a floating editor.
 *
 * - The in-flow display never changes size — focus and Tab are free.
 * - The first real edit (keystroke, paste, IME) opens the editor in an overlay
 *   panel at a readable measure over a scrim.
 * - `value` follows the draft live; Save / Cmd+Enter / Enter (single-line)
 *   commit it, Escape / Discard / the scrim revert it.
 */
@Component({
  selector: 'angular-inline-text',
  imports: [
    // Angular
    NgTemplateOutlet,
    NgComponentOutlet,

    // CDK
    OverlayModule,
    A11yModule,

    // Components
    BubbleMenu,
    EditableClearButton,
  ],
  templateUrl: './angular-inline-text.html',
  styleUrl: './angular-inline-text.scss',
  host: {
    // Attributes
    class: 'editable-text',

    // Classes
    '[class.editable-text--editing]': 'editing()',
    '[class.editable-text--invalid]': 'errorsVisible()',
    '[class.editable-text--scoped]': 'hasHoverScope()',

    // Styles
    '[style.display]': 'hidden() ? "none" : null',

    // Listeners
    '(focus)': 'focus()',
  },
})
export class AngularInlineText implements FormValueControl<string> {
  /** The in-flow text: focusable and caret-able, never mutated by typing. */
  protected display = viewChild.required<ElementRef<HTMLElement>>('display');

  /** Prefix + display + suffix — the bubble's anchor and measure box. */
  protected fieldArea = viewChild.required<ElementRef<HTMLElement>>('fieldArea');

  /** The panel's contenteditable — exists only while editing. */
  protected editor = viewChild<ElementRef<HTMLElement>>('editor');

  /** The slash menu's container — exists only while the menu is open. */
  protected menuContainer = viewChild<ElementRef<HTMLElement>>('menuContainer');

  /** The overlay hosting the panel — its pane is measured where it was placed. */
  protected panelOverlay = viewChild.required(CdkConnectedOverlay);

  // DI-scoped, so the sequence is deterministic across SSR and hydration.
  protected readonly panelId = inject(_IdGenerator).getId('editable-panel-');

  /** The value channel: the live draft while editing, the committed value otherwise. */
  value = model('');

  /** Form Value Contract. */
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  /** The bound field's verdict on validity. */
  invalid = input(false);
  /** The bound field's touched state — `markAsTouched()` reveals errors without interaction. */
  touched = input(false);
  hidden = input(false);

  /** Form Value Contract: touch — on a session's close, a refused save, and a clear. */
  touch = output();

  /** A discarded draft (Escape, Discard, scrim, detach). Superseded by `saved`, kept for now. */
  reverted = output<string>();

  /** THE consumer commit event: once per changed settlement, with `{ value }`. */
  savedModelChange = output<{ value: string }>();

  /**
   * The machinery channel: exactly one emission per settled session (Save,
   * Discard, clear — changed or not). Wrapping controls and adapters bind this;
   * app code binds `savedModelChange`.
   */
  saved = output<InlineTextSaved>();

  /** Whether an edit session is open. Two-way bindable. */
  editing = model(false);

  /**
   * The VALUE is one line: Enter accepts, pasted breaks become spaces. Says
   * nothing about painting — see `wrapBehavior`.
   */
  isSingleLine = input(false);

  /**
   * Single-line only: `'noWrap'` ellipsizes at the width constraint, `'wrap'`
   * paints the line over several visual lines. Multi-line fields (and the
   * editor) always wrap.
   */
  wrapBehavior = input<InlineTextWrapBehavior>('noWrap');

  protected wrapMode = computed<InlineTextWrapBehavior>(() =>
    this.isSingleLine() ? this.wrapBehavior() : 'wrap',
  );

  placeholder = input('N/A');

  /** Accessible name (a contenteditable has no native label). */
  ariaLabel = input<string | undefined>(undefined);

  /**
   * Affix templates (matPrefix/matSuffix). The input is the composition channel
   * for wrapping controls; direct use is `ng-template[editablePrefix/Suffix]`.
   * Always outside the contenteditable and `aria-hidden`.
   */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected suffixTpl = computed(() => this.suffixTemplate() ?? this.contentSuffix()?.templateRef);

  /** Live feedback in the panel footer (previews, counters). Input or `ng-template[editableHint]`. */
  hintTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentHint = contentChild(EditableHint);

  protected hintTpl = computed(() => this.hintTemplate() ?? this.contentHint()?.templateRef);

  /** Virtual-keyboard hint on mobile (`'decimal'`, `'tel'`, `'email'` …). */
  inputMode = input<string | undefined>(undefined);

  /**
   * Slash-command menu, dormant unless provided: the consumer owns the options
   * and the search, the control the trigger, keyboard and ARIA. Input or
   * `ng-template[editableMenu]`.
   */
  menuTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentMenu = contentChild(EditableMenu);

  protected menuTpl = computed(() => this.menuTemplate() ?? this.contentMenu()?.templateRef);

  #menu = makeSlashMenu({
    template: () => this.menuTpl(),
    container: () => this.menuContainer()?.nativeElement,
    editor: () => this.editor()?.nativeElement,
    afterApply: () => this.handleEditorInput(),
  });

  protected menuActiveId = this.#menu.activeId;
  protected menuOpen = this.#menu.open;
  protected menuContext = this.#menu.context;

  /** Trims edge whitespace on commit — interior spacing is never touched. */
  normalizeValue = input(false);

  /**
   * Per-character filter: rejected characters never reach the draft (keys and
   * paste everywhere; drop and IME once the panel is open). A keystroke it
   * erases does not open the editor. It filters, it does not validate.
   */
  allowedChars = input<RegExp | undefined>(undefined);

  /**
   * The text a session OPENS with when the display is a different rendering of
   * the committed value (the number wrapper hands `1.250.000,50` back as
   * `1250000,5`). An unchanged save restores the rendering.
   */
  draftText = input<((committed: string) => string) | undefined>(undefined);

  #charFilter = computed(() => compileCharFilter(this.allowedChars()));

  /**
   * The session baseline: follows `value` while idle, frozen while editing —
   * what a revert restores. Frozen on `editing`, never on field-dirty (sticky
   * across sessions, it would never thaw).
   */
  previous = linkedSignal<string, string>({
    source: () => this.value() ?? '',
    computation: (source, prev) => (this.editing() ? (prev?.value ?? source) : source),
  });

  isEmpty = computed(() => (this.value() ?? '') === '');

  /** The draft differs from the baseline right now. */
  protected isDirty = computed(() => this.normalization().changed);

  /** The display freezes at the baseline while editing, so the live draft never reflows the page. */
  protected displayText = computed(() => (this.editing() ? this.previous() : (this.value() ?? '')));

  #errors = makeTextErrorState({
    invalid: this.invalid,
    errors: this.errors,
    touched: this.touched,
    editing: this.editing,
    empty: this.isEmpty,
    onSessionClosed: () => this.touch.emit(),
  });

  protected isInvalid = this.#errors.isInvalid;
  protected errorsVisible = this.#errors.errorsVisible;
  protected errorMessages = this.#errors.errorMessages;

  /** A pointer inside the panel: the session's touch. */
  protected markSessionTouched() {
    this.#errors.markSessionTouched();
  }

  /** The draft as it would commit (edge-trimmed when `normalizeValue`), and whether it changed. */
  normalization = computed((): ValueNormalizationDetails => {
    const value = this.value() ?? '';
    const previous = this.draftBaseline();

    if (!this.normalizeValue()) {
      return {
        value,
        changed: value !== previous,
      };
    }

    const normalized = normalizeString(value);
    return {
      value: normalized,
      changed: normalized !== previous,
    };
  });

  /** Locked fields are not editable; otherwise prefer `plaintext-only`. */
  protected editableMode = computed(() => {
    if (this.disabled() || this.readonly()) return 'false';

    return SUPPORTS_PLAINTEXT_ONLY ? 'plaintext-only' : 'true';
  });

  // -- The elevated panel -------------------------------------------------------

  /** Resolved from `--mat-sys-inner-spacing` when a session opens. */
  #panelPadding = signal(PANEL_PADDING_FALLBACK);

  protected panelOverlayConfig = computed((): CdkConnectedOverlayConfig => ({
    origin: this.display(),
    positions: panelPositions(this.#panelPadding()),
    hasBackdrop: true,
    backdropClass: 'editable-scrim',
    viewportMargin: PANEL_VIEWPORT_MARGIN,
    push: true,
    disableClose: true, // Escape is the panel's (revert semantics)
    disposeOnNavigation: true,
  }));

  #document = inject(DOCUMENT);

  /** How tall the panel may grow from where it was placed (px); null until placed. */
  protected panelMaxHeight = signal<number | null>(null);

  /**
   * The overlay placed the panel: cap its height to the room past its anchored
   * edge. The panel is placed while still small (the draft is seeded after
   * attach) and never re-placed as it grows, so without the cap a long draft
   * runs off-screen.
   */
  protected handlePanelPlaced(change: ConnectedOverlayPositionChange) {
    const pane = this.panelOverlay().overlayRef?.overlayElement;
    if (!pane) return;

    const viewportHeight = this.#document.documentElement.clientHeight;
    this.panelMaxHeight.set(
      panelCeiling(pane.getBoundingClientRect(), change.connectionPair.overlayY, viewportHeight),
    );
  }

  // -- Elevation: display → editor ----------------------------------------------

  /** Caret offset to restore in the editor once the panel attaches. */
  #pendingCaret: number | null = null;

  /** Opens a session: pins the baseline, seeds the draft, remembers the caret. */
  protected elevate(caret: number | null = null, seed?: string) {
    if (this.editing() || this.disabled() || this.readonly()) return;

    this.#panelPadding.set(resolvePanelPadding(this.display().nativeElement));

    // Reading `previous` syncs it to the committed value before `editing` freezes it.
    const committed = this.previous();

    this.#pendingCaret = caret;
    this.editing.set(true);

    if (seed !== undefined && seed !== committed) {
      this.value.set(seed); // the live draft channel: parents see the seed too
    }
  }

  /**
   * Keyboard focus lands without a selection, and without one the browser paints
   * no caret on a multi-line display — place it at the end. A click has already
   * placed it, and wins.
   */
  protected handleDisplayFocus() {
    if (this.disabled() || this.readonly() || this.editing()) return;

    const el = this.display().nativeElement;
    if (getSelectionOffsets(el) !== null) return;

    setCaretOffset(el, (this.value() ?? '').length);
  }

  #filter(text: string, caret: number) {
    const allow = this.#charFilter();
    return allow ? filterChars(text, caret, allow) : { text, caret };
  }

  /** The session baseline as the editor sees it — through `draftText` when set. */
  protected draftBaseline = computed(() => {
    const toDraft = this.draftText();
    const baseline = this.previous();
    return toDraft ? toDraft(baseline) : baseline;
  });

  /** What a session opens with: the committed text (or its draft rendering) and the display's selection. */
  protected openingDraft(): { text: string; selection: SelectionOffsets } {
    const committed = this.value() ?? '';
    const toDraft = this.draftText();
    const text = toDraft ? toDraft(committed) : committed;

    const raw = getSelectionOffsets(this.display().nativeElement) ?? {
      start: committed.length,
      end: committed.length,
    };
    const selection = toDraft
      ? { start: alignCaret(committed, text, raw.start), end: alignCaret(committed, text, raw.end) }
      : raw;

    return { text, selection };
  }

  /** The filter erased the edit: nothing mutated, so nothing happens — not even elevation. */
  #filteredToNothing(filtered: string, raw: string, committed: string) {
    return filtered !== raw && filtered === committed;
  }

  /**
   * The display is caret-able but immutable: every `beforeinput` is cancelled,
   * replayed onto the committed text and elevated — typing never reflows the page.
   */
  protected interceptBeforeInput(event: Event) {
    event.preventDefault();
    if (this.disabled() || this.readonly() || this.editing()) return;

    // Cut needs `clipboardData` — the `(cut)` handler owns it.
    if ((event as InputEvent).inputType === 'deleteByCut') return;

    const { text: committed, selection } = this.openingDraft();

    const replayed = replayEdit(committed, selection, event as InputEvent, this.isSingleLine());

    if (!replayed) {
      // Not replayable (undo, drop, formatting): elevate unchanged, the editor handles it.
      this.elevate(selection.start, committed);
      return;
    }

    const filtered = this.#filter(replayed.text, replayed.caret);
    if (this.#filteredToNothing(filtered.text, replayed.text, committed)) return;

    this.elevate(filtered.caret, filtered.text);
  }

  /** Cut on the display: clipboard + elevate with the selection removed — one gesture. */
  protected interceptCut(event: ClipboardEvent) {
    if (this.disabled() || this.readonly() || this.editing()) return;
    event.preventDefault();

    const { text: committed, selection } = this.openingDraft();

    if (selection.start !== selection.end) {
      event.clipboardData?.setData('text/plain', committed.slice(selection.start, selection.end));
    }

    const remaining = committed.slice(0, selection.start) + committed.slice(selection.end);
    this.elevate(selection.start, remaining);
  }

  /** Paste on the display: splice into the draft, elevate. */
  protected interceptPaste(event: ClipboardEvent) {
    event.preventDefault();
    if (this.disabled() || this.readonly() || this.editing()) return;

    let text = event.clipboardData?.getData('text/plain') ?? '';
    if (this.isSingleLine()) text = text.replace(/\r?\n+/g, ' ');

    const { text: committed, selection } = this.openingDraft();

    const draft = committed.slice(0, selection.start) + text + committed.slice(selection.end);

    const filtered = this.#filter(draft, selection.start + text.length);
    if (this.#filteredToNothing(filtered.text, draft, committed)) return;

    this.elevate(filtered.caret, filtered.text);
  }

  /** IME cannot be cancelled via `beforeinput` — elevate on `compositionstart` (stray text is cleaned on attach). */
  protected handleCompositionStart() {
    if (this.disabled() || this.readonly() || this.editing()) return;

    const { text, selection } = this.openingDraft();
    this.elevate(selection.start, text);
  }

  /** Panel attached: undo stray display mutation, focus the editor, restore the caret. */
  protected handlePanelAttach() {
    // viewChild('editor') resolves after the overlay view is created.
    queueMicrotask(() => {
      const displayEl = this.display().nativeElement;
      const frozen = this.displayText();
      if ((displayEl.textContent ?? '') !== frozen) displayEl.textContent = frozen;

      const editorEl = this.editor()?.nativeElement;
      if (!editorEl) return;

      const draft = this.value() ?? '';
      if ((editorEl.innerText ?? editorEl.textContent ?? '') !== draft) {
        editorEl.textContent = draft;
      }

      editorEl.focus();
      setCaretOffset(editorEl, this.#pendingCaret ?? draft.length);
      this.#pendingCaret = null;

      // A `/` typed on the display opens the menu at once — no `input` fires for the seed.
      this.#menu.detect(editorEl);
    });
  }

  // -- Commit / revert ------------------------------------------------------------

  accepted = false;

  /** The per-field submit. */
  protected accept() {
    const { value, changed } = this.normalization();

    if (!changed) {
      // Under `draftText` an unchanged draft is only a rendering — the baseline settles.
      const settled = this.draftText() ? this.previous() : value;
      if ((this.value() ?? '') !== settled) this.value.set(settled);

      this.accepted = true; // the detach safety net must not also revert
      this.close();
      this.saved.emit({ value: settled, changed: false });
      return;
    }

    // Mat-style refused submit: reveal the errors, mark the field touched.
    if (this.isInvalid()) {
      this.#errors.markSessionTouched();
      this.#errors.markTouched();
      this.touch.emit();
      return;
    }

    this.accepted = true;

    // The one point where the page may reflow; the baseline thaws on close.
    this.value.set(value);

    this.savedModelChange.emit({ value });
    this.saved.emit({ value, changed: true });
    this.close();
  }

  /** The one choke point for discarding a draft: restores the baseline, emits `reverted`. */
  protected revert() {
    const draft = this.value() ?? '';
    const baseline = this.previous();
    const hadChanges = draft !== this.draftBaseline();

    if (draft !== baseline) this.value.set(baseline);

    if (hadChanges) this.reverted.emit(draft);

    // Runs twice per session at most (cancel, then detach) — only the in-session call settles.
    if (this.editing()) this.saved.emit({ value: baseline, changed: false });
  }

  protected cancel() {
    this.revert();
    this.close();
  }

  /** Closes the panel; focus returns to the display for Tab continuity. */
  protected close() {
    if (!this.editing()) return;

    this.editing.set(false);
    this.display().nativeElement.focus();
  }

  protected handleScrimClick() {
    this.cancel();
  }

  /** Detach safety net (navigation, destroy): never lose the baseline silently. */
  protected handlePanelDetach() {
    if (this.accepted) {
      this.accepted = false;
      return;
    }

    this.revert();
    if (this.editing()) this.editing.set(false);
  }

  // -- Tab-to-accept scope (an ancestor `[editableScope]`) ----------------------

  /** The ancestor scope, or `null` — a scopeless field keeps the focus trap. */
  #scope = inject(EDITABLE_SCOPE, { optional: true });

  /** The scope's Tab instruction, visually hidden in the panel's described-by messages. */
  protected scopeTabHint = computed(() =>
    this.#scope?.tabCommits() ? this.#scope.tabHint() : null,
  );

  #hostEl = inject<ElementRef<HTMLElement>>(ElementRef);

  #scopeDestroyRef = inject(DestroyRef);

  /** Registers the whole host, so a wrapping control's chrome joins the one field stop. */
  #registerWithScope = afterNextRender(() => {
    const scope = this.#scope;
    if (!scope) return;

    const unregister = scope.register({
      host: this.#hostEl.nativeElement,
      entry: this.display().nativeElement,
      beginEdit: () => {
        const { text } = this.openingDraft();
        this.elevate(text.length, text);
      },
    });
    this.#scopeDestroyRef.onDestroy(unregister);
  });

  /**
   * Scoped Tab: settle, then advance. A readable draft commits; an invalid one
   * follows `onBlocked` (`'revert'` snaps back and moves on, `'stay'` refuses).
   * An open menu claims the first Tab.
   */
  protected handleTabKey(event: Event, direction: 1 | -1) {
    const scope = this.#scope;
    if (!scope?.tabCommits()) return;

    event.preventDefault();
    event.stopPropagation();

    if (this.menuOpen()) {
      this.#menu.close();
      return;
    }

    const changed = this.normalization().changed;

    if (changed && this.isInvalid()) {
      if (scope.onBlocked() === 'stay') {
        this.accept(); // refused: reveals errors, session stays open
        scope.announce('blocked');
        return;
      }
      this.cancel(); // navigation tier: snap back, move on
      scope.announce('reverted');
    } else {
      this.accept(); // commits (or settles unchanged) and closes
      if (changed) scope.announce('saved'); // an unchanged settle is a non-event
    }

    scope.advanceFrom(this.display().nativeElement, direction);
  }

  // -- Editor events ----------------------------------------------------------------

  /** The editor DOM → the draft, on every input (the DOM is the source of truth while typing). */
  protected handleEditorInput(event?: Event) {
    // Rewriting under an IME composition tears it down — with a filter, wait for compositionend.
    if ((event as InputEvent | undefined)?.isComposing && this.#charFilter()) return;

    const el = this.editor()?.nativeElement;
    if (!el) return;

    // innerText keeps line breaks (textContent is the jsdom fallback). Rewriting
    // inside `input` lands before paint, so a rejected character is never seen.
    const { text, caret, rewritten } = passDraft(
      el.innerText ?? el.textContent ?? '',
      getSelectionOffsets(el)?.start,
      { singleLine: this.isSingleLine(), filter: this.#charFilter() },
    );
    if (rewritten) {
      el.textContent = text;
      setCaretOffset(el, caret);
    }

    this.value.set(text); // the live draft channel — `revert` rolls it back

    this.#menu.detect(el);
  }

  /** The deferred pass after an IME commit (idempotent, whatever the event order). */
  protected handleEditorCompositionEnd() {
    this.handleEditorInput();
  }

  protected handleMenuNav(event: Event, delta: number) {
    if (!this.menuOpen()) return;

    event.preventDefault();
    this.#menu.move(delta);
  }

  /** Two-stage Escape: the open menu first, then the session. */
  protected handleEscape(event: Event) {
    if (this.menuOpen()) {
      event.stopPropagation();
      this.#menu.close();
      return;
    }

    this.cancel();
  }

  /** Paste fallback without `plaintext-only`: plain text only, never HTML. */
  protected handleEditorPaste(event: ClipboardEvent) {
    if (SUPPORTS_PLAINTEXT_ONLY) return;

    event.preventDefault();

    const el = this.editor()?.nativeElement;
    if (!el) return;

    let text = event.clipboardData?.getData('text/plain') ?? '';
    if (this.isSingleLine()) text = text.replace(/\r?\n+/g, ' ');
    if (!text) return;

    insertPlainText(el, text);

    this.handleEditorInput();
  }

  /** Single-line fields accept on Enter — unless the menu claims it. */
  protected handleEnterKey(event: Event) {
    if (this.#menu.selectActive(event)) return;
    if (!this.isSingleLine()) return;

    event.preventDefault();
    this.accept();
  }

  protected handleSubmitShortcut() {
    this.accept();
  }

  /** External draft writes (clear, programmatic) → the open editor, never clobbering typing. */
  syncEditor = effect(() => {
    const value = this.value() ?? '';
    const el = this.editor()?.nativeElement;
    if (!el) return;

    untracked(() => {
      const current = el.innerText ?? el.textContent ?? '';
      if (current !== value) el.textContent = value;
    });
  });

  // -- Panel actions (see editable-panel-actions.ts) --------------------------------

  protected readonly intl = inject(EditableTextIntl);

  /** Per-field panel actions, over the app-wide renderer. Input or `ng-template[editablePanelActions]`. */
  panelActionsTemplate = input<TemplateRef<EditablePanelActionsTemplateContext> | undefined>(
    undefined,
  );

  private contentPanelActions = contentChild(EditablePanelActionsTemplate);

  protected panelActionsTpl = computed(
    () => this.panelActionsTemplate() ?? this.contentPanelActions()?.templateRef,
  );

  /** The renderer every panel uses (`provideEditablePanelActions`; stock buttons by default). */
  protected readonly panelActionsComponent = inject(EDITABLE_PANEL_ACTIONS);

  /** Stable: bound verbs, live signals. */
  protected readonly panelActionsContext: EditablePanelActionsContext = {
    accept: () => this.accept(),
    cancel: () => this.cancel(),
    dirty: this.isDirty,
    invalid: this.isInvalid,
  };

  protected readonly panelActionsTemplateContext: EditablePanelActionsTemplateContext = {
    $implicit: this.panelActionsContext,
  };

  protected readonly panelActionsInjector = Injector.create({
    providers: [{ provide: EDITABLE_PANEL_ACTIONS_CONTEXT, useValue: this.panelActionsContext }],
    parent: inject(Injector),
  });

  // -- The bubble: actions + clear --------------------------------------------------

  /** Replaces the stock clear button. Input or `ng-template[editableClear]` (see `EditableClearTemplate`). */
  clearTemplate = input<TemplateRef<EditableClearContext> | undefined>(undefined);

  private contentClear = contentChild(EditableClearTemplate);

  protected clearTpl = computed(() => this.clearTemplate() ?? this.contentClear()?.templateRef);

  /** Buttons acting ON the value, before clear. Input or `ng-template[editableActions]`. */
  actionsTemplate = input<TemplateRef<EditableActionsContext<unknown>> | undefined>(undefined);

  /** A wrapping control's payload instead of `{ value }` (the number's number, the phone's E.164). */
  actionsData = input<unknown>(undefined);

  private contentActions = contentChild(EditableActionsTemplate);

  protected actionsTpl = computed(
    () => this.actionsTemplate() ?? this.contentActions()?.templateRef,
  );

  protected actionsContext = computed<EditableActionsContext<unknown>>(() => {
    const data = this.actionsData() ?? { value: this.value() ?? '' };
    return { $implicit: data, data, side: null, focus: this.#focusAction };
  });
  #focusAction = () => this.focus();

  /** Actions ignore required / disabled / readonly on purpose; never mid-edit. */
  protected actionsCanShow = computed(
    () => this.actionsTpl() !== undefined && !this.isEmpty() && !this.editing(),
  );

  protected readonly clearLabel = 'Clear value';

  /** Stable, so a clear confirmed asynchronously still calls into a live control. */
  protected readonly clearContext: EditableClearContext = {
    $implicit: () => this.clearValue(),
    clear: () => this.clearValue(),
    side: null,
    label: this.clearLabel,
    focus: () => this.focus(),
  };

  /** `false` never offers the one-click clear — emptying stays a deliberate edit. */
  showClear = input(true);

  /** Never on empty, required, locked or editing fields (hover is the bubble's own business). */
  protected clearCanShow = computed(
    () =>
      this.showClear() &&
      !this.required() &&
      !this.disabled() &&
      !this.readonly() &&
      !this.isEmpty() &&
      !this.editing(),
  );

  protected bubbleMenuCanShow = computed(() => this.clearCanShow() || this.actionsCanShow());

  /** The bubble anchors right after the final word (see `watchContentEnd`). */
  protected clearContentOffset = watchContentEnd({
    element: () => this.fieldArea().nativeElement,
    empty: () => this.isEmpty(),
    track: () => {
      this.displayText();
      this.wrapMode();
    },
  });

  /** Clear is a commit AND an interaction: commits `''` and marks the field touched. */
  protected clearValue(event?: Event) {
    // No event when a consumer's own button calls through the context (maybe after a dialog).
    event?.preventDefault();
    event?.stopPropagation();

    // Idle-only; committing '' mid-session would strand the frozen baseline.
    if (this.editing()) return;

    this.value.set('');
    this.savedModelChange.emit({ value: '' });
    this.saved.emit({ value: '', changed: true });

    this.#errors.markTouched();
    this.touch.emit();
  }

  /**
   * A press in the unit but outside the text (the halo, a suffix, the space past
   * a short value) focuses the display with the caret at the nearest character.
   * Presses on the text and on chrome keep their own behaviour.
   */
  protected handleFieldMouseDown(event: MouseEvent) {
    if (event.button !== 0 || event.shiftKey) return;
    if (this.editing() || this.disabled() || this.readonly()) return;

    const target = event.target as Element | null;
    const display = this.display().nativeElement;
    if (target === null || display.contains(target)) return;

    const interactive = target.closest('button, a, input, select, textarea, [role="button"]');
    if (interactive !== null && this.fieldArea().nativeElement.contains(interactive)) return;

    event.preventDefault();
    display.focus();
    setCaretOffset(display, caretOffsetNearPoint(display, event.clientX, event.clientY));
  }

  /** The hover scope's forwarded press: the same landing, from outside the unit. */
  protected handleScopePress(event: Event) {
    if (this.editing() || this.disabled() || this.readonly()) return;

    const { clientX, clientY } = (event as CustomEvent<EditableHoverScopePress>).detail;
    const display = this.display().nativeElement;
    display.focus();
    setCaretOffset(display, caretOffsetNearPoint(display, clientX, clientY));
  }

  /** The `[editableHoverScope]` ancestor: its hover arms the bubble, and it paints instead of the field. */
  #hoverScope = watchHoverScope();
  protected hasHoverScope = this.#hoverScope.present;
  protected scopeHover = this.#hoverScope.hover;

  // -- Form Value Contract ------------------------------------------------------------

  focus(options?: FocusOptions) {
    this.display().nativeElement.focus(options);
  }

  /**
   * Presentation-only reset (the MatInput precedent): an open draft goes back
   * to the baseline — no `touch`, `saved` or `reverted`, no focus stealing.
   */
  reset() {
    this.#errors.reset(); // the session state resets itself when the session closes below

    if (!this.editing()) return;

    const baseline = this.previous();
    if ((this.value() ?? '') !== baseline) this.value.set(baseline);

    this.accepted = true; // suppress the detach revert safety net
    this.editing.set(false);
  }
}
