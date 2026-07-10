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
  afterNextRender,
  ElementRef,
  Injector,
  inject,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { OverlayModule, type ConnectedPosition } from '@angular/cdk/overlay';
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
  imports: [AngularInlineText, OverlayModule, NgTemplateOutlet],
  templateUrl: './angular-inline-phone.html',
  styles: `
    :host { display: inline; }
    .country-name { flex: 1 1 auto; }
    .country-dial { color: var(--mat-sys-on-surface-variant, #5f6368); font-variant-numeric: tabular-nums; }
    .country-empty {
      padding: calc(var(--mat-sys-inner-spacing, 16px) / 4) calc(var(--mat-sys-inner-spacing, 16px) / 2);
      color: var(--mat-sys-on-surface-variant, #5f6368);
    }

    .country-trigger {
      font: inherit;
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
    .country-picker__list [role='option'][data-active='true'] {
      background: var(--mat-sys-secondary-container, #d7e3ff);
      color: var(--mat-sys-on-secondary-container, #001b3f);
    }
  `,
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

  /** Form Value Contract: touch — forwarded from the inner control. */
  touch = output<void>();

  /**
   * THE consumer commit event — fires once per changed settlement with the
   * MODEL: `{ value }`, always E.164 or `null` inside, never raw input.
   */
  savedModelChange = output<{ value: string | null }>();

  /**
   * The MACHINERY channel: exactly one emission per settled edit session
   * (Save, Discard, clear — changed or not). Adapters/wrappers bind this;
   * app consumers should bind `savedModelChange`.
   */
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
    const codec = this.codec();
    const names = this.#regionNames();
    const list = codec.listCountries?.() ?? [];

    return list
      .map((country) => {
        const dialCode = codec.dialCodeOf?.(country) ?? '';
        return {
          id: `ai-country-${country}`,
          country,
          name: this.#nameOf(names, country),
          // Lower-cased match keys: localized name + English name + ISO code.
          match: `${this.#nameOf(names, country)}\n${this.#nameOf(this.#regionNamesEn, country)}\n${country}`.toLowerCase(),
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
          option.match.includes(q) ||
          (digits.length > 0 && option.dialCode.startsWith(digits)),
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

  protected pickerPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
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
    const parsed = base ? this.codec().parse(base, this.defaultCountry()) : null;
    const nsn = parsed?.ok ? parsed.nationalNumber : undefined;

    if (this.innerEditing()) {
      // Editing: rewrite the live draft, keep the session open.
      const draft = nsn
        ? this.codec().format(`+${option.dialCode}${nsn}`, this.displayFormat(), option.country)
        : `+${option.dialCode} `;
      this.handleInnerValue(draft);
    } else if (nsn) {
      // Idle with a number: swap the calling code and commit immediately.
      const e164 = `+${option.dialCode}${nsn}`;
      if (e164 !== base) {
        this.value.set(e164);
        this.savedModelChange.emit({ value: e164 });
        this.saved.emit({ value: e164, changed: true });
      }
    } else {
      // Idle and empty: nothing to swap — open the editor seeded with the
      // calling code so the user can type the rest.
      this.innerValue.set(`+${option.dialCode} `);
      this.innerEditing.set(true);
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
