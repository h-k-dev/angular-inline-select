/**
 * Dial strings: a phone value MAY lead with keypad codes a PBX or the network
 * reads before the number — `#0 ` (outside line), `*31#` / `#31#` (show / hide
 * caller ID). RFC 3966 §1 keeps such dial strings out of the number itself, so
 * the codec never sees them: the prefix is split off, the rest is the number.
 */

/** A phone value as prefix + number. `prefix` is `''` when there is none. */
export interface DialString {
  /** Keypad codes dialled first, space-separated (`'#0'`, `'*31# #0'`). */
  prefix: string;
  /** Everything after the prefix — what the codec parses. */
  number: string;
}

/**
 * The leading prefix tokens — the legacy (mgtz) accept-set, kept narrow:
 * - GSM/USSD codes, any number of them: `*31#`, `#31#`, `*#21#` — each closed
 *   by its own `#`;
 * - ONE PBX code: `#` + up to three digits, followed by whitespace (`#0 `).
 *   A second one is not a prefix (the backend indexer drops only one).
 *
 * The PBX code NEEDS its space: `#00049 30 …` is ambiguous (`#0` + `0049`, or
 * `#00` + `049`?), so it splits nothing and the parse gate asks for the space.
 */
const USSD_CODE = /^(?:[*#]{1,3}\d+)+#\s*/;
const PBX_CODE = /^#\d{1,3}(?=\s)\s*/;

/** Splits the leading dial prefix off a raw phone value. */
export function splitDialString(raw: string): DialString {
  let number = raw.trim();
  let pbx = false;
  const tokens: string[] = [];

  for (;;) {
    const ussd = USSD_CODE.exec(number);
    const match = ussd ?? (pbx ? null : PBX_CODE.exec(number));
    if (!match) break;

    pbx ||= !ussd;
    tokens.push(match[0].trim());
    number = number.slice(match[0].length);
  }

  return { prefix: tokens.join(' '), number };
}

/**
 * The stored form of a prefixed number: `<prefix> 00<CC> <groups>`.
 *
 * Never `<prefix> +…`: the backend's search indexer drops the `+` after a
 * prefix and re-reads the digits as a German national number
 * (`#0 +4312345678` → `+494312345678`). The `00` form indexes correctly — and
 * is what a PBX dials after its outside-line code anyway.
 */
export function joinDialString(prefix: string, international: string): string {
  return `${prefix} ${international.replace(/^\+/, '00')}`;
}

/**
 * A `tel:` href for a stored value. `#` is the URI fragment delimiter
 * (RFC 3986 §3.5) — left raw, the browser files the whole number under the
 * fragment and the dialer receives an empty `tel:`. Escaped as `%23` it stays
 * in the path; `*` needs no escaping.
 */
export function telHref(value: string): string {
  return `tel:${value.replace(/#/g, '%23')}`;
}
