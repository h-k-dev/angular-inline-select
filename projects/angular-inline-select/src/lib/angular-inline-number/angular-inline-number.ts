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
  type InlineTextSaved,
} from '../angular-inline-text/angular-inline-text';
import { EditablePrefix, EditableSuffix } from '../angular-inline-text/editable-affix';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineNumberSaved {
  /** The value the session settled on — always a number, or `null` for empty. */
  value: number | null;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * Dot-decimal default codec: `''` means empty (`null`), text that is not a
 * number means unparseable (`undefined` — raises the parse gate).
 */
export function defaultParseNumber(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Dot-decimal only. `Number()` alone would accept hex (`0x10`), binary,
  // octal, scientific (`1e3`) and `Infinity` — all surprising in a plain
  // number field — so gate on a strict decimal shape first.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return undefined;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function defaultFormatNumber(value: number | null): string {
  return value === null ? '' : String(value);
}

/**
 * Inline number: a `FormValueControl<number>` that COMPOSES the inline text
 * control — no inheritance. It contains an `<angular-inline-text>` and does
 * exactly one job at the boundary: translate between the number world
 * (outside) and the string world (inside) through a swappable codec.
 *
 * - The contract flows through: state inputs forward in, `touch`/`saved`
 *   retype out, `focus()`/`reset()` delegate, `[editable-error]` re-projects.
 * - The parse gate is just an error: an unparseable draft appends a
 *   synthetic message-less `{ kind: 'parse' }` to the forwarded errors — the
 *   inner accept guard blocks the save and the inner error slot presents the
 *   consumer's projected message. No new mechanism.
 * - Accepts `number | string | null` on the way in for binding convenience;
 *   every outbound write and event is `number | null` (empty commits `null`).
 */
@Component({
  selector: 'angular-inline-number',
  imports: [AngularInlineText],
  templateUrl: './angular-inline-number.html',
  styles: ':host { display: inline; }',
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineNumber implements FormValueControl<number | string | null> {
  /** The composed text control — all session machinery lives there. */
  protected inner = viewChild.required(AngularInlineText);

  /**
   * The committed value channel. Accepts `number | string | null` for
   * binding convenience; the component only ever writes `number | null`.
   */
  value = model<number | string | null>(null);

  /** Form Value Contract — forwarded into the inner control. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  placeholder = input<string>('N/A');

  /** Accessible name for the field (contenteditable has no native label association). */
  ariaLabel = input<string | undefined>(undefined);

  /**
   * Affix templates — declared as direct content (`ng-template[editableSuffix]`)
   * or passed as inputs; either way they forward into the inner control as
   * TemplateRefs, since content queries don't pierce re-projection.
   */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected suffixTpl = computed(() => this.suffixTemplate() ?? this.contentSuffix()?.templateRef);

  /**
   * The codec — swap both halves to localize (e.g. Intl comma decimals).
   * `parse` returns `null` for empty and `undefined` for unparseable text.
   */
  parse = input<(raw: string) => number | null | undefined>(defaultParseNumber);
  format = input<(value: number | null) => string>(defaultFormatNumber);

  /** Form Value Contract: touch — forwarded from the inner control. */
  touch = output<void>();

  /**
   * Hard commit event: fires once per accepted edit session — always
   * `number | null`, never a string.
   *
   * Roadmap Phase 3: superseded by `saved` — kept during the transition.
   */
  savedModelChange = output<number | null>();

  /** Emitted exactly once per settled edit session (Save, Discard, clear). */
  saved = output<InlineNumberSaved>();

  /** The numeric reading of the (possibly string-typed) model. */
  protected numericValue = computed<number | null>(() => {
    const value = this.value();
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isNaN(value) ? null : value;

    return this.parse()(value) ?? null;
  });

  /**
   * Whether an edit session is open. Two-way bindable — also the bridge that
   * freezes the string channel while a session runs.
   */
  editing = model(false);

  /**
   * The string channel feeding the inner control. Follows the formatted
   * model while idle; while a session is open it holds the raw draft, so a
   * reformat can never rewrite the text under the caret. Committing runs the
   * draft through the codec both ways — `'12.50'` settles and displays as
   * `'12.5'`.
   */
  protected innerValue = linkedSignal<string, string>({
    source: () => this.format()(this.numericValue()),
    computation: (source, prev) => (this.editing() ? (prev?.value ?? source) : source),
  });

  /**
   * The parse gate: whether the current draft fails the codec. Public so
   * consumers can present a message for it in their `[editable-error]`
   * content (the synthetic error itself is message-less).
   */
  readonly parseFailed = computed(() => this.parse()(this.innerValue()) === undefined);

  /**
   * Errors forwarded to the inner control: the contract errors plus the
   * synthetic `{ kind: 'parse' }` while the draft is unparseable.
   */
  protected innerErrors = computed<readonly ValidationError.WithOptionalFieldTree[]>(() =>
    this.parseFailed() ? [...this.errors(), { kind: 'parse' }] : this.errors(),
  );

  /**
   * Live channel: every keystroke parses. Parseable drafts flow into the
   * model as numbers — schema rules like `min`/`max` validate mid-draft —
   * while unparseable ones hold the last good value and raise the parse gate.
   */
  protected handleInnerValue(raw: string) {
    this.innerValue.set(raw);

    const parsed = this.parse()(raw);
    if (parsed !== undefined && parsed !== this.numericValue()) this.value.set(parsed);
  }

  /** Retype the settled session: strings inside, numbers outside. */
  protected handleInnerSaved(session: InlineTextSaved) {
    const parsed = this.parse()(session.value);
    // The parse gate blocks unparseable commits; the fallback covers discards
    // rolling back to a baseline the current codec cannot read.
    const value = parsed === undefined ? this.numericValue() : parsed;

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
