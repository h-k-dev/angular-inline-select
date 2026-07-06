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
  parseDateInput,
  formatIsoDate,
  describeIsoDate,
  buildDateCommands,
  type IsoDate,
} from './date-codec';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineDateSaved {
  /** The value the session settled on — ISO `'yyyy-MM-dd'`, or `null` for empty. */
  value: IsoDate | null;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * Inline date: a `FormValueControl` for calendar dates that COMPOSES the
 * inline text control. Canonical value: ISO `'yyyy-MM-dd' | null` — the
 * date analogue of the phone control's E.164 (serializable, locale-free);
 * consumers needing Luxon/Date objects convert at their boundary.
 *
 * - Drafts are TYPED (`'12.5.'`, `'12.5.2026'`, `'2026-05-12'`) and never
 *   reformatted under the caret; the live interpretation preview shows the
 *   full reading on every keystroke (`✓ Tuesday, 12 May 2026`).
 * - The slash menu is the quick-pick: `/today`, `/tomorrow`, `/yesterday`
 *   and the next seven weekdays — labels localized via `Intl` (zero bundled
 *   translations), matching the localized AND English names.
 * - A calendar overlay picker is the natural next affordance (same pattern
 *   as the phone's flag picker) — deliberately left open for sandboxing.
 */
@Component({
  selector: 'angular-inline-date',
  imports: [AngularInlineText],
  templateUrl: './angular-inline-date.html',
  styles: `
    :host { display: inline; }
    .date-command__label { flex: 1 1 auto; text-transform: capitalize; }
    .date-command__value { color: var(--mat-sys-on-surface-variant, #5f6368); font-variant-numeric: tabular-nums; }
    .date-command__empty { padding: 4px 8px; color: var(--mat-sys-on-surface-variant, #5f6368); }
  `,
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineDate implements FormValueControl<IsoDate | null> {
  /** The composed text control — all session machinery lives there. */
  protected inner = viewChild.required(AngularInlineText);

  /** The committed value channel: ISO `'yyyy-MM-dd'`, or `null`. */
  value = model<IsoDate | null>(null);

  /** Form Value Contract — forwarded into the inner control. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  placeholder = input<string>('date');

  /** Accessible name for the field (contenteditable has no native label association). */
  ariaLabel = input<string | undefined>(undefined);

  /** Locale for display + command labels (`Intl`); browser default when omitted. */
  locale = input<string | string[] | undefined>(undefined);

  /** Enables the `/today`-style slash menu. */
  showDateMenu = input(true);

  /** Reference clock — injectable for tests; a fresh `Date` per read otherwise. */
  now = input<() => Date>(() => new Date());

  /** Affix template passthrough (composition channel + content sugar). */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected suffixTpl = computed(() => this.suffixTemplate() ?? this.contentSuffix()?.templateRef);

  /** Form Value Contract: touch — forwarded from the inner control. */
  touch = output<void>();

  /** Hard commit event: fires once per accepted edit session — ISO or `null`. */
  savedModelChange = output<IsoDate | null>();

  /** Emitted exactly once per settled edit session (Save, Discard, clear). */
  saved = output<InlineDateSaved>();

  /** Whether an edit session is open. Two-way bindable. */
  editing = model(false);

  /**
   * The string channel feeding the inner control: the localized committed
   * date while idle, the raw draft while a session is open.
   */
  protected innerValue = linkedSignal<string, string>({
    source: () => formatIsoDate(this.value(), this.locale()),
    computation: (source, prev) => (this.editing() ? (prev?.value ?? source) : source),
  });

  /** The current draft's ISO reading (`null` empty, `undefined` unreadable). */
  readonly parsedDraft = computed(() => parseDateInput(this.innerValue(), this.now()()));

  /** The parse gate: whether the current draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(() => this.parsedDraft() === undefined);

  /** Errors forwarded inward: contract errors + the synthetic parse gate. */
  protected innerErrors = computed<readonly ValidationError.WithOptionalFieldTree[]>(() =>
    this.parseFailed() ? [...this.errors(), { kind: 'parse' }] : this.errors(),
  );

  /** Live interpretation preview: `✓ Tuesday, 12 May 2026` / `… raw`. */
  protected preview = computed(() => {
    const raw = this.innerValue().trim();
    if (!raw) return '';

    const iso = this.parsedDraft();
    if (iso === null || iso === undefined) return `… ${raw}`;

    return `✓ ${describeIsoDate(iso, this.locale())}`;
  });

  /** The slash-menu commands, rebuilt per read so "today" is always today. */
  protected dateCommands = computed(() => buildDateCommands(this.now()(), this.locale()));

  protected commandOptions(query: string) {
    const q = query.trim().toLowerCase();
    const all = this.dateCommands();
    if (!q) return all;

    return all.filter((command) => command.match.includes(q));
  }

  /** Live channel: readable drafts flow into the model as ISO dates. */
  protected handleInnerValue(raw: string) {
    this.innerValue.set(raw);

    const iso = parseDateInput(raw, this.now()());
    if (iso !== undefined && iso !== this.value()) this.value.set(iso);
  }

  /** Retype the settled session: strings inside, ISO dates outside. */
  protected handleInnerSaved(session: InlineTextSaved) {
    const iso = parseDateInput(session.value, this.now()());
    const value = iso === undefined ? this.value() : iso;

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
