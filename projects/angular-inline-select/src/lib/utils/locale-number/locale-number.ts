/**
 * Locale numbers — `Intl.NumberFormat` both ways.
 *
 * The display groups thousands and picks the decimal mark the way the locale
 * writes them (`1,000.25` under `en`, `1.000,25` under `de`, `1 000,25` under
 * `fr`), and the parser reads that text back — grouped or not — into a plain
 * dot-decimal `number`. Standalone functions, so a consumer can format a
 * total in a footer or read a pasted figure with the same rules the inline
 * number control applies; {@link makeLocaleNumberCodec} bundles them into the
 * control's `parse`/`format` pair.
 *
 * Two deliberate choices:
 *
 * - **Widest precision by default.** `Intl` rounds to three fraction digits
 *   unless told otherwise. Inside an editable, a formatter that rounds would
 *   seed the editor with a rounded draft and the next save would write the
 *   rounding back into the model — a display concern silently changing data.
 *   So `maximumFractionDigits` defaults to the maximum; narrow it on purpose
 *   (`{ minimumFractionDigits: 2, maximumFractionDigits: 2 }` for money).
 * - **Grouping must LOOK like grouping.** The locale fixes each mark's role,
 *   so `1.000` under `de` is a thousand — but `1.5` under `de` is NOT fifteen:
 *   a group that is not three digits wide (two, in the locales that group
 *   that way) is rejected as unparseable rather than read as a group. A
 *   keyboard that emits the wrong mark gets a visible error instead of a
 *   silent ×10.
 *
 * Latin digits are pinned (`numberingSystem: 'latn'`), so display and draft
 * agree on the glyphs the parser reads. A `locale` left `undefined` takes the
 * runtime's default locale, as `Intl` itself does.
 */

/**
 * The `Intl.NumberFormat` options a locale number passes through — the
 * plain-decimal subset on purpose. `style: 'currency' | 'percent' | 'unit'`
 * would put text into the display that the parser then has to strip again;
 * in the inline controls, units belong in the affix templates, outside the
 * draft.
 */
export type LocaleNumberOptions = Pick<
  Intl.NumberFormatOptions,
  | 'useGrouping'
  | 'minimumIntegerDigits'
  | 'minimumFractionDigits'
  | 'maximumFractionDigits'
  | 'signDisplay'
>;

/** The characters a locale writes numbers with. */
export interface LocaleNumberSeparators {
  /** Thousands mark — `','`, `'.'`, a (narrow no-break) space, `'’'`; `''` if the locale has none. */
  group: string;
  /** Decimal mark — `'.'` or `','`. */
  decimal: string;
  /** The minus the locale renders — `'-'`, or U+2212 in some. */
  minus: string;
}

/** A locale codec: the two halves plus the separators they were resolved from. */
export interface LocaleNumberCodec {
  parse: (raw: string) => number | null | undefined;
  format: (value: number | null | undefined) => string;
  separators: LocaleNumberSeparators;
}

/**
 * Every space-like grouping character `Intl` emits somewhere (fr, sv, …):
 * plain space, no-break, narrow no-break, thin. A keyboard produces the plain
 * one, `Intl` a narrow no-break one — a parser that told them apart would
 * reject the locale's own display text after a single edit, so a space-like
 * group reads as ALL of them.
 */
const SPACE_GROUPS = String.fromCharCode(0x0020, 0x00a0, 0x202f, 0x2009);

/** Unicode minus — what some locales render, and what no keyboard types. */
const UNICODE_MINUS = String.fromCharCode(0x2212);

/** Escapes characters for use inside a regex character class. */
function escapeForClass(chars: string): string {
  return chars.replace(/[\\\]^-]/g, '\\$&');
}

/** A space-like group stands for the whole space-like family. */
function groupFamily(group: string): string {
  return SPACE_GROUPS.includes(group) ? SPACE_GROUPS : group;
}

function cacheKey(locale: string | string[] | undefined, options?: LocaleNumberOptions): string {
  return JSON.stringify([locale ?? null, options ?? null]);
}

// -----------------------------------------------------------------------------
// Separators — probed once per locale
// -----------------------------------------------------------------------------

interface LocaleShape extends LocaleNumberSeparators {
  /** The strict draft shape: optional sign, grouped-or-plain integer, optional fraction. */
  shape: RegExp;
  /** Strips every group mark before `Number()`; `null` when the locale has none. */
  stripGroups: RegExp | null;
}

const shapes = new Map<string, LocaleShape>();

function localeShape(locale?: string | string[]): LocaleShape {
  const key = cacheKey(locale);
  const cached = shapes.get(key);
  if (cached) return cached;

  // A PLAIN probe: the consumer's format options (`useGrouping: false`) must
  // not hide the separators a parser still has to accept.
  const parts = new Intl.NumberFormat(locale, { numberingSystem: 'latn' }).formatToParts(
    -1234567.89,
  );
  const partValue = (type: Intl.NumberFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  const group = partValue('group');
  const decimal = partValue('decimal') || '.';
  const minus = partValue('minusSign') || '-';

  // Group width: three, or two-or-three where the locale groups that way (en-IN).
  const groupWidths = new Set(
    parts
      .filter((part) => part.type === 'integer')
      .slice(1)
      .map((part) => part.value.length),
  );
  const groupDigits = groupWidths.has(2) ? '\\d{2,3}' : '\\d{3}';

  const groupClass = group === '' ? null : `[${escapeForClass(groupFamily(group))}]`;
  const decimalClass = `[${escapeForClass(decimal)}]`;

  const grouped = groupClass ? `\\d{1,3}(?:${groupClass}${groupDigits})+|` : '';
  const shape = new RegExp(
    `^[+-]?(?:${grouped}\\d+)(?:${decimalClass}\\d*)?$|^[+-]?${decimalClass}\\d+$`,
  );

  const resolved: LocaleShape = {
    group,
    decimal,
    minus,
    shape,
    stripGroups: groupClass ? new RegExp(groupClass, 'g') : null,
  };
  shapes.set(key, resolved);
  return resolved;
}

/**
 * The characters `locale` writes numbers with — the thousands mark, the
 * decimal mark, and the minus it renders. Probed from `Intl` once per locale.
 */
export function localeNumberSeparators(locale?: string | string[]): LocaleNumberSeparators {
  const { group, decimal, minus } = localeShape(locale);
  return { group, decimal, minus };
}

// -----------------------------------------------------------------------------
// Format
// -----------------------------------------------------------------------------

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(locale?: string | string[], options?: LocaleNumberOptions) {
  const key = cacheKey(locale, options);
  const cached = formatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat(locale, {
    numberingSystem: 'latn',
    maximumFractionDigits: 20,
    ...options,
  });
  formatters.set(key, formatter);
  return formatter;
}

/**
 * Formats a number the way `locale` writes it: `1,000.25` under `en`,
 * `1.000,25` under `de`. `null`/`undefined` format as `''`. Precision is the
 * widest unless `options` narrow it — see the module note on why.
 */
export function formatLocaleNumber(
  value: number | null | undefined,
  locale?: string | string[],
  options?: LocaleNumberOptions,
): string {
  if (value === null || value === undefined) return '';
  return formatterFor(locale, options).format(value);
}

// -----------------------------------------------------------------------------
// Parse
// -----------------------------------------------------------------------------

/**
 * Reads a number written the way `locale` writes it — grouped or not — into
 * a dot-decimal `number`. `''` reads as `null` (empty); text that is not a
 * number under that locale reads as `undefined` (unparseable), which is the
 * inline number control's parse-gate convention.
 *
 * The locale fixes each mark's role, so `'1.000'` is a thousand under `de`
 * and one under `en`. A mark in a position that is not a group (`'1.5'`
 * under `de`) is unparseable rather than a silent ×10; the locale's own
 * display text always reads back.
 */
export function parseLocaleNumber(
  raw: string,
  locale?: string | string[],
): number | null | undefined {
  const { shape, stripGroups, decimal, minus } = localeShape(locale);

  // The locale's minus, the Unicode minus and the keyboard's hyphen are one.
  const trimmed = raw.trim().replace(minus, '-').replace(UNICODE_MINUS, '-');
  if (trimmed === '') return null;
  if (!shape.test(trimmed)) return undefined;

  const canonical = (stripGroups ? trimmed.replace(stripGroups, '') : trimmed).replace(
    decimal,
    '.',
  );
  const parsed = Number(canonical);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// -----------------------------------------------------------------------------
// Codec — the pair the inline number control binds
// -----------------------------------------------------------------------------

/**
 * Bundles {@link parseLocaleNumber} and {@link formatLocaleNumber} for one
 * locale into the `parse`/`format` pair the inline number control takes —
 * what its `locale` input builds internally, exported for consumers who
 * compose their own control or want the pair elsewhere.
 */
export function makeLocaleNumberCodec(
  locale?: string | string[],
  options?: LocaleNumberOptions,
): LocaleNumberCodec {
  return {
    separators: localeNumberSeparators(locale),
    format: (value) => formatLocaleNumber(value, locale, options),
    parse: (raw) => parseLocaleNumber(raw, locale),
  };
}

/**
 * A per-character filter admitting everything a number under `locale` can
 * contain: digits, sign, BOTH generic decimal marks, and the locale's own
 * group, decimal and minus characters. A superset of the parser, never a
 * mirror of it — the inline number control's `restrictInput` uses it so no
 * keyboard ends up with a dead decimal key.
 */
export function localeNumberChars(locale?: string | string[]): RegExp {
  const { group, decimal, minus } = localeShape(locale);
  return new RegExp(`[0-9+.,\\-${escapeForClass(groupFamily(group) + decimal + minus)}]`);
}
