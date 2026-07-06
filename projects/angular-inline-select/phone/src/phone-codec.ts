/**
 * The phone engine contract. `angular-inline-phone` consumes this interface
 * and never imports a phone library directly — swap the engine (custom
 * metadata subset, a different port, a server API) without touching the UI.
 */

/** ISO 3166-1 alpha-2 country code, e.g. 'DE'. */
export type PhoneCountry = string;

export type PhoneNumberKind = 'mobile' | 'fixed-or-mobile';

/**
 * Structural failures — the engine could not produce a number at all.
 * These gate the commit (there is nothing reliable to save).
 */
export type PhoneParseReason = 'not-a-number' | 'invalid-country' | 'too-short' | 'too-long';

/**
 * Soft findings — an E.164 exists and MAY be committed, but the number is
 * suspicious. Surfaced as warnings, never commit blockers (production
 * lesson: a "too short" number is sometimes a weird-but-real local number).
 */
export type PhoneParseWarning = 'too-short' | 'too-long' | 'invalid-length' | 'unrecognized';

export interface PhoneParseSuccess {
  ok: true;
  /** The canonical value: E.164 (`'+491712345678'`). */
  e164: string;
  country?: PhoneCountry;
  /** Country calling code without the `+`, e.g. `'49'`. */
  dialCode?: string;
  national: string;
  international: string;
  warning?: PhoneParseWarning;
}

export interface PhoneParseFailure {
  ok: false;
  reason: PhoneParseReason;
}

export type PhoneParseResult = PhoneParseSuccess | PhoneParseFailure;

export interface PhoneCodec {
  /** Full interpretation of raw input. Returns `null` for empty input. */
  parse(raw: string, defaultCountry?: PhoneCountry): PhoneParseResult | null;

  /** Formats a committed value for display. Returns the input unchanged when it cannot be read. */
  format(value: string, style: 'national' | 'international', defaultCountry?: PhoneCountry): string;

  /**
   * Best-effort pretty-print of an incomplete draft — used for the live
   * interpretation preview, NEVER applied to the draft itself.
   */
  formatIncomplete?(raw: string, defaultCountry?: PhoneCountry): string;

  /** A real example number in national format, for placeholder use. */
  placeholderExample?(country: PhoneCountry, kind: PhoneNumberKind): string | undefined;
}

/**
 * Flag emoji for an ISO country code — two regional-indicator code points.
 * No sprites, no stylesheets, nothing that can break.
 */
export function countryFlagEmoji(country: PhoneCountry): string {
  const code = country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';

  return String.fromCodePoint(...[...code].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}
