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

// CDK
import { CdkConnectedOverlayConfig, ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { A11yModule, _IdGenerator } from '@angular/cdk/a11y';

import {
  getSelectionOffsets,
  setCaretOffset,
  replayEdit,
  filterChars,
  alignCaret,
  type SelectionOffsets,
} from './caret';
import { EDITABLE_SCOPE } from '../utils/editable-scope/editable-scope';
import { EditablePrefix, EditableSuffix } from './editable-affix';
import { EditableHint } from './editable-hint';
import { EditableMenu, detectSlashToken, type SlashToken } from './editable-menu';
import { BubbleMenu } from '../bubble-menu/bubble-menu';
import {
  EditableClearButton,
  EditableClearTemplate,
  type EditableClearContext,
} from '../bubble-menu/editable-clear';

interface ValueNormalizationDetails {
  value: string;
  changed: boolean;
}

/**
 * How a SINGLE-LINE in-flow display paints text wider than its container.
 *
 * - `'noWrap'` (default) — stay on the one line and ellipsize at the
 *   constraint.
 * - `'wrap'` — break onto the next line: at whitespace first, inside long words
 *   when there is no whitespace to break at, hyphenating where the browser can.
 *
 * Multi-line fields always wrap and ignore this input entirely.
 */
export type InlineTextWrapBehavior = 'wrap' | 'noWrap';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineTextSaved {
  /** The value the session settled on — the committed value or the restored baseline. */
  value: string;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * Trims leading/trailing whitespace only. Interior spaces and line breaks are
 * the user's content and are preserved — single-line fields already strip
 * line breaks at the input level.
 */
export function normalizeString(value: string): string {
  return value.trim();
}

/**
 * Whether the platform supports `contenteditable="plaintext-only"`.
 * When unsupported (SSR, older Firefox) we fall back to `contenteditable="true"`
 * plus manual paste sanitization in `handleEditorPaste`.
 */
const SUPPORTS_PLAINTEXT_ONLY = (() => {
  if (typeof document === 'undefined') return false;

  const probe = document.createElement('div');

  try {
    probe.contentEditable = 'plaintext-only';
    return probe.contentEditable === 'plaintext-only';
  } catch {
    return false;
  }
})();

/**
 * Default panel padding in px — matches the `--mat-sys-inner-spacing` fallback
 * in _editable.scss. The actual value is resolved from the token at elevation
 * time so the lift alignment follows the consumer's spacing scale.
 */
const PANEL_PADDING_FALLBACK = 16;

/**
 * Elevated panel positions: preferred is "over" (panel text covers the origin
 * text — the offsets cancel the panel padding so its first text line sits
 * optically on the origin text), falling back below then above the field.
 * `push: true` keeps the panel inside the viewport margins in all cases.
 */
function panelPositions(paddingX: number): ConnectedPosition[] {
  return [
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'top',
      offsetX: -paddingX,
      offsetY: -(paddingX * 0.75 + 1), // vertical padding is 0.75 × inner spacing, +1 border
    },
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetY: 8,
    },
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'bottom',
      offsetY: -8,
    },
  ];
}

/**
 * Inline text: a static in-flow text that elevates into a floating editor.
 *
 * Contract:
 * - The in-flow display element never changes size — focus and Tab are free.
 * - The first real edit (keystroke/paste/IME) elevates the field: editing
 *   happens in an overlay panel at a fixed readable measure over a scrim.
 * - `value` updates only on commit (Save / Ctrl+Enter / Enter for
 *   single-line); Escape, Discard and scrim clicks revert the draft.
 */
@Component({
  selector: 'angular-inline-text',
  imports: [
    NgTemplateOutlet,

    // CDK
    OverlayModule,
    A11yModule,

    BubbleMenu,
    EditableClearButton,
  ],
  templateUrl: './angular-inline-text.html',
  styleUrl: './angular-inline-text.scss',
  host: {
    class: 'editable-text',
    '[class.editable-text--editing]': 'editing()',
    '[class.editable-text--invalid]': 'errorsVisible()',
    '[style.display]': 'hidden() ? "none" : null',
    '(focus)': 'focus()',
  },
})
export class AngularInlineText implements FormValueControl<string> {
  /** The static in-flow text. Focusable, caret-able — but never mutated by typing. */
  protected display = viewChild.required<ElementRef<HTMLElement>>('display');

  /** The in-flow field area (prefix + display + suffix) — the bubble's anchor + measure box. */
  protected fieldArea = viewChild.required<ElementRef<HTMLElement>>('fieldArea');

  /** The contenteditable inside the elevated panel. Exists only while editing. */
  protected editor = viewChild<ElementRef<HTMLElement>>('editor');

  /** The slash-menu container in the panel. Exists only while the menu is open. */
  protected menuContainer = viewChild<ElementRef<HTMLElement>>('menuContainer');

  // DI-scoped (not module-global) so the sequence restarts per app instance —
  // deterministic across an SSR render and its client hydration.
  protected readonly panelId = inject(_IdGenerator).getId('editable-panel-');

  /** The committed value channel. Updates only on commit. */
  value = model('');

  /** Form Value Contract: disabled */
  disabled = input(false);

  /** Form Value Contract: readonly */
  readonly = input(false);

  /** Form Value Contract: required */
  required = input(false);

  /** Form Value Contract: errors */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);

  /** Form Value Contract: invalid — the bound field's verdict on validity. */
  invalid = input(false);

  /**
   * Form Value Contract: touched — the bound field dictates when the user is
   * considered done interacting, so `markAsTouched()`/`markAllAsTouched()`
   * reveals errors with no interaction on this control (the `form.submitted`
   * half of mat's ErrorStateMatcher).
   */
  touched = input(false);

  /** Form Value Contract: hidden */
  hidden = input(false);

  /**
   * Form Value Contract: touch — emitted on the closing edge of an edit
   * session (our blur analogue), on a failed save attempt, and on clear.
   */
  touch = output<void>();

  /**
   * Emitted when a draft is discarded (Escape, Discard button, scrim click,
   * detach). Payload is the discarded draft text.
   *
   * Roadmap Phase 3: superseded by `saved` — kept during the transition.
   */
  reverted = output<string>();

  /**
   * THE consumer commit event — the family DNA: fires once per changed
   * settlement (accept-timed, change-gated) with the MODEL. Scalar controls
   * emit `{ value }` — the uniform object payload every editable's
   * `savedModelChange` speaks (temporal siblings emit their details models).
   */
  savedModelChange = output<{ value: string }>();

  /**
   * The MACHINERY channel: exactly one emission per settled edit session —
   * Save, Discard, and clear alike, changed or not (`changed` says whether
   * the settled value differs from the baseline). Wrapping controls and
   * hosting adapters bind this; app consumers should bind
   * `savedModelChange`. Emitted after `savedModelChange`/`reverted`.
   */
  saved = output<InlineTextSaved>();

  /** Whether the field is elevated (an edit session is open). Two-way bindable. */
  editing = model(false);

  /**
   * Whether the VALUE is a single line: no line break may exist in it. Enter
   * accepts instead of inserting one, and pasted breaks collapse to spaces.
   * Says nothing about how the text is PAINTED — a single-line value may still
   * wrap over several visual lines (`wrapBehavior`).
   */
  isSingleLine = input(false);

  /**
   * SINGLE-LINE only — how the in-flow display handles a width constraint:
   * `'noWrap'` (default) keeps the one line and ellipsizes at the constraint;
   * `'wrap'` paints the one logical line over as many visual lines as the
   * container needs, breaking at whitespace first, inside long words when
   * there is none (hyphenated where the browser can). Multi-line fields
   * ignore it entirely and always wrap. The elevated editor always wraps: a
   * fixed readable measure is the point of the panel, and text you cannot
   * see is text you cannot edit.
   */
  wrapBehavior = input<InlineTextWrapBehavior>('noWrap');

  /** `wrapBehavior` gated to its scope: multi-line fields always wrap. */
  protected wrapMode = computed<InlineTextWrapBehavior>(() =>
    this.isSingleLine() ? this.wrapBehavior() : 'wrap',
  );

  placeholder = input('N/A');

  /** Accessible name for the field (contenteditable has no native label association). */
  ariaLabel = input<string | undefined>(undefined);

  /**
   * Affix templates — the matPrefix/matSuffix analogues. The input is the
   * composition channel (content queries don't pierce re-projection, so
   * wrapping controls forward a TemplateRef); direct consumers use the
   * `ng-template[editablePrefix/Suffix]` content sugar instead. Rendered
   * twice — in the in-flow field and inside the elevated panel — always
   * outside the contenteditable and `aria-hidden` (units belong in
   * `ariaLabel`).
   */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected suffixTpl = computed(() => this.suffixTemplate() ?? this.contentSuffix()?.templateRef);

  /**
   * Panel hint template — live per-keystroke feedback (interpretation
   * previews, counters) rendered in the panel footer, independent of the
   * error state. Same dual channel as the affixes: input for composition,
   * `ng-template[editableHint]` content for direct use.
   */
  hintTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentHint = contentChild(EditableHint);

  protected hintTpl = computed(() => this.hintTemplate() ?? this.contentHint()?.templateRef);

  /**
   * `inputmode` for the editable surfaces — virtual-keyboard hint on mobile
   * ('decimal', 'tel', 'email', …).
   */
  inputMode = input<string | undefined>(undefined);

  /**
   * Slash-command menu template — dormant unless provided. The consumer owns
   * the options and the search (an `@for` filtered by the live query); the
   * control owns the trigger, keyboard navigation, and the combobox ARIA.
   * Same dual channel as the other slots: input for composition,
   * `ng-template[editableMenu]` content for direct use.
   */
  menuTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentMenu = contentChild(EditableMenu);

  protected menuTpl = computed(() => this.menuTemplate() ?? this.contentMenu()?.templateRef);

  /** The active `/query` token, or `null` when the menu is closed. */
  #menuToken = signal<SlashToken | null>(null);

  /** Id of the active option (mirrored to the editor's `aria-activedescendant`). */
  protected menuActiveId = signal<string | undefined>(undefined);

  protected menuOpen = computed(() => this.menuTpl() != null && this.#menuToken() != null);
  protected menuQuery = computed(() => this.#menuToken()?.query ?? '');

  /**
   * The `editableMenu` template context: the live query, the active-option id
   * signal (for declarative `data-active` binding), and the `apply` callback.
   */
  protected menuContext = computed(() => ({
    $implicit: this.menuQuery(),
    activeId: this.menuActiveId,
    apply: this.applyMenu,
  }));

  /** The projected option elements, in DOM order. */
  #menuOptionEls(): HTMLElement[] {
    const container = this.menuContainer()?.nativeElement;
    return container ? Array.from(container.querySelectorAll<HTMLElement>('[role="option"]')) : [];
  }

  /**
   * Keeps the active option valid as the consumer re-filters: when the menu
   * opens or the query changes, land on the first option (or clear if empty).
   */
  #menuActiveReset = afterRenderEffect(() => {
    if (!this.#menuToken()) return;

    const options = this.#menuOptionEls();
    const activeId = untracked(() => this.menuActiveId());

    if (options.length === 0) {
      if (activeId !== undefined) this.menuActiveId.set(undefined);
    } else if (activeId === undefined || !options.some((option) => option.id === activeId)) {
      this.menuActiveId.set(options[0].id);
    }
  });

  #menuMove(delta: number) {
    const options = this.#menuOptionEls();
    if (options.length === 0) return;

    const index = options.findIndex((option) => option.id === this.menuActiveId());
    const next =
      index < 0
        ? delta > 0
          ? 0
          : options.length - 1
        : (index + delta + options.length) % options.length;

    this.menuActiveId.set(options[next].id);
    options[next].scrollIntoView({ block: 'nearest' });
  }

  #closeMenu() {
    this.#menuToken.set(null);
    this.menuActiveId.set(undefined);
  }

  /** Re-detects the `/query` token from the editor DOM after every edit. */
  #detectMenu(el: HTMLElement) {
    if (!this.menuTpl()) return;

    const selection = getSelectionOffsets(el);
    const text = el.innerText ?? el.textContent ?? '';
    this.#menuToken.set(detectSlashToken(text, selection?.end ?? text.length));
  }

  /**
   * Replaces the draft with a command's text and closes the menu. Replaces
   * the whole draft by default (a command is usually the new beginning —
   * a country becoming `'+49 '`), or just the `/query` token with
   * `{ replaceToken: true }`. An arrow so the template context can hold it.
   */
  protected applyMenu = (replacement: string, options?: { replaceToken?: boolean }) => {
    const el = this.editor()?.nativeElement;
    if (!el) return;

    const token = this.#menuToken();
    const text = el.innerText ?? el.textContent ?? '';

    let next: string;
    let caret: number;
    if (options?.replaceToken && token) {
      next = text.slice(0, token.start) + replacement + text.slice(token.end);
      caret = token.start + replacement.length;
    } else {
      next = replacement;
      caret = replacement.length;
    }

    el.textContent = next;
    setCaretOffset(el, caret);
    this.#closeMenu();
    this.handleEditorInput();
  };

  /**
   * Trims leading/trailing whitespace on commit — the committed value and the
   * emitted events carry the trimmed text. Interior spacing is never touched.
   */
  normalizeValue = input(false);

  /**
   * Opt-in character filter: a regex tested against ONE character at a time.
   * Rejected characters never reach the draft, so the bound field never
   * observes them and no error state flickers on the way past.
   *
   * What it covers, precisely:
   * - **Keystrokes** and **paste** — on the resting display and in the panel.
   * - **Drop** and **IME** — only once the panel is open. On the resting
   *   display neither delivers text in the first place: a drop's payload is
   *   discarded by the `beforeinput` interception (`insertFromDrop` is not a
   *   replayable intent) and a composition is aborted by the focus handoff.
   *   Both pre-date this filter; both elevate the field empty-handed and the
   *   user repeats the gesture in the editor, where the filter does apply.
   *
   * Rejection is silent and total. On the resting display a keystroke the
   * filter erases does not even open the editor: the control's rule is that
   * only a mutation elevates (clicks, focus and caret moves never do), and an
   * erased keystroke mutates nothing. Nothing is announced — see the
   * accessibility note on `angular-inline-number`'s `restrictInput`.
   *
   * This filters, it does not validate — `[0-9.]` still admits `1.2.3`. Shape
   * validation stays with the schema.
   */
  allowedChars = input<RegExp | undefined>(undefined);

  /**
   * Opt-in: the text an edit session OPENS with, when the idle display is a
   * different RENDERING of the committed value. Given the committed text it
   * returns the draft — the locale number wrapper hands `1.250.000,50` back
   * as `1250000,5`, so nobody types around thousands groups. The display
   * keeps its rendering (frozen at the baseline for the session); only the
   * editor sees the draft, and a caret or selection in the display is
   * carried over by aligning the two texts. `changed` compares the draft
   * against the mapped baseline, and an unchanged save restores the
   * rendering instead of committing the draft text.
   */
  draftText = input<((committed: string) => string) | undefined>(undefined);

  /**
   * The active filter, or `null` when filtering is off. Stateful flags are
   * stripped once here (rather than per keystroke inside `filterChars`) so
   * the hot path allocates nothing.
   */
  #charFilter = computed(() => {
    const allow = this.allowedChars();
    if (!allow) return null;

    return allow.global || allow.sticky
      ? new RegExp(allow.source, allow.flags.replace(/[gy]/g, ''))
      : allow;
  });

  /**
   * The session baseline: follows the committed value while idle and freezes
   * for the duration of an edit session — the live channel writes every
   * keystroke into `value`, so the draft and the value model are one and the
   * baseline is what reverts restore.
   *
   * Frozen on `editing()`, never on field `dirty`: field-dirty is sticky
   * across sessions and a dirty-frozen baseline would never thaw.
   */
  previous = linkedSignal<string, string>({
    source: () => this.value() ?? '',
    computation: (source, prev) => (this.editing() ? (prev?.value ?? '') : source),
  });

  isEmpty = computed(() => (this.value() ?? '') === '');

  /** Session-scoped dirty: the draft differs from the baseline right now. */
  protected isDirty = computed(() => this.normalization().changed);

  /**
   * The field dictates validity: `invalid` is the bound field's verdict,
   * `errors` covers the `[(value)]`/standalone modes where only errors are
   * bound. No inner form — validation happens wherever the value lives.
   */
  protected isInvalid = computed(() => this.invalid() || this.errors().length > 0);

  /**
   * The in-flow display freezes at the session baseline while editing, so
   * live draft propagation through `value` never reflows the page. It shows
   * the committed value again the moment the session closes.
   */
  protected displayText = computed(() => (this.editing() ? this.previous() : (this.value() ?? '')));

  /**
   * Mat-form-field error state: errors exist as soon as validation fails, but
   * they are only *shown* once the field was touched (a previous session
   * closed) or the user attempted to save the current draft.
   */
  #selfTouched = signal(false);
  #saveAttempted = signal(false);
  protected errorsVisible = computed(
    () => this.isInvalid() && (this.touched() || this.#selfTouched() || this.#saveAttempted()),
  );

  /**
   * Fallback error rendering when no `[editable-error]` content is projected:
   * contract errors that carry a message. Message-less errors still
   * invalidate the field but stay silent here.
   */
  protected errorMessages = computed(() => this.errors().filter((error) => !!error.message));

  /** Emits `touch` on the closing edge of an edit session (the blur analogue). */
  #wasOpen = false;
  emitTouchOnClose = effect(() => {
    const open = this.editing();

    if (!this.#wasOpen && open) {
      // A session opened by ANY path — `elevate()`, or an external
      // `editing.set(true)` (e.g. the phone flag picker seeding a draft).
      // `#saveAttempted` is per-session, so clear it here too, not only in
      // `elevate()`, or a stale attempt flashes errors on the fresh draft.
      untracked(() => this.#saveAttempted.set(false));
    } else if (this.#wasOpen && !open) {
      untracked(() => {
        this.#selfTouched.set(true);
        this.touch.emit();
      });
    }

    this.#wasOpen = open;
  });

  /**
   * Normalization trims edge whitespace only — nothing interior. `changed`
   * compares the (possibly trimmed) draft against the session baseline.
   */
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

  /**
   * The contenteditable mode for both surfaces.
   * Disabled/readonly fields are not editable; otherwise prefer plaintext-only.
   */
  protected editableMode = computed(() => {
    if (this.disabled() || this.readonly()) return 'false';

    return SUPPORTS_PLAINTEXT_ONLY ? 'plaintext-only' : 'true';
  });

  // ---------------------------------------------------------------------------
  // Elevated panel overlay
  // ---------------------------------------------------------------------------

  /**
   * The panel padding, resolved from `--mat-sys-inner-spacing` when an edit
   * session opens (px literals only; anything else falls back to the default).
   * Keeps the lift offsets glued to the padding _editable.scss derives from
   * the same token.
   */
  #panelPadding = signal(PANEL_PADDING_FALLBACK);

  #resolvePanelPadding() {
    const raw = getComputedStyle(this.display().nativeElement)
      .getPropertyValue('--mat-sys-inner-spacing')
      .trim();

    const px = raw.endsWith('px') ? Number.parseFloat(raw) : NaN;
    this.#panelPadding.set(Number.isFinite(px) && px >= 0 ? px : PANEL_PADDING_FALLBACK);
  }

  protected panelOverlayConfig = computed((): CdkConnectedOverlayConfig => ({
    origin: this.display(),
    positions: panelPositions(this.#panelPadding()),
    hasBackdrop: true,
    backdropClass: 'editable-scrim',
    viewportMargin: 16,
    push: true,
    disableClose: true, // Escape is handled by the panel (revert semantics)
    disposeOnNavigation: true,
  }));

  // ---------------------------------------------------------------------------
  // Elevation: pristine display → floating editor
  // ---------------------------------------------------------------------------

  /** Caret offset to restore inside the editor once the panel attaches. */
  #pendingCaret: number | null = null;

  /**
   * Opens an edit session. Latches the commit baseline, optionally seeds the
   * draft with the replayed first edit, and remembers the caret to restore.
   */
  protected elevate(caret: number | null = null, seed?: string) {
    if (this.editing() || this.disabled() || this.readonly()) return;

    this.#resolvePanelPadding();

    // Pin the baseline: `previous` derives from `value` while idle — reading
    // it here syncs it to the committed value before `editing` freezes it.
    const committed = this.previous();

    this.#saveAttempted.set(false);
    this.#pendingCaret = caret;
    this.editing.set(true);

    if (seed !== undefined && seed !== committed) {
      // Live draft channel: parents (and their validation) see the seed too.
      this.value.set(seed);
    }
  }

  /** Applies the character filter, or passes the text through untouched. */
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

  /**
   * What a session opens with: the committed text (or its `draftText`
   * rendering) and the display's caret/selection carried into it.
   */
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

  /**
   * Whether a filtered edit came out as a no-op: the filter removed something
   * and what survived is the committed text. Nothing mutated, so nothing
   * should happen — not even elevation. The `!== raw` half keeps unfiltered
   * fields on exactly their old behaviour.
   */
  #filteredToNothing(filtered: string, raw: string, committed: string) {
    return filtered !== raw && filtered === committed;
  }

  /**
   * The display element is caret-able but immutable: every `beforeinput` is
   * cancelled, its intent replayed onto the committed text, and the result
   * elevated into the overlay editor — the page never reflows from typing.
   */
  protected interceptBeforeInput(event: Event) {
    event.preventDefault();
    if (this.disabled() || this.readonly() || this.editing()) return;

    // Cut is owned by the `(cut)` handler — it needs `clipboardData`, which a
    // `beforeinput` can't provide. Ignore the `deleteByCut` intent here so we
    // don't elevate without removing the selection (that made cut take two
    // gestures: elevate-unchanged, then cut again in the editor).
    if ((event as InputEvent).inputType === 'deleteByCut') return;

    const { text: committed, selection } = this.openingDraft();

    const replayed = replayEdit(committed, selection, event as InputEvent, this.isSingleLine());

    if (!replayed) {
      // An intent we cannot replay (undo, drop, formatting) — elevate
      // unchanged and let the editor handle it.
      this.elevate(selection.start, committed);
      return;
    }

    const filtered = this.#filter(replayed.text, replayed.caret);
    if (this.#filteredToNothing(filtered.text, replayed.text, committed)) return;

    this.elevate(filtered.caret, filtered.text);
  }

  /**
   * Cut on the pristine display: write the selection to the clipboard and
   * elevate with it removed — one gesture, like delete and paste. Without
   * this the field would elevate unchanged and the cut would need repeating.
   */
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

  /** Paste on the pristine display: cancel, splice into the draft, elevate. */
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

  /**
   * IME composition cannot be cancelled via `beforeinput` — elevate on
   * `compositionstart` instead. Focus moving into the overlay editor aborts
   * the in-flight composition; any text it committed into the display is
   * cleaned up in `handlePanelAttach`.
   */
  protected handleCompositionStart() {
    if (this.disabled() || this.readonly() || this.editing()) return;

    const { text, selection } = this.openingDraft();
    this.elevate(selection.start, text);
  }

  /** Panel attached: reset any stray display mutation, focus the editor, restore the caret. */
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

      // Elevating on a `/` (typed from the idle display) should open the menu
      // immediately — no `input` event fires for the seeded draft, so detect
      // it here once the editor and caret are in place.
      this.#detectMenu(editorEl);
    });
  }

  // ---------------------------------------------------------------------------
  // Commit / revert
  // ---------------------------------------------------------------------------

  accepted = false;
  /** The per-field submit (our one honest deviation from a normal form). */
  protected accept() {
    const { value, changed } = this.normalization();

    if (!changed) {
      // An unchanged draft under `draftText` is only a rendering of the
      // baseline — the baseline is what settles, and what the display keeps.
      const settled = this.draftText() ? this.previous() : value;
      if ((this.value() ?? '') !== settled) this.value.set(settled);

      // Mark accepted so the detach safety net doesn't also run `revert()` —
      // the outcome is the same either way, but this keeps the accept/detach
      // ordering from mattering.
      this.accepted = true;
      this.close();
      this.saved.emit({ value: settled, changed: false });
      return;
    }

    // Mat-style submit attempt: an invalid draft doesn't commit — it reveals
    // the errors (and marks the field touched) so the user can react.
    if (this.isInvalid()) {
      this.#saveAttempted.set(true);
      this.#selfTouched.set(true);
      this.touch.emit();
      return;
    }

    this.accepted = true;

    // Commit: the single point where the page is allowed to reflow. The
    // baseline follows on close — `previous` unfreezes with the session.
    this.value.set(value);

    this.savedModelChange.emit({ value });
    this.saved.emit({ value, changed: true });
    this.close();
  }

  /**
   * Single choke point for discarding a draft (Escape, Discard button,
   * scrim click, detach). Restores the session baseline and notifies the
   * parent via `reverted`.
   */
  protected revert() {
    const draft = this.value() ?? '';
    const baseline = this.previous();
    const hadChanges = draft !== this.draftBaseline();

    // Roll back the live draft channel to the session baseline.
    if (draft !== baseline) this.value.set(baseline);

    if (hadChanges) this.reverted.emit(draft);

    // Revert can run twice per session (cancel, then the detach safety net);
    // only the in-session call settles the session. The no-diff accept path
    // closes before detach and reports its settlement itself.
    if (this.editing()) this.saved.emit({ value: baseline, changed: false });
  }

  /** Discard the draft and close the session. */
  protected cancel() {
    this.revert();
    this.close();
  }

  /** Closes the panel and returns focus to the in-flow display for Tab continuity. */
  protected close() {
    if (!this.editing()) return;

    this.editing.set(false);
    this.display().nativeElement.focus();
  }

  protected handleScrimClick() {
    this.cancel();
  }

  /** Detach safety net (e.g. dispose-on-navigation): never lose the baseline silently. */
  protected handlePanelDetach() {
    if (this.accepted) {
      this.accepted = false;
      return;
    }

    this.revert();
    // Detach without close() (navigation, destroy): sync the open state.
    if (this.editing()) this.editing.set(false);
  }

  // ---------------------------------------------------------------------------
  // Tab-to-accept scope (opt-in via an ancestor [editableScope])
  // ---------------------------------------------------------------------------

  /** The ancestor scope, or `null` — a scopeless field keeps the focus trap. */
  #scope = inject(EDITABLE_SCOPE, { optional: true });

  /**
   * The scope's Tab instruction, rendered visually hidden inside the panel's
   * messages container (already the editor's `aria-describedby`) — how a
   * screen-reader user learns that Tab saves here. `null` outside a scope,
   * or while the scope has Tab-commit off.
   */
  protected scopeTabHint = computed(() =>
    this.#scope?.tabCommits() ? this.#scope.tabHint() : null,
  );

  #hostEl = inject<ElementRef<HTMLElement>>(ElementRef);

  #scopeDestroyRef = inject(DestroyRef);

  /**
   * Registration is the composition boundary: wrapping controls (number,
   * phone) contain this control, so THEIR chrome (a flag trigger) sits inside
   * this host and collapses into the one field stop for free.
   */
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
   * Scoped Tab: settle the session, then advance. Only live inside a scope
   * whose `tabCommits` is on — otherwise the event is left alone and
   * `cdkTrapFocus` keeps cycling the panel (today's behavior).
   *
   * The settle follows the house temporal tiers: a clean or readable draft
   * COMMITS; an invalid one follows the scope's `onBlocked` policy — snap
   * back and advance (`'revert'`, the Tab-is-navigation default) or reveal
   * the errors and refuse (`'stay'`, mat submit semantics). An open slash
   * menu claims the first Tab and just closes, mirroring two-stage Escape.
   */
  protected handleTabKey(event: Event, direction: 1 | -1) {
    const scope = this.#scope;
    if (!scope?.tabCommits()) return;

    event.preventDefault();
    event.stopPropagation();

    if (this.menuOpen()) {
      this.#closeMenu();
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

  // ---------------------------------------------------------------------------
  // Elevated editor events
  // ---------------------------------------------------------------------------

  /**
   * Syncs the editor DOM into the draft form on every input.
   * The DOM is the source of truth while typing; `innerText` preserves
   * line breaks (unlike `textContent` when the browser inserts `<br>`).
   */
  protected handleEditorInput(event?: Event) {
    // A composition in flight owns the DOM until the IME commits: rewriting
    // underneath it tears the composition down (`é`, `ñ`, CJK all die on
    // their first intermediate state). With a filter active, defer the whole
    // pass to `compositionend` and apply it once to the finished text.
    //
    // Gated on the filter so unfiltered fields keep streaming per keystroke
    // exactly as before — with nothing to rewrite there is nothing to tear.
    if ((event as InputEvent | undefined)?.isComposing && this.#charFilter()) return;

    const el = this.editor()?.nativeElement;
    if (!el) return;

    // innerText preserves line breaks; textContent fallback for jsdom
    let text = el.innerText ?? el.textContent ?? '';

    // An "empty" editable can report a lone line break
    if (text === '\n') text = '';

    // Read the caret up front — the rewrites below move it.
    let caret = getSelectionOffsets(el)?.start ?? text.length;
    let rewritten = false;

    // Single-line: strip line breaks that slip in via paste
    if (this.isSingleLine() && text.includes('\n')) {
      text = text.replace(/\n+/g, ' ');
      caret = Math.min(caret, text.length);
      rewritten = true;
    }

    // Character filter. Rewriting synchronously inside the `input` handler
    // lands before the browser paints, so a rejected character is never
    // visible; and the write below dedupes against the unchanged value
    // (`model.set` guards on `equal`), so the bound field is not notified at
    // all. Order matters: filtering AFTER `value.set` — from an effect, say —
    // would flash the rejected draft through the field's validation.
    const allow = this.#charFilter();
    if (allow) {
      const filtered = filterChars(text, caret, allow);
      if (filtered.text !== text) {
        text = filtered.text;
        caret = filtered.caret;
        rewritten = true;
      }
    }

    if (rewritten) {
      el.textContent = text;
      setCaretOffset(el, caret);
    }

    // Live draft channel: bound parents (and their schema validation) follow
    // every keystroke. The page stays still — the display is frozen at the
    // session baseline. `revert` rolls this back.
    this.value.set(text);

    this.#detectMenu(el);
  }

  /**
   * The IME committed: run the pass deferred while composing. Browsers differ
   * on whether the final `input` lands before or after `compositionend`, so
   * both paths reach here — the pass is idempotent, which makes that moot.
   */
  protected handleEditorCompositionEnd() {
    this.handleEditorInput();
  }

  /** Arrow-key navigation while the slash menu is open. */
  protected handleMenuNav(event: Event, delta: number) {
    if (!this.menuOpen()) return;

    event.preventDefault();
    this.#menuMove(delta);
  }

  /**
   * Two-stage Escape: first press closes an open menu, the next cancels the
   * session. (Bound at the panel level.)
   */
  protected handleEscape(event: Event) {
    if (this.menuOpen()) {
      event.stopPropagation();
      this.#closeMenu();
      return;
    }

    this.cancel();
  }

  /** Selects the active option if the menu is open. Returns whether it handled the key. */
  #menuSelectActive(event: Event): boolean {
    if (!this.menuOpen()) return false;

    event.preventDefault();
    const activeId = this.menuActiveId();
    this.#menuOptionEls()
      .find((option) => option.id === activeId)
      ?.click();

    return true;
  }

  /**
   * Paste fallback for browsers without `plaintext-only`:
   * insert clipboard text as plain text (never HTML) via Selection APIs.
   */
  protected handleEditorPaste(event: ClipboardEvent) {
    if (SUPPORTS_PLAINTEXT_ONLY) return; // browser already enforces plain text

    event.preventDefault();

    const el = this.editor()?.nativeElement;
    if (!el) return;

    let text = event.clipboardData?.getData('text/plain') ?? '';
    if (this.isSingleLine()) text = text.replace(/\r?\n+/g, ' ');
    if (!text) return;

    const selection = el.ownerDocument.defaultView?.getSelection();

    if (
      !selection ||
      selection.rangeCount === 0 ||
      !el.contains(selection.getRangeAt(0).commonAncestorContainer)
    ) {
      // No usable caret — append at the end
      el.textContent = (el.innerText ?? el.textContent ?? '') + text;
    } else {
      const range = selection.getRangeAt(0);
      range.deleteContents();

      const node = el.ownerDocument.createTextNode(text);
      range.insertNode(node);

      // Collapse the caret after the inserted text
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    this.handleEditorInput();
  }

  /** Single-line fields accept on Enter — unless the menu claims it for selection. */
  protected handleEnterKey(event: Event) {
    if (this.#menuSelectActive(event)) return;
    if (!this.isSingleLine()) return;

    event.preventDefault();
    this.accept();
  }

  protected handleCtrlEnter() {
    this.accept();
  }

  /**
   * Writes external draft changes (clear, programmatic writes) into the
   * editor DOM while the panel is open. Compares against `innerText` so
   * in-flight typing (already in sync via `handleEditorInput`) is never
   * clobbered mid-keystroke.
   */
  syncEditor = effect(() => {
    const value = this.value() ?? '';
    const el = this.editor()?.nativeElement;
    if (!el) return;

    untracked(() => {
      const current = el.innerText ?? el.textContent ?? '';
      if (current !== value) el.textContent = value;
    });
  });

  // ---------------------------------------------------------------------------
  // Clear affordance (the floating bubble lives in BubbleMenu)
  // ---------------------------------------------------------------------------

  /**
   * Consumer clear affordance — REPLACES the stock button inside the bubble.
   * Same dual channel as the other slots: input for composition (number and
   * phone forward theirs here), `ng-template[editableClear]` content for
   * direct use. See {@link EditableClearTemplate} for the confirm-before-
   * clear recipe the context callback exists for.
   */
  clearTemplate = input<TemplateRef<EditableClearContext> | undefined>(undefined);

  private contentClear = contentChild(EditableClearTemplate);

  protected clearTpl = computed(() => this.clearTemplate() ?? this.contentClear()?.templateRef);

  /** The stock accessible name — the context's `label`, and the default button's. */
  protected readonly clearLabel = 'Clear value';

  /**
   * The `editableClear` context. A STABLE object (the callback is a bound
   * field, the label a constant): stamping it never re-creates the consumer's
   * button, so a clear confirmed asynchronously calls into a live control.
   */
  protected readonly clearContext: EditableClearContext = {
    $implicit: () => this.clearValue(),
    clear: () => this.clearValue(),
    side: null,
    label: this.clearLabel,
    focus: () => this.focus(),
  };

  /**
   * Whether the clear bubble may show — every term EXCEPT hover (the bubble
   * owns that): never for empty/required/locked fields or while editing.
   * `required()` keeps the bubble hidden — a guaranteed-doomed clear stays
   * unavailable.
   */
  protected bubbleMenuCanShow = computed(
    () =>
      !this.required() &&
      !this.disabled() &&
      !this.readonly() &&
      !this.isEmpty() &&
      !this.editing(),
  );

  /**
   * The offset from the field box's inline-end/block-end CORNER to where the
   * content actually ENDS — the last line's final glyph, vertically centred on
   * that line. A multi-line field is a tall box whose inline-end sits far past
   * a short final line ("…something." + surplus space); this pins the bubble
   * right after the final word instead of out in the void. Single-line lands
   * ≈(0, −½line) — so the anchor scheme is IDENTICAL single- or multi-line
   * (no more center-vs-bottom drift), and it stays a delta on the ELEMENT
   * origin so CDK re-resolves it on scroll — correct inside a scrolling table.
   *
   * Measured off the ONE reflow the field already allows — the commit — and on
   * resize (a rewrap moves the last line), never per hover.
   */
  #contentOffset = signal<{ x: number; y: number } | null>(null);
  protected clearContentOffset = computed(() => this.#contentOffset());

  /** Bumped by the ResizeObserver to re-run the measure after the next render. */
  #measureTick = signal(0);

  #measureContentOffset() {
    const el = this.fieldArea().nativeElement;
    if (this.isEmpty()) {
      this.#contentOffset.set(null);
      return;
    }

    // getClientRects yields one rect per line of the field's content; the last
    // rect's inline-end is where the final line stops (past the suffix, if any).
    const box = el.getBoundingClientRect();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const rects = range.getClientRects();
    if (rects.length === 0) {
      this.#contentOffset.set(null);
      return;
    }

    // Box-corner → content-end delta. Scroll-invariant: box and content shift
    // together, so CDK re-applies it against the live element rect.
    const last = rects[rects.length - 1];
    this.#contentOffset.set({
      x: last.right - box.right,
      y: last.top + last.height / 2 - box.bottom,
    });
  }

  // The commit is the one point the page reflows; `displayText` flips to the
  // committed value then. Re-measuring in the render READ phase rides that
  // settled layout instead of forcing a fresh one — and re-runs when the
  // committed text or the wrap width (via the resize tick) changes.
  #measureContentOffsetEffect = afterRenderEffect({
    read: () => {
      this.displayText();
      this.wrapMode();
      this.#measureTick();
      this.#measureContentOffset();
    },
  });

  #resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => this.#measureTick.update((tick) => tick + 1));

  #observeForRemeasure = afterNextRender(() =>
    this.#resizeObserver?.observe(this.fieldArea().nativeElement),
  );

  #disconnectObserverOnDestroy = inject(DestroyRef).onDestroy(() =>
    this.#resizeObserver?.disconnect(),
  );

  /**
   * Clear is a commit *and* an interaction (mat-faithful): it always commits
   * '' and marks the field touched, so a schema that rejects the cleared
   * value surfaces through the idle error state immediately. `required()`
   * keeps hiding the bubble — a guaranteed-doomed clear stays unavailable.
   */
  protected clearValue(event?: Event) {
    // Absent when a consumer's own affordance calls through the template
    // context — possibly long after its click (a confirmation dialog).
    event?.preventDefault();
    event?.stopPropagation();

    // Clear is an idle-only affordance (the bubble is hidden while editing).
    // Guard anyway: committing '' mid-session would strand `previous` at the
    // frozen baseline and desync the draft.
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

  /** Focus the in-flow display element. */
  focus(options?: FocusOptions) {
    this.display().nativeElement.focus(options);
  }

  /**
   * Form UI Contract: reset — return to the pristine presentation state.
   * Invoked by the bound field after it applied its own value/touched reset.
   *
   * MatInput precedent: value restoration is the field's job (a
   * `reset(value)` arrives through the `value` binding); this only resets
   * presentation state. One draft-control extra: an open session's draft is
   * sitting in the live `value` channel, so it is discarded back to the
   * session baseline — a draft never survives a reset. A programmatic reset
   * is not a user interaction: no `touch`, no `saved`, no `reverted`, and no
   * focus stealing.
   */
  reset() {
    this.#selfTouched.set(false);
    this.#saveAttempted.set(false);

    if (!this.editing()) return;

    const baseline = this.previous();
    if ((this.value() ?? '') !== baseline) this.value.set(baseline);

    this.#wasOpen = false; // suppress the touch emission for this close
    this.accepted = true; // suppress the detach revert safety net
    this.editing.set(false);
  }
}
