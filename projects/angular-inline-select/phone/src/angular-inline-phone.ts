import {
  Component,
  TemplateRef,
  input,
  model,
  output,
  computed,
  signal,
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
  countryFlagEmoji,
  type PhoneCodec,
  type PhoneCountry,
  type PhoneNumberKind,
  type PhoneParseWarning,
} from './phone-codec';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlinePhoneSaved {
  /** The value the session settled on — E.164, or `null` for empty. */
  value: string | null;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * Inline phone: a `FormValueControl` for phone numbers that COMPOSES the
 * inline text control — no inheritance, no third-party DOM/CSS. The engine
 * is an injected {@link PhoneCodec}; the canonical value is E.164.
 *
 * - **The live interpretation preview is the point**: while editing, the
 *   panel hint shows what the engine understood of the draft on every
 *   keystroke (flag · formatted number · validity marker). The draft itself
 *   is never reformatted — no caret fights, ever.
 * - **Two-tier severity**: structurally unreadable input (`not-a-number`,
 *   `invalid-country`, hopeless length) blocks the commit through the usual
 *   parse gate; suspicious-but-readable numbers (`too-short`, `too-long`,
 *   `unrecognized`) commit fine and surface as a ⚠ in the preview and via
 *   the public `parseWarning` signal.
 * - **Flag emoji as detection feedback**: the built-in prefix shows the
 *   detected (or default) country so `+49` vs `+21` reads at a glance —
 *   idle and while editing. A consumer `editablePrefix` overrides it.
 */
@Component({
  selector: 'angular-inline-phone',
  imports: [AngularInlineText],
  templateUrl: './angular-inline-phone.html',
  styles: ':host { display: inline; }',
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlinePhone implements FormValueControl<string | null> {
  /** The composed text control — all session machinery lives there. */
  protected inner = viewChild.required(AngularInlineText);

  /**
   * The committed value channel. Accepts any parseable phone string for
   * binding convenience; the component only ever writes E.164 or `null`.
   */
  value = model<string | null>(null);

  /** The engine. See `createLibphonenumberCodec` for the shipped adapter. */
  codec = input.required<PhoneCodec>();

  /** Country assumed for national-format input; `+CC` input overrides it. */
  defaultCountry = input<PhoneCountry | undefined>(undefined);

  /** How the committed value renders while idle. */
  displayFormat = input<'national' | 'international'>('international');

  /** Feeds the example-number placeholder. */
  numberKind = input<PhoneNumberKind>('fixed-or-mobile');

  /** The country-detection prefix. Off, or overridden by `editablePrefix` content. */
  showFlag = input(true);

  /** Form Value Contract — forwarded into the inner control. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  /** Placeholder override; defaults to an example number for `defaultCountry`. */
  placeholder = input<string | undefined>(undefined);

  /** Accessible name — put the expected country/format here, AT never hears the flag. */
  ariaLabel = input<string | undefined>(undefined);

  /** Consumer affix channel (a projected `editablePrefix` beats the flag). */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected suffixTpl = computed(() => this.suffixTemplate() ?? this.contentSuffix()?.templateRef);
  protected consumerPrefixTpl = computed(
    () => this.prefixTemplate() ?? this.contentPrefix()?.templateRef,
  );

  /** Form Value Contract: touch — forwarded from the inner control. */
  touch = output<void>();

  /**
   * Hard commit event: fires once per accepted edit session — always E.164
   * or `null`, never raw input.
   *
   * Roadmap Phase 3: superseded by `saved` — kept during the transition.
   */
  savedModelChange = output<string | null>();

  /** Emitted exactly once per settled edit session (Save, Discard, clear). */
  saved = output<InlinePhoneSaved>();

  /** The canonical (E.164) reading of the model. */
  protected canonical = computed<string | null>(() => {
    const value = this.value();
    if (value === null || value === undefined || value === '') return null;

    const result = this.codec().parse(value, this.defaultCountry());
    return result?.ok ? result.e164 : value;
  });

  /** Two-way `editing` bridge — freezes the string channel during a session. */
  protected innerEditing = signal(false);

  /**
   * The string channel feeding the inner control: the formatted committed
   * value while idle, the raw draft while a session is open. Commits
   * round-trip the codec — `'01712345678'` settles as `'+49 171 2345678'`.
   */
  protected innerValue = linkedSignal<string, string>({
    source: () => {
      const canonical = this.canonical();
      if (canonical === null) return '';

      return this.codec().format(canonical, this.displayFormat(), this.defaultCountry());
    },
    computation: (source, prev) => (this.innerEditing() ? (prev?.value ?? source) : source),
  });

  /** The engine's live interpretation of the current draft. Public — consumers render from it. */
  readonly parseResult = computed(() => this.codec().parse(this.innerValue(), this.defaultCountry()));

  /** The parse gate: structurally unreadable input cannot commit. */
  readonly parseFailed = computed(() => this.parseResult()?.ok === false);

  /** Soft finding on a committable draft (`too-short`, `unrecognized`, …). */
  readonly parseWarning = computed<PhoneParseWarning | null>(() => {
    const result = this.parseResult();
    return result?.ok ? (result.warning ?? null) : null;
  });

  /** Detected country of the current draft/value, falling back to `defaultCountry`. */
  readonly country = computed<PhoneCountry | undefined>(() => {
    const result = this.parseResult();
    return (result?.ok ? result.country : undefined) ?? this.defaultCountry();
  });

  /** Country calling code without `+`, e.g. `'49'`. */
  readonly dialCode = computed<string | undefined>(() => {
    const result = this.parseResult();
    return result?.ok ? result.dialCode : undefined;
  });

  protected flag = computed(() => {
    const country = this.country();
    return this.showFlag() && country ? countryFlagEmoji(country) : '';
  });

  /**
   * The interpretation preview, rebuilt per keystroke and rendered in the
   * panel hint: language-neutral (flag, digits, ✓/⚠/… markers) so the
   * library ships no words to translate.
   */
  protected preview = computed(() => {
    const raw = this.innerValue().trim();
    if (!raw) return '';

    const result = this.parseResult();
    if (result?.ok) {
      const marker = result.warning ? '⚠' : '✓';
      return `${marker} ${result.international}`;
    }

    // `||`: an empty pretty-print (e.g. no digits at all) falls back to the raw draft
    const incomplete = this.codec().formatIncomplete?.(raw, this.defaultCountry()) || raw;
    return `… ${incomplete}`;
  });

  /**
   * Errors forwarded to the inner control: the contract errors plus a
   * synthetic message-less `{ kind: 'parse' }` while the draft is
   * structurally unreadable — the inner accept guard and error slot do the
   * rest. Warnings deliberately stay out of here: they never block.
   */
  protected innerErrors = computed<readonly ValidationError.WithOptionalFieldTree[]>(() =>
    this.parseFailed() ? [...this.errors(), { kind: 'parse' }] : this.errors(),
  );

  protected effectivePlaceholder = computed(() => {
    const placeholder = this.placeholder();
    if (placeholder !== undefined) return placeholder;

    const country = this.defaultCountry();
    const example = country
      ? this.codec().placeholderExample?.(country, this.numberKind())
      : undefined;

    return example ?? 'phone';
  });

  /**
   * Live channel: every keystroke parses. Readable drafts flow into the
   * model as E.164 (schema validators see the canonical value mid-draft),
   * unreadable ones hold the last good value and raise the parse gate.
   */
  protected handleInnerValue(raw: string) {
    this.innerValue.set(raw);

    const result = this.codec().parse(raw, this.defaultCountry());
    if (result === null) {
      if (this.canonical() !== null) this.value.set(null);
      return;
    }

    if (result.ok && result.e164 !== this.canonical()) this.value.set(result.e164);
  }

  /** Retype the settled session: raw strings inside, E.164 outside. */
  protected handleInnerSaved(session: InlineTextSaved) {
    const result = this.codec().parse(session.value, this.defaultCountry());
    // The parse gate blocks unreadable commits; the fallback covers discards
    // rolling back to a baseline the current codec cannot read.
    const value = result === null ? null : result.ok ? result.e164 : this.canonical();

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
