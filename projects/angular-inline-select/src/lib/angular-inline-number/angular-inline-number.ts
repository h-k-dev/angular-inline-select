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
import { EditableClearTemplate, type EditableClearContext } from '../bubble-menu/editable-clear';
import {
  makeLocaleNumberCodec,
  formatLocaleNumber,
  parseLocaleNumber,
  localeNumberChars,
  type LocaleNumberOptions,
} from '../utils/locale-number/locale-number';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineNumberSaved {
  /** The value the session settled on — always a number, or `null` for empty. */
  value: number | null;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * Which decimal separator a field accepts in a draft and shows when idle.
 *
 * - `'.'` (default) — dot only, the JavaScript-native shape.
 * - `','` — comma only, for locales that write `1,5`.
 * - `'both'` — accepts either while typing, displays the canonical dot.
 *
 * The model is always a `number`, so the bound field never sees a separator
 * of any kind: `1,5` reaches the schema as `1.5`.
 */
export type DecimalSeparator = '.' | ',' | 'both';

/**
 * The characters a restricted number draft admits: digits, sign, and BOTH
 * decimal separators — regardless of which one the codec actually parses.
 *
 * Deliberately a SUPERSET of any one codec rather than a mirror of it. A
 * `decimalSeparator: ','` field on a keyboard that emits `.` (which is most
 * of them — `inputMode="decimal"` gives no guarantee about which separator
 * the virtual key produces) would otherwise have a silently dead decimal
 * key. Admitting both keeps the codec the sole authority on what *parses*, so
 * the wrong separator raises a visible parse error instead of vanishing.
 */
const NUMBER_CHARS = /[0-9+.,-]/;

/** The separator characters a setting accepts in a draft. */
function acceptedSeparators(separator: DecimalSeparator): string {
  return separator === 'both' ? '.,' : separator;
}

/** The separator a setting emits when formatting. `'both'` settles on the dot. */
function displayedSeparator(separator: DecimalSeparator): '.' | ',' {
  return separator === ',' ? ',' : '.';
}

/**
 * Builds a parser for a separator setting: `''` means empty (`null`), text
 * that is not a number means unparseable (`undefined` — raises the parse
 * gate), and anything parseable normalizes to a dot-decimal `number`.
 *
 * Note that admitting the comma as a DECIMAL separator necessarily means
 * `'1,000'` reads as `1`, not one thousand. A field cannot accept the comma
 * in both roles; thousands grouping is a `format` concern, not a `parse` one.
 */
export function makeParseNumber(
  separator: DecimalSeparator = '.',
): (raw: string) => number | null | undefined {
  // `.` and `,` are both literal inside a character class.
  const accepted = `[${acceptedSeparators(separator)}]`;

  // `Number()` alone would accept hex (`0x10`), binary, octal, scientific
  // (`1e3`) and `Infinity` — all surprising in a plain number field — so gate
  // on a strict decimal shape first.
  const shape = new RegExp(`^[+-]?(?:\\d+(?:${accepted}\\d*)?|${accepted}\\d+)$`);

  return (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    if (!shape.test(trimmed)) return undefined;

    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  };
}

/** Builds a formatter for a separator setting. @see makeParseNumber */
export function makeFormatNumber(
  separator: DecimalSeparator = '.',
): (value: number | null) => string {
  const shown = displayedSeparator(separator);

  return (value: number | null) => {
    if (value === null) return '';

    const text = String(value);
    return shown === '.' ? text : text.replace('.', shown);
  };
}

/** The dot-decimal codec — the default when no `decimalSeparator` is set. */
export const defaultParseNumber = makeParseNumber('.');
export const defaultFormatNumber = makeFormatNumber('.');

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

  placeholder = input('N/A');

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
   * Consumer clear affordance — forwarded verbatim to the inner control,
   * which owns the bubble (and whose context callback clears THROUGH this
   * wrapper: the empty commit arrives here as a normal settlement). Same
   * re-projection reason as the affixes: input for composition,
   * `ng-template[editableClear]` content for direct use.
   */
  clearTemplate = input<TemplateRef<EditableClearContext> | undefined>(undefined);

  private contentClear = contentChild(EditableClearTemplate);

  protected clearTpl = computed(() => this.clearTemplate() ?? this.contentClear()?.templateRef);

  /**
   * Which decimal separator the draft accepts and the idle text shows.
   * `'both'` takes either while typing and settles on the dot.
   *
   * This never reaches the bound field: the model is a `number`, so a
   * comma-typed `1,5` arrives at the schema as `1.5`.
   */
  decimalSeparator = input<DecimalSeparator>('.');

  /**
   * Opt-in: characters that cannot appear in ANY number are rejected as they
   * are typed, rather than landing in the draft and raising the parse gate.
   * Off by default.
   *
   * The admitted set is {@link NUMBER_CHARS} — digits, sign, and both decimal
   * separators — independent of `decimalSeparator`. It is a superset of every
   * codec, never a mirror of one, so no keyboard can end up with a dead
   * decimal key. Which separator actually *parses* stays the codec's call, and
   * the wrong one surfaces as a visible parse error.
   *
   * That superset is also why a custom `parse` composes here: the filter only
   * removes characters no numeric codec could want. A codec needing letters
   * (hex, `1e3`, unit suffixes) should leave this off and use
   * `angular-inline-text` with its own `allowedChars`.
   *
   * A filter is not a validator: `1.2.3` and `1,5.5` both survive it and the
   * parse gate still catches them. What it buys is that `parseFailed()` never
   * flips for a stray letter, so no error message flashes while someone
   * fat-fingers.
   *
   * Rejection is silent — nothing is announced, and a paste of entirely
   * illegal text (`'N/A'`) onto an empty field does nothing at all. Name the
   * constraint in `ariaLabel` ("Fuel reserve in litres, digits only") so it is
   * discoverable before the user hits it rather than after.
   */
  restrictInput = input(false);

  /**
   * The character class handed to the inner control, or `undefined` when
   * off. Under a `locale` it widens by that locale's own separators, so the
   * grouped display (`1 000,5`) pastes back into the field it came from.
   */
  protected allowedChars = computed(() => {
    if (!this.restrictInput()) return undefined;

    const locale = this.locale();
    return locale === undefined ? NUMBER_CHARS : localeNumberChars(locale);
  });

  /**
   * Opt-in LOCALE codec — the same `locale` shape the temporal family takes.
   * Set, the idle text and the draft follow `Intl.NumberFormat` for that
   * locale: thousands grouped, the decimal mark the locale's own
   * (`1,000.25` under `en`, `1.000,25` under `de`), and `decimalSeparator`
   * is superseded. The model stays a dot-decimal `number` regardless; the
   * locale never crosses the contract boundary. Unset — the default —
   * nothing changes. The rules live in `utils/locale-number`
   * (`parseLocaleNumber`/`formatLocaleNumber`), reusable outside the control.
   */
  locale = input<string | string[] | undefined>(undefined);

  /**
   * `Intl.NumberFormat` options for the locale codec — fraction digits,
   * grouping, sign display. Ignored without `locale`. Precision defaults to
   * the widest; narrow it deliberately (two fixed decimals for money).
   */
  numberFormatOptions = input<LocaleNumberOptions | undefined>(undefined);

  /**
   * The codec — override either half for shapes neither `locale` nor
   * `decimalSeparator` covers. `parse` returns `null` for empty and
   * `undefined` for unparseable text. Left unset, both derive from `locale`
   * when set, else from `decimalSeparator`.
   */
  parse = input<((raw: string) => number | null | undefined) | undefined>(undefined);
  format = input<((value: number | null) => string) | undefined>(undefined);

  /** The locale codec, or `null` without a `locale`. */
  private localeCodec = computed(() => {
    const locale = this.locale();
    return locale === undefined ? null : makeLocaleNumberCodec(locale, this.numberFormatOptions());
  });

  /**
   * Under a locale the editor opens on the PLAIN number: grouping is a
   * reading aid, not something to type around — a digit inserted into
   * `1.250.000,50` would break a group and raise the parse gate. So the
   * draft is `1250000,5`: no groups, no padded decimals, the locale's own
   * decimal mark; the idle display keeps the grouped rendering. Without a
   * locale the display already is the plain text.
   *
   * A pure function of the text it is handed, never of the live model: the
   * inner control also maps the frozen session BASELINE through it to decide
   * `changed`, and a draft that tracked the live value would always equal
   * its own baseline.
   */
  protected draftText = computed(() => {
    const locale = this.locale();
    if (locale === undefined) return undefined;

    const options = this.numberFormatOptions();
    return (committed: string) => {
      const parsed = parseLocaleNumber(committed, locale);
      if (parsed === undefined) return committed;

      return formatLocaleNumber(parsed, locale, {
        ...options,
        useGrouping: false,
        minimumFractionDigits: 0,
      });
    };
  });

  /** The effective codec: an explicit override, else the locale's, else the separator's own. */
  protected activeParse = computed(
    () => this.parse() ?? this.localeCodec()?.parse ?? makeParseNumber(this.decimalSeparator()),
  );
  protected activeFormat = computed(
    () => this.format() ?? this.localeCodec()?.format ?? makeFormatNumber(this.decimalSeparator()),
  );

  /** Form Value Contract: touch — forwarded from the inner control. */
  touch = output<void>();

  /**
   * THE consumer commit event — fires once per changed settlement with the
   * MODEL: `{ value }`, always `number | null` inside, never a string.
   */
  savedModelChange = output<{ value: number | null }>();

  /**
   * The MACHINERY channel: exactly one emission per settled edit session
   * (Save, Discard, clear — changed or not). Adapters/wrappers bind this;
   * app consumers should bind `savedModelChange`.
   */
  saved = output<InlineNumberSaved>();

  /** The numeric reading of the (possibly string-typed) model. */
  protected numericValue = computed<number | null>(() => {
    const value = this.value();
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isNaN(value) ? null : value;

    return this.activeParse()(value) ?? null;
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
    source: () => this.activeFormat()(this.numericValue()),
    computation: (source, prev) => (this.editing() ? (prev?.value ?? source) : source),
    // The live channel IS the setter (22.1): every raw write parses, and a
    // parseable draft flows into the model synchronously — no write site
    // can forget the other half.
    set: (raw, rawSet) => {
      rawSet(raw);

      const parsed = this.activeParse()(raw);
      if (parsed !== undefined && parsed !== this.numericValue()) this.value.set(parsed);
    },
  });

  /**
   * The parse gate: whether the current draft fails the codec. Public so
   * consumers can present a message for it in their `[editable-error]`
   * content (the synthetic error itself is message-less).
   */
  readonly parseFailed = computed(() => this.activeParse()(this.innerValue()) === undefined);

  /**
   * Errors forwarded to the inner control: the contract errors plus the
   * synthetic `{ kind: 'parse' }` while the draft is unparseable.
   */
  protected innerErrors = computed<readonly ValidationError.WithOptionalFieldTree[]>(() =>
    this.parseFailed() ? [...this.errors(), { kind: 'parse' }] : this.errors(),
  );

  /**
   * Live channel: every keystroke parses — the work lives in `innerValue`'s
   * custom `set`, so parseable drafts flow into the model as numbers
   * (schema rules like `min`/`max` validate mid-draft) while unparseable
   * ones hold the last good value and raise the parse gate.
   */
  protected handleInnerValue(raw: string) {
    this.innerValue.set(raw);
  }

  /** Retype the settled session: strings inside, numbers outside. */
  protected handleInnerSaved(session: InlineTextSaved) {
    const parsed = this.activeParse()(session.value);
    // The parse gate blocks unparseable commits; the fallback covers discards
    // rolling back to a baseline the current codec cannot read.
    const value = parsed === undefined ? this.numericValue() : parsed;

    if (session.changed) {
      this.value.set(value);
      this.savedModelChange.emit({ value });
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
