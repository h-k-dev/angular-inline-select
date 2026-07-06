/**
 * Time codec — the canonical value is a 24 h wall-clock string
 * (`'HH:mm' | null`): locale/timezone-free, the time analogue of the date
 * control's ISO string. Display localizes through `Intl`.
 */

/** `'HH:mm'`. */
export type WallClockTime = string;

const pad = (value: number) => String(value).padStart(2, '0');

function timeIfValid(hours: number, minutes: number): WallClockTime | undefined {
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;
  return `${pad(hours)}:${pad(minutes)}`;
}

/**
 * Parses a time draft into `'HH:mm'`. `''` → `null`, non-times → `undefined`
 * (raises the parse gate).
 *
 * Accepted shapes: `'9'` → 09:00, `'21'` → 21:00, `'930'`/`'0930'` → 09:30,
 * `'2105'` → 21:05, `'9:30'`, `'09.30'`.
 */
export function parseTime(raw: string): WallClockTime | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Separated: H:mm / H.mm
  let match = /^(\d{1,2})[:.](\d{2})$/.exec(trimmed);
  if (match) return timeIfValid(Number(match[1]), Number(match[2]));

  // Compact digits: H / HH / Hmm / HHmm
  if (/^\d{1,4}$/.test(trimmed)) {
    if (trimmed.length <= 2) return timeIfValid(Number(trimmed), 0);

    const minutes = Number(trimmed.slice(-2));
    const hours = Number(trimmed.slice(0, -2));
    return timeIfValid(hours, minutes);
  }

  return undefined;
}

/** Localized display (`'9:30 AM'` under `en`, `'09:30'` under `de`). */
export function formatWallClock(time: WallClockTime | null, locale?: string | string[]): string {
  if (time === null) return '';

  const [hours, minutes] = time.split(':').map(Number);
  try {
    return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(
      new Date(2000, 0, 1, hours, minutes),
    );
  } catch {
    return time;
  }
}
