import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  contentChild,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
  viewChild,
  type TemplateRef,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { FormValueControl, type ValidationError } from '@angular/forms/signals';

import { EditablePrefix, EditableSuffix } from 'angular-inline-select';
import { parseDuration, formatDuration, type DurationFormat } from './duration-codec';
import { INLINE_TEMPORAL_LEAF_STATE } from '../leaf-state';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineDurationSaved {
  /** The value the session settled on — SECONDS, or `null` for empty. */
  value: number | null;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * Inline duration on a NATIVE INPUT — the input rehost (see
 * ROADMAP-DATETIME). A `FormValueControl` for durations. Canonical value:
 * SECONDS (`number | null`, empty commits `null`).
 *
 * Session semantics are GESTURE-TIERED (the family rule): Enter commits
 * (an unreadable draft BLOCKS with the error), Escape reverts to the
 * baseline, Tab/blur commits a readable draft and SNAPS an unreadable one
 * back — never traps, never persists a draft error.
 *
 * - Drafts accept colon notation (positional by `durationFormat`), unit
 *   tokens (`'1h 30m'`, `'45m'`, `'1.5h'`), or a bare number (minutes under
 *   hour formats, seconds under `mm:ss`).
 * - Commits round-trip the codec (`'90'` under `h:mm` settles as `'01:30'`)
 *   and snap to `step` seconds when set (e.g. 60 for whole minutes).
 */
@Component({
  selector: 'angular-inline-duration',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, NgTemplateOutlet],
  templateUrl: './angular-inline-duration.html',
  styles: `
    :host {
      display: inline;
    }

    .inline-duration {
      display: inline-flex;
      align-items: baseline;
      gap: 0.25ch;
      max-width: 100%;
    }

    /* The family look, on an input (see the date control for the rationale). */
    .inline-duration__input {
      font: inherit;
      color: inherit;
      background: transparent;
      border: 0;
      padding: 0 0 0.1em;
      margin: 0;
      outline: none;
      min-width: 1ch;
      max-width: 100%;
      field-sizing: content;
      caret-color: var(--editable-text-caret-color, var(--mat-sys-primary, #428bca));
      border-bottom: 0.0625rem dashed
        var(--editable-text-underline-color, var(--mat-sys-primary, #428bca));
    }
    .inline-duration__input:focus {
      border-bottom-style: solid;
      border-bottom-width: 0.125rem;
      padding-bottom: calc(0.1em - 0.0625rem);
    }
    .inline-duration__input::placeholder {
      font-style: italic;
      color: inherit;
      opacity: var(--editable-text-placeholder-opacity, 0.3875);
    }
    .inline-duration__input:disabled {
      cursor: default;
      border-bottom-color: var(--mat-sys-outline, #999);
    }

    .inline-duration--invalid .inline-duration__input {
      border-bottom-color: var(--editable-text-error-color, var(--mat-sys-error, #dc3545));
    }

    /* BARE CHROME — the hosting container draws the chrome (see the date control). */
    :host(.inline-field-bare) .inline-duration__input {
      border-bottom: none;
      padding-bottom: 0;
    }
    :host(.inline-field-bare--hide-placeholder) .inline-duration__input::placeholder {
      opacity: 0;
    }

    .inline-duration__input--reverted {
      animation: inline-duration-revert 0.6s ease-out;
    }
    @keyframes inline-duration-revert {
      0% {
        background: color-mix(in srgb, var(--mat-sys-error, #dc3545) 18%, transparent);
      }
      100% {
        background: transparent;
      }
    }

    .inline-duration__affix {
      white-space: nowrap;
      user-select: none;
      color: var(--editable-text-affix-color, var(--mat-sys-on-surface-variant, inherit));
    }

    .inline-duration__sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .inline-duration__panel {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      background: var(--editable-panel-container-color, var(--mat-sys-surface-container, #fff));
      color: var(--mat-sys-on-surface, inherit);
      border-radius: var(--mat-sys-corner-medium, 0.75rem);
      box-shadow: var(
        --mat-sys-level2,
        0 1px 2px rgba(0, 0, 0, 0.3),
        0 2px 6px 2px rgba(0, 0, 0, 0.15)
      );
    }
    .inline-duration__errors:not([hidden]) {
      padding: 0 8px 4px;
      font: var(--mat-sys-body-small, 0.8125rem/1.4 system-ui);
      color: var(--mat-sys-error, #dc3545);
    }

    @media (prefers-reduced-motion: reduce) {
      .inline-duration__input--reverted {
        animation: none;
      }
    }
  `,
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineDuration implements FormValueControl<number | null> {
  #document = inject(DOCUMENT);

  /** The committed value channel: duration in SECONDS, or `null`. */
  value = model<number | null>(null);

  /** Form Value Contract. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  placeholder = input<string>('0:00');

  /** Accessible name for the field. */
  ariaLabel = input<string | undefined>(undefined);

  /** How colon notation reads and how committed values render. */
  durationFormat = input<DurationFormat>('h:mm');

  /** Snap committed values to a multiple of this many seconds (1 = off). */
  step = input<number>(1);

  /** Affix template passthrough (composition channel + content sugar). */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected suffixTpl = computed(() => this.suffixTemplate() ?? this.contentSuffix()?.templateRef);

  /**
   * Group-forwarded contract state (role-provided; absent standalone).
   * Merged by PULL — the leaf stays decoupled, no effects involved.
   */
  #leafState = inject(INLINE_TEMPORAL_LEAF_STATE, { optional: true, self: true });

  /** Public: the composed disabled verdict (own input + group-fed state). */
  readonly effectiveDisabled = computed(
    () => this.disabled() || (this.#leafState?.disabled() ?? false),
  );
  protected effectiveReadonly = computed(
    () => this.readonly() || (this.#leafState?.readonly() ?? false),
  );
  protected effectiveTouched = computed(
    () => this.touched() || (this.#leafState?.touched() ?? false),
  );
  protected effectiveInvalid = computed(
    () => this.invalid() || (this.#leafState?.invalid() ?? false),
  );

  /** Form Value Contract: touch — emitted whenever a session settles. */
  touch = output<void>();

  /** Hard commit event: fires once per changed settlement — seconds or `null`. */
  savedModelChange = output<number | null>();

  /** Emitted exactly once per settled session (commit, snap-back, Escape, clear). */
  saved = output<InlineDurationSaved>();

  /** Whether an edit session is open (= focus is within). Two-way bindable. */
  editing = model(false);

  protected display = computed(() => formatDuration(this.value(), this.durationFormat()));

  // -- The session (one field, the date control's side pattern) ------------------

  /** Whether a session is open on this field. */
  #open = signal(false);

  /**
   * The input's text: user-owned while the session is open (frozen
   * linkedSignal), the committed display otherwise.
   */
  protected draft = linkedSignal<string, string>({
    source: this.display,
    computation: (source, prev) => (this.#open() ? (prev?.value ?? source) : source),
  });

  /** The committed VALUE at session start — what Escape and snap-back restore. */
  #baselineValue: number | null = null;

  /**
   * Whether the USER touched the draft since the last settlement. An
   * untouched session settles WHERE THE VALUE STANDS — re-deriving it from
   * the draft would undo external writes (a group moving this length) with
   * stale session state.
   */
  #dirty = false;

  /** Enter was pressed on an unreadable draft — reveals the parse-gate error. */
  #saveAttempted = signal(false);

  /** Enter/Escape hide the panel until the next keystroke or session. */
  #panelDismissed = signal(false);

  /** The parse gate: whether the current draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(
    () => parseDuration(this.draft(), this.durationFormat()) === undefined,
  );

  #selfTouched = signal(false);

  protected isInvalid = computed(
    () =>
      this.effectiveInvalid() ||
      this.errors().length > 0 ||
      (this.#leafState?.errors().length ?? 0) > 0,
  );

  /**
   * The mat split: the consumer decides what errors say, the field when they
   * show. Public — the field's presentational verdict, the thing a hosting
   * container (a mat-form-field adapter) needs to mirror.
   */
  readonly errorsVisible = computed(
    () => this.isInvalid() && (this.effectiveTouched() || this.#selfTouched()),
  );

  /** Public: whether the field holds no value. */
  readonly isEmpty = computed(() => this.value() === null);

  protected parseGateVisible = computed(() => this.#saveAttempted() && this.parseFailed());

  protected errorSlotVisible = computed(() => this.errorsVisible() || this.parseGateVisible());

  /** The panel appears only to carry an error — there is no live preview. */
  protected panelOpen = computed(
    () => this.#open() && !this.#panelDismissed() && this.errorSlotVisible(),
  );

  /** Public: whether the panel is showing (hosting containers coordinate on it). */
  readonly panelVisible = computed(() => this.panelOpen());

  /** An outside click dismisses the panel — the session survives (focusout settles). */
  protected dismissPanel() {
    this.#panelDismissed.set(true);
  }

  protected overlayPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  protected revertFlash = signal(false);
  protected revertNotice = signal('');

  protected durationInput = viewChild<ElementRef<HTMLInputElement>>('durationInput');
  protected panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  #focusCheckTimer: ReturnType<typeof setTimeout> | null = null;
  #flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.#focusCheckTimer !== null) clearTimeout(this.#focusCheckTimer);
      if (this.#flashTimer !== null) clearTimeout(this.#flashTimer);
    });

    // The editing bridge — see the date control.
    effect(() => {
      const editing = this.editing();
      untracked(() => {
        const open = this.#open();
        if (editing && !open) {
          this.durationInput()?.nativeElement.focus();
        } else if (!editing && open) {
          this.#settle();
          this.durationInput()?.nativeElement.blur();
        }
      });
    });
  }

  #snap(seconds: number): number {
    const step = this.step();
    return step > 1 ? Math.round(seconds / step) * step : seconds;
  }

  protected sizeOf(): number {
    return Math.max(1, (this.draft() || this.placeholder()).length);
  }

  protected ariaInvalid(): boolean {
    return this.errorsVisible() || (this.#open() && this.#saveAttempted() && this.parseFailed());
  }

  // -- The live channel -----------------------------------------------------------

  #openSession() {
    if (this.#open()) return;
    this.#baselineValue = this.value();
    this.#dirty = false;
    this.#saveAttempted.set(false);
    this.#panelDismissed.set(false);
    this.#open.set(true);
  }

  /** Every keystroke: readable drafts flow into the model live (unsnapped). */
  protected handleInput(raw: string) {
    this.#openSession();
    this.draft.set(raw);
    this.#dirty = true;
    this.#saveAttempted.set(false);
    this.#panelDismissed.set(false);

    const parsed = parseDuration(raw, this.durationFormat());
    if (parsed !== undefined && parsed !== this.value()) this.value.set(parsed);
  }

  // -- Focus flow -------------------------------------------------------------------

  protected handleFocusIn() {
    this.#openSession();
    this.editing.set(true);
  }

  protected handleFocusOut() {
    if (this.#focusCheckTimer !== null) clearTimeout(this.#focusCheckTimer);
    this.#focusCheckTimer = setTimeout(() => this.#onFocusSettled(), 0);
  }

  #onFocusSettled() {
    this.#focusCheckTimer = null;
    const active = this.#document.activeElement;
    const inField = active !== null && active === this.durationInput()?.nativeElement;
    const inPanel = (active !== null && this.panelRef()?.nativeElement.contains(active)) ?? false;

    if (!inField && !inPanel) {
      this.#settle();
      this.editing.set(false);
    }
  }

  // -- Settlement (ONE per session — commit, snap-back, Escape, clear) --------------

  #settle(options: { revert?: boolean; keepOpen?: boolean } = {}) {
    if (!this.#open()) return;

    // An untouched session settles where the value stands (see #dirty).
    const untouched = !options.revert && !this.#dirty;

    let value: number | null;
    let snappedBack = false;

    if (untouched) {
      value = this.value();
    } else if (options.revert) {
      value = this.#baselineValue;
    } else {
      const parsed = parseDuration(this.draft(), this.durationFormat());
      if (parsed === undefined) {
        // Snap-back: an unreadable draft reverts to the session baseline.
        snappedBack = true;
        value = this.#baselineValue;
      } else {
        value = parsed === null ? null : this.#snap(parsed);
      }
    }

    if (!untouched && value !== this.value()) this.value.set(value);
    const changed = !untouched && value !== this.#baselineValue;
    this.#dirty = false;

    if (options.keepOpen) {
      this.#baselineValue = value;
      this.draft.set(this.display());
      this.#saveAttempted.set(false);
    } else {
      this.#open.set(false);
      this.#saveAttempted.set(false);
    }

    if (snappedBack) this.#announceRevert(value);

    this.#selfTouched.set(true);
    this.touch.emit();

    if (changed) this.savedModelChange.emit(value);
    this.saved.emit({ value, changed });
  }

  #announceRevert(value: number | null) {
    const restored = value === null ? 'empty' : formatDuration(value, this.durationFormat());
    this.revertNotice.set(`Reverted to ${restored}`);
    this.revertFlash.set(true);

    if (this.#flashTimer !== null) clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => this.revertFlash.set(false), 600);
  }

  // -- Keyboard -----------------------------------------------------------------------

  protected handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Enter': {
        event.preventDefault();
        if (parseDuration(this.draft(), this.durationFormat()) === undefined) {
          // The parse gate: the user ASKED for a commit — block and say why.
          this.#saveAttempted.set(true);
          return;
        }

        this.#settle({ keepOpen: true });
        this.#panelDismissed.set(true);
        return;
      }
      case 'Escape': {
        event.preventDefault();
        event.stopPropagation();
        this.#settle({ revert: true, keepOpen: true });
        this.#panelDismissed.set(true);
        return;
      }
    }
  }

  /**
   * Toggles the error panel. PUBLIC — the container-click affordance a
   * hosting container (the mat-form-field adapter) delegates to. (With no
   * error to show the panel stays empty-quiet — there is no live preview.)
   */
  togglePanel() {
    if (this.effectiveDisabled() || this.effectiveReadonly()) return;
    this.#panelDismissed.update((dismissed) => !dismissed);
  }

  // -- Form Value Contract ------------------------------------------------------------------

  focus(options?: FocusOptions) {
    this.durationInput()?.nativeElement.focus(options);
  }

  /** Presentation-only rollback — see the date control. */
  reset() {
    if (!this.#open()) return;

    if (this.#baselineValue !== this.value()) this.value.set(this.#baselineValue);
    this.draft.set(this.display());
    this.#saveAttempted.set(false);
    this.#panelDismissed.set(true);
  }
}
