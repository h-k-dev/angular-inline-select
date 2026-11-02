// Angular
import {
  Component,
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
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

// Forms
import { FormValueControl, type ValidationError } from '@angular/forms/signals';

// CDK
import { _IdGenerator } from '@angular/cdk/a11y';
import { OverlayModule, type ConnectedPosition } from '@angular/cdk/overlay';

// Editables
import {
  AngularInlineText,
  EditableClearTemplate,
  EditableActionsTemplate,
  EditablePrefix,
  EditableSuffix,
  type EditableClearContext,
  type EditableActionsContext,
  type InlineTextSaved,
} from 'angular-inline-select';
import {
  countryFlagEmoji,
  type PhoneCodec,
  type PhoneCountry,
  type PhoneNumberKind,
  type PhoneParseResult,
  type PhoneParseWarning,
} from './phone-codec';
import { PhoneCodecLoader } from './phone-codec-loader';
import { joinDialString, splitDialString, telHref } from './dial-string';

/** The `editableActions` payload: everything a house needs to act on a phone number. */
export interface InlinePhoneActions {
  /**
   * The committed value — E.164, or `<prefix> 00<CC> …` with a dial prefix;
   * else the raw string an injection kept.
   */
  value: string | null;
  /** The dial prefix (`'#0'`), or `''`. */
  dialPrefix: string;
  e164: string | null;
  /** A ready href (`dialHref` of the value), or null when the value does not parse. */
  tel: string | null;
  country: PhoneCountry | undefined;
  national: string | null;
  international: string | null;
}

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlinePhoneSaved {
  /** The value the session settled on — E.164 (or the prefixed dial string), or `null` for empty. */
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
 * - **Dial prefixes** (`#0 `, `*31#`) are split off before the codec reads
 *   the number: muted text after the flag while idle, plain draft text while
 *   editing. The value stores them as `<prefix> 00<CC> …` (see `dial-string`).
 */
@Component({
  selector: 'angular-inline-phone',
  imports: [
    // Angular
    NgTemplateOutlet,

    // CDK
    OverlayModule,

    // Components
    AngularInlineText,
  ],
  templateUrl: './angular-inline-phone.html',
  styles: `
    /* The flag is the number's LEAD: the editables' lead track for its box, the
       lead gap before the number (--editable-lead-size, --editable-lead-gap),
       so the number starts where any value after a leading glyph does. */
    :host {
      --editable-text-prefix-gap: var(--editable-lead-gap, var(--mat-sys-spacing, 0.25rem));

      display: inline;
    }
    .country-name {
      flex: 1 1 auto;
    }
    .country-dial {
      color: var(--mat-sys-on-surface-variant, #5f6368);
      font-variant-numeric: tabular-nums;
    }
    .country-empty {
      padding: calc(var(--mat-sys-inner-spacing, 16px) / 4)
        calc(var(--mat-sys-inner-spacing, 16px) / 2);
      color: var(--mat-sys-on-surface-variant, #5f6368);
    }

    /* The dial prefix: keypad codes, not number digits — muted text in the
       value's own font, so it starts the text column (after the flag's lead
       track and gap) and shares the number's baseline. The affix → text gap
       is the space before the number. */
    .dial-prefix {
      color: var(--mat-sys-on-surface-variant, #5f6368);
      white-space: nowrap;
    }
    * + .dial-prefix {
      margin-inline-start: var(--editable-text-prefix-gap);
    }

    /*
     * Flag-only elements: Windows' emoji font has no flag glyphs (🇩🇪 renders
     * as "DE"), so a flag font goes first when the consumer has one loaded.
     * An undeclared family is skipped — native flags stay where they work.
     */
    .country-trigger,
    .country-flag {
      font-family: var(--editable-phone-flag-font, 'Twemoji Country Flags'), sans-serif;

      /*
       * A RESERVED box, not the glyph's own advance: flag widths differ per
       * emoji font (and "DE" letters are wider still), so a late font swap or
       * the passthrough → engine upgrade would otherwise shift the number. The
       * lead track by default, the 1em flag glyph centred in it.
       */
      display: inline-block;
      flex: none;
      inline-size: var(--editable-phone-flag-width, var(--editable-lead-size, calc(var(--mat-sys-spacing, 0.25rem) * 4)));
      text-align: center;
      white-space: nowrap;
      overflow: clip;
    }
    .country-trigger {
      font-size: inherit;
      line-height: 1;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
      border-radius: var(--mat-sys-corner-extra-small, 0.25rem);
    }
    .country-trigger:focus-visible {
      outline: 2px solid var(--mat-sys-primary, #4285f4);
      outline-offset: 2px;
    }
    .country-trigger--pending {
      cursor: default;
    }

    .country-picker {
      display: flex;
      flex-direction: column;
      width: min(20rem, calc(100dvw - 16px));
      max-height: min(24rem, 60dvh);
      box-sizing: border-box;

      background: var(--mat-sys-surface-container, #fff);
      border: 1px solid var(--mat-sys-outline-variant, #c4c7c5);
      border-radius: var(--mat-sys-corner-medium, 0.75rem);
      box-shadow:
        0 2px 6px hsl(0deg 0% 0% / 0.08),
        0 8px 24px hsl(0deg 0% 0% / 0.12);
      overflow: hidden;
    }
    .country-picker__search {
      font: inherit;
      padding: 0.6rem 0.75rem;
      border: 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant, #c4c7c5);
      background: transparent;
      color: inherit;
      outline: none;
    }
    .country-picker__list {
      overflow-y: auto;
      padding: 4px;
    }
    .country-picker__list [role='option'] {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.5rem;
      border-radius: var(--mat-sys-corner-small, 0.4rem);
      cursor: pointer;
    }
    /* Hover and the active row can be neighbours: a hairline gap keeps the two
       chips apart instead of merging into one block. */
    .country-picker__list [role='option'] + [role='option'] {
      margin-top: calc(var(--mat-sys-spacing, 0.25rem) / 2);
    }
    .country-picker__list [role='option']:is([data-active='true'], :hover) {
      /* The app's listbox token (iusta aria/_listbox.scss \`--iusta-sys-option-active\`):
         Material's option focus layer, else on-surface at 12%. Label color stays.
         Pointer hover paints the same chip as the active/selected row. */
      background-color: var(
        --mat-option-focus-state-layer-color,
        oklch(from var(--mat-sys-on-surface) l c h / 0.12)
      );
    }
  `,
  host: {
    // Styles
    '[style.display]': 'hidden() ? "none" : null',

    // Listeners
    '(mouseenter)': 'loadCodec()',
    '(focusin)': 'loadCodec()',
  },
})
export class AngularInlinePhone implements FormValueControl<string | null> {
  /** The composed text control — all session machinery lives there. */
  protected inner = viewChild.required(AngularInlineText);

  /**
   * The committed value channel. Accepts any parseable phone string for
   * binding convenience; the component only ever writes E.164, the
   * prefixed dial string `<prefix> 00<CC> …`, or `null`.
   */
  value = model<string | null>(null);

  /**
   * The href the actions payload hands out for a committed value. `tel:` with
   * `#` escaped by default — swap it for `callto:`, `sip:` or a softphone's
   * own scheme without touching the component.
   */
  dialHref = input<(value: string) => string>(telHref);

  /**
   * The engine, bound directly. Optional: left unset, the field shares the
   * app-wide lazy engine registered with `providePhoneCodec` — the default.
   */
  codec = input<PhoneCodec | undefined>(undefined);

  readonly #codecLoader = inject(PhoneCodecLoader);

  /**
   * The effective engine — `null` only while the shared lazy engine loads, in
   * which the template renders a plain text passthrough. Every `engine()!`
   * below runs only from bindings inside the engine branch of the template,
   * hence the non-null assertions.
   */
  protected engine = computed(() => this.codec() ?? this.#codecLoader.codec());

  /**
   * The template's branch gate: the engine has landed AND the swap is safe.
   * The upgrade replaces the inner control, so it never happens under an open
   * passthrough session (focus and draft would die with it) — it waits for
   * the session to settle. Once upgraded, sessions no longer hold it back.
   */
  protected upgraded = linkedSignal<{ ready: boolean; editing: boolean }, boolean>({
    source: () => ({ ready: this.engine() !== null, editing: this.innerEditing() }),
    computation: ({ ready, editing }, prev) => ready && (prev?.value === true || !editing),
  });

  /** The urgent half of idle-until-urgent: hover/focus skip the idle wait. */
  protected loadCodec() {
    if (!this.codec()) void this.#codecLoader.ensureLoaded();
  }

  constructor() {
    // The polite half: the first rendered field schedules the one shared load.
    effect(() => {
      if (!this.codec()) this.#codecLoader.loadWhenIdle();
    });
  }

  /**
   * Country assumed for national-format input; `+CC` input overrides it.
   * Germany by default — pass another ISO code, or `undefined` to require `+CC`.
   */
  defaultCountry = input<PhoneCountry | undefined>('DE');

  /** How the committed value renders while idle. */
  displayFormat = input<'national' | 'international'>('international');

  /** Feeds the example-number placeholder. */
  numberKind = input<PhoneNumberKind>('fixed-or-mobile');

  /** The country-detection prefix. Off, or overridden by `editablePrefix` content. */
  showFlag = input(true);

  /** Enables the `/country` slash-menu (type `/german`, `/de`, `/49` → `+49 `). */
  showCountryMenu = input(true);

  /**
   * Locale for the slash-menu's country names (`Intl.DisplayNames`). Undefined
   * = the browser default. Only affects display and adds a matching basis;
   * the English name, ISO code and dial code always match too.
   */
  menuLocale = input<string | string[] | undefined>(undefined);

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

  /**
   * Consumer clear affordance — forwarded verbatim to the inner control,
   * which owns the bubble. Clearing through its context callback lands here
   * as a normal settlement (`null`, never a raw draft). Same re-projection
   * reason as the affixes.
   */
  clearTemplate = input<TemplateRef<EditableClearContext> | undefined>(undefined);

  /** Forwarded to the inner control: `false` never offers the hover-bubble clear. */
  showClear = input(true);

  private contentClear = contentChild(EditableClearTemplate);

  protected clearTpl = computed(() => this.clearTemplate() ?? this.contentClear()?.templateRef);

  /** The primary-actions slot, forwarded to the inner control with THIS payload. */
  actionsTemplate = input<TemplateRef<EditableActionsContext<InlinePhoneActions>> | undefined>(
    undefined,
  );

  private contentActions = contentChild(EditableActionsTemplate<InlinePhoneActions>);

  protected actionsTpl = computed(
    () => this.actionsTemplate() ?? this.contentActions()?.templateRef,
  );

  /**
   * What a house needs to ACT on a phone number: the E.164 value, a ready
   * `tel:` href, the country, and both formats — so a template can render an
   * anchor, or hand the number to its own dialer service.
   */
  protected actionsData = computed<InlinePhoneActions>(() => {
    const canonical = this.canonical();
    const { prefix, result } = this.#committed();
    if (canonical === null || !result?.ok) {
      return {
        value: canonical,
        dialPrefix: '',
        e164: null,
        tel: null,
        country: this.country(),
        national: null,
        international: null,
      };
    }

    return {
      value: canonical,
      dialPrefix: prefix,
      e164: result.e164,
      tel: this.dialHref()(canonical),
      country: result.country ?? this.country(),
      national: result.national,
      international: result.international,
    };
  });

  /** Form Value Contract: touch — forwarded from the inner control. */
  touch = output();

  /**
   * THE consumer commit event — fires once per changed settlement with the
   * MODEL: `{ value }`, always canonical (E.164, the prefixed dial string) or
   * `null` inside, never raw input.
   */
  savedModelChange = output<{ value: string | null }>();

  /**
   * The MACHINERY channel: exactly one emission per settled edit session
   * (Save, Discard, clear — changed or not). Adapters/wrappers bind this;
   * app consumers should bind `savedModelChange`.
   */
  saved = output<InlinePhoneSaved>();

  /**
   * Reads a raw value: the dial prefix split off, the rest through the codec.
   * A prefix with no number yet is an unfinished draft, never an empty one.
   */
  #read(raw: string): { prefix: string; result: PhoneParseResult | null } {
    const { prefix, number } = splitDialString(raw);
    const result = this.engine()!.parse(number, this.defaultCountry());

    return { prefix, result: prefix && result === null ? { ok: false, reason: 'too-short' } : result };
  }

  /** The stored form of a readable number: E.164, or the prefixed `00` dial string. */
  #canonicalOf(prefix: string, e164: string) {
    if (!prefix) return e164;

    return joinDialString(prefix, this.engine()!.format(e164, 'international'));
  }

  /** The committed value, read — nothing to read before the lazy engine lands. */
  #committed = computed(() =>
    this.engine() ? this.#read(this.value() ?? '') : { prefix: '', result: null },
  );

  /** The canonical reading of the model: E.164, or the prefixed dial string. */
  protected canonical = computed<string | null>(() => {
    const value = this.value();
    if (value === null || value === undefined || value === '') return null;

    const { prefix, result } = this.#committed();
    return result?.ok ? this.#canonicalOf(prefix, result.e164) : value;
  });

  /** Two-way `editing` bridge — freezes the string channel during a session. */
  protected innerEditing = signal(false);

  /**
   * The model when the open session began. The live channel moves `value`
   * mid-draft, and the inner control settles an unchanged session (or a
   * discard) by writing back the baseline's RENDERING — which has no dial
   * prefix to read back. This is the value that rendering stands for.
   */
  #sessionBaseline = signal<string | null>(null);

  protected handleEditingChange(editing: boolean) {
    if (editing && !this.innerEditing()) this.#sessionBaseline.set(this.value());
    this.innerEditing.set(editing);
  }

  /** A value as the idle display shows it: the number, formatted — the prefix renders muted in the lead. */
  #renderingOf(value: string | null) {
    if (value === null || value === '') return '';

    const { result } = this.#read(value);
    if (!result?.ok) return value;

    return this.engine()!.format(result.e164, this.displayFormat(), this.defaultCountry());
  }

  /**
   * The string channel feeding the inner control: the formatted committed
   * NUMBER while idle (its dial prefix renders muted in the lead), the raw draft
   * while a session is open. Commits round-trip the codec — `'01712345678'`
   * settles as `'+49 171 2345678'`.
   */
  protected innerValue = linkedSignal<string, string>({
    source: () => this.#renderingOf(this.canonical()),
    computation: (source, prev) => (this.innerEditing() ? (prev?.value ?? source) : source),
    // The live channel IS the setter (22.1): every raw write parses, and a
    // readable draft flows into the model synchronously — direct writes (the
    // country menu's dial-code seed) go through the same gate as keystrokes,
    // no site can forget the parse half.
    set: (raw, rawSet) => {
      rawSet(raw);

      // The baseline's rendering STANDS FOR the baseline, prefix included —
      // a settle or discard restores it rather than re-reading it prefix-less.
      // (A draft that drops the prefix down to exactly this text still
      // commits without it — `handleInnerSaved` reads the changed session.)
      const baseline = this.#sessionBaseline();
      if (this.innerEditing() && raw === this.#renderingOf(baseline)) {
        if (this.value() !== baseline) this.value.set(baseline);
        return;
      }

      const { prefix, result } = this.#read(raw);
      if (result === null) {
        if (this.canonical() !== null) this.value.set(null);
        return;
      }

      if (!result.ok) return;

      const canonical = this.#canonicalOf(prefix, result.e164);
      if (canonical !== this.canonical()) this.value.set(canonical);
    },
  });

  /**
   * A session opens on the FULL value: the idle display shows the number
   * only, so the draft gets its dial prefix back as plain text. Read from the
   * session BASELINE while editing — the inner control also measures "changed"
   * against it, and the live model may already carry a prefix the user is
   * only now typing.
   */
  protected draftText = computed(() => {
    const { prefix, result } = this.innerEditing()
      ? this.#read(this.#sessionBaseline() ?? '')
      : this.#committed();
    return prefix && result?.ok ? (number: string) => `${prefix} ${number}` : undefined;
  });

  /** The live draft, read — prefix and codec result. */
  #draft = computed(() => (this.engine() ? this.#read(this.innerValue()) : null));

  /**
   * The engine's live interpretation of the current draft's NUMBER. Public —
   * consumers render from it, possibly before the lazy engine has landed:
   * `null` then, same as an empty draft.
   */
  readonly parseResult = computed(() => this.#draft()?.result ?? null);

  /** The dial prefix of the draft while editing, of the committed value while idle. */
  readonly dialPrefix = computed(() =>
    this.innerEditing() ? (this.#draft()?.prefix ?? '') : this.#committed().prefix,
  );

  /** The muted lead prefix: idle only — while editing the prefix is draft text. */
  protected idlePrefix = computed(() => {
    if (this.innerEditing()) return '';

    const { prefix, result } = this.#committed();
    return result?.ok ? prefix : '';
  });

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
   * Passthrough only: whether the engine branch WILL show a flag, so its box
   * is reserved before the engine lands and the upgrade shifts nothing. A
   * value with a `+CC` the engine cannot read and no default country is the
   * one over-reservation — it collapses on upgrade.
   */
  protected reservesFlag = computed(
    () => this.showFlag() && (this.defaultCountry() !== undefined || !!this.value()),
  );

  /**
   * Passthrough only: what the reserved box shows. An empty field's flag IS
   * the default country's; with a value the country is the engine's call, so
   * the box stays blank rather than flash a guess.
   */
  protected pendingFlag = computed(() => {
    const country = this.defaultCountry();
    return !this.value() && country ? countryFlagEmoji(country) : '';
  });

  /**
   * The interpretation preview, rebuilt per keystroke and rendered in the
   * panel hint: language-neutral (flag, digits, ✓/⚠/… markers) so the
   * library ships no words to translate.
   */
  protected preview = computed(() => {
    const raw = this.innerValue().trim();
    if (!raw) return '';

    const { prefix, result } = this.#draft()!;
    const lead = prefix ? `${prefix} · ` : '';
    if (result?.ok) {
      const marker = result.warning ? '⚠' : '✓';
      return `${marker} ${lead}${result.international}`;
    }

    // `||`: an empty pretty-print (e.g. no digits at all) falls back to the raw draft
    const number = splitDialString(raw).number;
    const incomplete = this.engine()!.formatIncomplete?.(number, this.defaultCountry()) || number;
    return `… ${lead}${incomplete}`;
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

    // The passthrough reads this too, so it runs before the lazy engine has
    // landed — no non-null assertion here.
    const engine = this.engine();
    const country = this.defaultCountry();
    const example =
      engine && country ? engine.placeholderExample?.(country, this.numberKind()) : undefined;

    return example ?? 'phone';
  });

  /**
   * Live channel: every keystroke parses — the work lives in `innerValue`'s
   * custom `set`, so readable drafts flow into the model canonical (schema
   * validators see the canonical value mid-draft) while unreadable ones
   * hold the last good value and raise the parse gate.
   */
  protected handleInnerValue(raw: string) {
    this.innerValue.set(raw);
  }

  /** Retype the settled session: raw strings inside, the canonical value outside. */
  protected handleInnerSaved(session: InlineTextSaved) {
    // An unchanged session settles the idle RENDERING (`draftText`), which
    // has no dial prefix — the model already holds the answer.
    const { prefix, result } = session.changed ? this.#read(session.value) : this.#committed();
    // The parse gate blocks unreadable commits; the fallback covers discards
    // rolling back to a baseline the current codec cannot read.
    const value =
      result === null ? null : result.ok ? this.#canonicalOf(prefix, result.e164) : this.canonical();

    if (session.changed) {
      this.value.set(value);
      this.savedModelChange.emit({ value });
    }

    this.saved.emit({ value, changed: session.changed });
  }

  // ---------------------------------------------------------------------------
  // Country slash-menu — the picker, keyboard-first and translation-free.
  // ---------------------------------------------------------------------------

  /** Localized region names from the browser — no bundled i18n, every locale. */
  #regionNames = computed(() => this.#displayNames(this.menuLocale()));

  /** English names as a constant matching basis, so `/germany` always works. */
  #regionNamesEn = this.#displayNames('en');

  #displayNames(locale: string | string[] | undefined) {
    try {
      return new Intl.DisplayNames(locale as unknown as string[], { type: 'region' });
    } catch {
      return undefined;
    }
  }

  #nameOf(names: Intl.DisplayNames | undefined, country: PhoneCountry): string {
    try {
      return names?.of(country) ?? country;
    } catch {
      return country;
    }
  }

  /** The full country list, rebuilt when the codec or display locale changes. */
  #countries = computed(() => {
    const codec = this.engine();
    const names = this.#regionNames();
    const list = codec?.listCountries?.() ?? [];

    return list
      .map((country) => {
        const dialCode = codec?.dialCodeOf?.(country) ?? '';
        return {
          id: `ai-country-${country}`,
          country,
          name: this.#nameOf(names, country),
          // Lower-cased match keys: localized name + English name + ISO code.
          match:
            `${this.#nameOf(names, country)}\n${this.#nameOf(this.#regionNamesEn, country)}\n${country}`.toLowerCase(),
          dialCode,
          flag: countryFlagEmoji(country),
          insert: `+${dialCode} `,
        };
      })
      .filter((option) => option.dialCode)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /**
   * Options for the current query — the consumer-owned search. Matches the
   * localized name, the English name, the ISO code, and the dial code, so
   * `/deutschland`, `/germany`, `/de` and `/49` all resolve to 🇩🇪. Capped so
   * a bare `/` stays a usable list.
   */
  protected countryOptions(query: string) {
    const q = query.trim().toLowerCase();
    const all = this.#countries();
    if (!q) return all.slice(0, 60);

    const digits = q.replace(/\D/g, '');
    return all
      .filter(
        (option) =>
          option.match.includes(q) || (digits.length > 0 && option.dialCode.startsWith(digits)),
      )
      .slice(0, 60);
  }

  // ---------------------------------------------------------------------------
  // Flag country picker — the primary, mobile-first, pointer gesture. Shares
  // the option list with the slash menu; unlike it, the query lives in the
  // picker's own search field (the draft is never touched) and picking
  // preserves the national number.
  // ---------------------------------------------------------------------------
  #injector = inject(Injector);

  protected pickerSearch = viewChild<ElementRef<HTMLInputElement>>('pickerSearch');

  protected pickerOpen = signal(false);
  protected pickerOrigin = signal<Element | null>(null);
  protected pickerQuery = signal('');
  protected pickerActiveIndex = signal(0);

  protected pickerOptions = computed(() => this.countryOptions(this.pickerQuery()));
  protected pickerActiveId = computed(() => this.pickerOptions()[this.pickerActiveIndex()]?.id);

  /**
   * The picker list's DOM id — per instance, so the search combobox's
   * `aria-controls` names THIS list. Options derive their DOM ids from it via
   * `pickerOptionDomId`, the one recipe `aria-activedescendant` reads too.
   */
  protected readonly pickerListId = inject(_IdGenerator).getId('country-picker-');

  protected pickerOptionDomId(optionId: string) {
    return `${this.pickerListId}-${optionId}`;
  }

  protected pickerActiveDomId = computed(() => {
    const id = this.pickerActiveId();
    return id === undefined ? null : this.pickerOptionDomId(id);
  });

  /**
   * Below the trigger first, above as a fallback; each side also tries an
   * inline-END alignment so a picker near the inline-end screen edge flips
   * instead of overflowing. Should nothing fit (narrow viewports), the
   * template's `cdkConnectedOverlayPush` slides the picker inside the
   * viewport margin rather than leaving it clipped.
   */
  protected pickerPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

  protected openPicker(event: Event) {
    event.preventDefault();
    event.stopPropagation();

    this.pickerOrigin.set(event.currentTarget as Element);
    this.pickerQuery.set('');
    this.pickerActiveIndex.set(0);
    this.pickerOpen.set(true);

    afterNextRender(() => this.pickerSearch()?.nativeElement.focus(), { injector: this.#injector });
  }

  protected closePicker() {
    this.pickerOpen.set(false);
  }

  protected onPickerSearch(value: string) {
    this.pickerQuery.set(value);
    this.pickerActiveIndex.set(0);
  }

  protected onPickerKeydown(event: KeyboardEvent) {
    const options = this.pickerOptions();
    const last = Math.max(0, options.length - 1);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.pickerActiveIndex.update((i) => Math.min(i + 1, last));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.pickerActiveIndex.update((i) => Math.max(i - 1, 0));
        break;
      case 'Enter': {
        event.preventDefault();
        const option = options[this.pickerActiveIndex()];
        if (option) this.pickCountry(option);
        break;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.closePicker();
        break;
    }
  }

  /**
   * Applies a picked country. Preserves the national number by rebuilding
   * `+<newDial><nationalNumber>`. While editing it updates the live draft;
   * idle it commits immediately (the flag is a standalone quick-edit, like
   * the clear bubble).
   */
  protected pickCountry(option: { country: PhoneCountry; dialCode: string }) {
    const base = this.canonical();
    const { prefix, result: parsed } = this.#committed();
    const nsn = parsed?.ok ? parsed.nationalNumber : undefined;

    if (this.innerEditing()) {
      // Editing: rewrite the live draft's number, keep the session open and
      // the draft's own dial prefix in front of it.
      const draftPrefix = this.#draft()?.prefix;
      const number = nsn
        ? this.engine()!.format(`+${option.dialCode}${nsn}`, this.displayFormat(), option.country)
        : `+${option.dialCode} `;
      this.handleInnerValue(draftPrefix ? `${draftPrefix} ${number}` : number);
    } else if (nsn) {
      // Idle with a number: swap the calling code and commit immediately.
      const value = this.#canonicalOf(prefix, `+${option.dialCode}${nsn}`);
      if (value !== base) {
        this.value.set(value);
        this.savedModelChange.emit({ value });
        this.saved.emit({ value, changed: true });
      }
    } else {
      // Idle and empty: nothing to swap — open the editor seeded with the
      // calling code so the user can type the rest.
      this.innerValue.set(`+${option.dialCode} `);
      this.handleEditingChange(true);
    }

    this.closePicker();
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
