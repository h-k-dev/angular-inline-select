import {
  Component,
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
import {
  parseDuration,
  formatDuration,
  describeDuration,
  type DurationFormat,
} from './duration-codec';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineDurationSaved {
  /** The value the session settled on — SECONDS, or `null` for empty. */
  value: number | null;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * Inline duration: a `FormValueControl` for durations that COMPOSES the
 * inline text control — the number control's sibling with a clock-shaped
 * codec. Canonical value: SECONDS (`number | null`, empty commits `null`).
 *
 * - Drafts accept colon notation (positional by `durationFormat`), unit
 *   tokens (`'1h 30m'`, `'45m'`, `'1.5h'`), or a bare number (minutes under
 *   hour formats, seconds under `mm:ss`).
 * - The live interpretation preview shows what the draft means on every
 *   keystroke (`✓ 1 h 30 min`) — the draft itself is never reformatted.
 * - Commits round-trip the codec (`'90'` under `h:mm` settles as `'1:30'`)
 *   and snap to `step` seconds when set (e.g. 60 for whole minutes).
 */
@Component({
  selector: 'angular-inline-duration',
  imports: [AngularInlineText],
  templateUrl: './angular-inline-duration.html',
  styles: ':host { display: inline; }',
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineDuration implements FormValueControl<number | null> {
  /** The composed text control — all session machinery lives there. */
  protected inner = viewChild.required(AngularInlineText);

  /** The committed value channel: duration in SECONDS, or `null`. */
  value = model<number | null>(null);

  /** Form Value Contract — forwarded into the inner control. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  placeholder = input<string>('0:00');

  /** Accessible name for the field (contenteditable has no native label association). */
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

  /** Form Value Contract: touch — forwarded from the inner control. */
  touch = output<void>();

  /** Hard commit event: fires once per accepted edit session — seconds or `null`. */
  savedModelChange = output<number | null>();

  /** Emitted exactly once per settled edit session (Save, Discard, clear). */
  saved = output<InlineDurationSaved>();

  /** Whether an edit session is open. Two-way bindable. */
  editing = model(false);

  /**
   * The string channel feeding the inner control: the formatted committed
   * value while idle, the raw draft while a session is open.
   */
  protected innerValue = linkedSignal<string, string>({
    source: () => formatDuration(this.value(), this.durationFormat()),
    computation: (source, prev) => (this.editing() ? (prev?.value ?? source) : source),
  });

  /** The parse gate: whether the current draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(
    () => parseDuration(this.innerValue(), this.durationFormat()) === undefined,
  );

  /** Errors forwarded inward: contract errors + the synthetic parse gate. */
  protected innerErrors = computed<readonly ValidationError.WithOptionalFieldTree[]>(() =>
    this.parseFailed() ? [...this.errors(), { kind: 'parse' }] : this.errors(),
  );

  /** Live interpretation preview: `✓ 1 h 30 min` / `… raw`. */
  protected preview = computed(() => {
    const raw = this.innerValue().trim();
    if (!raw) return '';

    const parsed = parseDuration(raw, this.durationFormat());
    if (parsed === null || parsed === undefined) return `… ${raw}`;

    return `✓ ${describeDuration(this.#snap(parsed))}`;
  });

  #snap(seconds: number): number {
    const step = this.step();
    return step > 1 ? Math.round(seconds / step) * step : seconds;
  }

  /** Live channel: every keystroke parses; readable drafts flow as seconds. */
  protected handleInnerValue(raw: string) {
    this.innerValue.set(raw);

    const parsed = parseDuration(raw, this.durationFormat());
    if (parsed !== undefined && parsed !== this.value()) this.value.set(parsed);
  }

  /** Retype the settled session: strings inside, seconds outside. */
  protected handleInnerSaved(session: InlineTextSaved) {
    const parsed = parseDuration(session.value, this.durationFormat());
    const value = parsed === undefined ? this.value() : parsed === null ? null : this.#snap(parsed);

    if (session.changed) {
      this.value.set(value);
      this.savedModelChange.emit(value);
    }

    this.saved.emit({ value, changed: session.changed });
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
