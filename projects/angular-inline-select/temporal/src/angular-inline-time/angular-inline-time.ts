import {
  Component,
  ElementRef,
  TemplateRef,
  input,
  model,
  output,
  computed,
  linkedSignal,
  viewChild,
  contentChild,
} from '@angular/core';
import { FormValueControl, type ValidationError } from '@angular/forms/signals';

import {
  AngularInlineText,
  EditablePrefix,
  EditableSuffix,
  type InlineTextSaved,
} from 'angular-inline-select';
import { parseTime, formatWallClock, type WallClockTime } from './time-codec';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineTimeSaved {
  /** The value the session settled on — `'HH:mm'`, or `null` for empty. */
  value: WallClockTime | null;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * Inline time: a `FormValueControl` for wall-clock times that COMPOSES the
 * inline text control. Canonical value: `'HH:mm' | null` (24 h,
 * locale/timezone-free); display localizes via `Intl`.
 *
 * - Drafts are TYPED (`'9'` → 09:00, `'930'`, `'21:05'`) with a live
 *   interpretation preview; impossible times (`'25:00'`) hit the parse gate.
 * - **The picker is the OS's own**: a 🕐 suffix affix drives a
 *   visually-hidden `<input type="time">` — `showPicker()` where the
 *   platform supports it, falling back to focusing the input (mobile opens
 *   its wheels on focus). While editing, a pick replaces the draft; idle,
 *   it commits immediately (the flag-picker convention).
 */
@Component({
  selector: 'angular-inline-time',
  imports: [AngularInlineText],
  templateUrl: './angular-inline-time.html',
  styles: `
    :host { display: inline; position: relative; }
    .time-trigger {
      font: inherit;
      line-height: 1;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
      border-radius: var(--mat-sys-corner-extra-small, 0.25rem);
    }
    .time-trigger:focus-visible {
      outline: 2px solid var(--mat-sys-primary, #4285f4);
      outline-offset: 2px;
    }
    /* Focusable but invisible — display:none would break focus + showPicker anchoring */
    .time-native {
      position: absolute;
      inset-inline-start: 0;
      inset-block-end: 0;
      width: 1px;
      height: 1px;
      opacity: 0;
      border: 0;
      padding: 0;
    }
  `,
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineTime implements FormValueControl<WallClockTime | null> {
  /** The composed text control — all session machinery lives there. */
  protected inner = viewChild.required(AngularInlineText);

  /** The visually-hidden native input backing the OS picker. */
  protected nativeInput = viewChild.required<ElementRef<HTMLInputElement>>('nativeInput');

  /** The committed value channel: `'HH:mm'`, or `null`. */
  value = model<WallClockTime | null>(null);

  /** Form Value Contract — forwarded into the inner control. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  placeholder = input<string>('time');

  /** Accessible name for the field (contenteditable has no native label association). */
  ariaLabel = input<string | undefined>(undefined);

  /** Locale for the idle display + preview (`Intl`); browser default when omitted. */
  locale = input<string | string[] | undefined>(undefined);

  /** Granularity of the native picker, in seconds (forwarded to its `step`). */
  step = input<number>(60);

  /** The 🕐 OS-picker affordance. Off, or overridden by suffix content. */
  showNativePicker = input(true);

  /** Affix template passthrough (composition channel + content sugar). */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected consumerSuffixTpl = computed(
    () => this.suffixTemplate() ?? this.contentSuffix()?.templateRef,
  );

  /** Form Value Contract: touch — forwarded from the inner control. */
  touch = output<void>();

  /** Hard commit event: fires once per accepted edit session — `'HH:mm'` or `null`. */
  savedModelChange = output<WallClockTime | null>();

  /** Emitted exactly once per settled edit session (Save, Discard, clear). */
  saved = output<InlineTimeSaved>();

  /** Whether an edit session is open. Two-way bindable. */
  editing = model(false);

  /**
   * The string channel feeding the inner control: the localized committed
   * time while idle, the raw draft while a session is open.
   */
  protected innerValue = linkedSignal<string, string>({
    source: () => formatWallClock(this.value(), this.locale()),
    computation: (source, prev) => (this.editing() ? (prev?.value ?? source) : source),
  });

  /** The current draft's canonical reading (`null` empty, `undefined` unreadable). */
  readonly parsedDraft = computed(() => parseTime(this.innerValue()));

  /** The parse gate: whether the current draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(() => this.parsedDraft() === undefined);

  /** Errors forwarded inward: contract errors + the synthetic parse gate. */
  protected innerErrors = computed<readonly ValidationError.WithOptionalFieldTree[]>(() =>
    this.parseFailed() ? [...this.errors(), { kind: 'parse' }] : this.errors(),
  );

  /** Live interpretation preview: `✓ 9:30 AM` / `… raw`. */
  protected preview = computed(() => {
    const raw = this.innerValue().trim();
    if (!raw) return '';

    const time = this.parsedDraft();
    if (time === null || time === undefined) return `… ${raw}`;

    return `✓ ${formatWallClock(time, this.locale())}`;
  });

  /** Live channel: readable drafts flow into the model as `'HH:mm'`. */
  protected handleInnerValue(raw: string) {
    this.innerValue.set(raw);

    const time = parseTime(raw);
    if (time !== undefined && time !== this.value()) this.value.set(time);
  }

  /** Retype the settled session: strings inside, wall-clock times outside. */
  protected handleInnerSaved(session: InlineTextSaved) {
    const time = parseTime(session.value);
    const value = time === undefined ? this.value() : time;

    if (session.changed) {
      this.value.set(value);
      this.savedModelChange.emit(value);
    }

    this.saved.emit({ value, changed: session.changed });
  }

  /** Opens the OS time picker (or focuses the native input where unsupported). */
  protected openNativePicker(event: Event) {
    event.preventDefault();
    event.stopPropagation();

    const native = this.nativeInput().nativeElement;
    native.value = this.value() ?? '';

    try {
      native.showPicker();
    } catch {
      native.focus();
    }
  }

  /**
   * A pick from the OS picker: replaces the draft while editing, commits
   * immediately while idle (the flag-picker convention).
   */
  protected handleNativePick(raw: string) {
    const time = parseTime(raw);
    if (time === undefined) return;

    if (this.editing()) {
      this.innerValue.set(raw);
      if (time !== this.value()) this.value.set(time);
      return;
    }

    if (time !== this.value()) {
      this.value.set(time);
      this.savedModelChange.emit(time);
      this.saved.emit({ value: time, changed: true });
    }
  }

  /** Form Value Contract: focus — delegates to the inner control. */
  focus(options?: FocusOptions) {
    this.inner().focus(options);
  }

  /** Form Value Contract: reset — delegates to the inner control. */
  reset() {
    this.inner().reset();
  }
}
