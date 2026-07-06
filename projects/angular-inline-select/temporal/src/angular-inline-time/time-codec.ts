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
 * A parsed time draft: the wall-clock time plus the DAY OVERFLOW typed as
 * hours beyond 23 — `'24:30'` → `{ time: '00:30', days: 1 }`, `'240:30'` →
 * `{ time: '00:30', days: 10 }`. Plain times carry `days: 0`.
 */
export interface TimeDraft {
  time: WallClockTime;
  days: number;
}

function draftIfValid(hours: number, minutes: number): TimeDraft | undefined {
  if (hours < 0 || minutes < 0 || minutes > 59) return undefined;

  const time = timeIfValid(hours % 24, minutes);
  return time === undefined ? undefined : { time, days: Math.floor(hours / 24) };
}

/**
 * Parses a time draft into `{ time, days }`. `''` → `null`, non-times →
 * `undefined` (raises the parse gate).
 *
 * Accepted shapes: `'9'` → 09:00, `'21'` → 21:00, `'930'`/`'0930'` → 09:30,
 * `'2105'` → 21:05, `'9:30'`, `'09.30'` — and OVERFLOW hours declaring the
 * day over-count by hand: `'24:30'`/`'2430'` → next day 00:30,
 * `'240:30'` → +10 days 00:30. Bare 1–2 digit hours stay strict (`'99'` is
 * a typo, not four days).
 */
export function parseTimeDraft(raw: string): TimeDraft | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Separated: H:mm / H.mm — hours may overflow into days (up to 3 digits).
  let match = /^(\d{1,3})[:.](\d{2})$/.exec(trimmed);
  if (match) return draftIfValid(Number(match[1]), Number(match[2]));

  // Compact digits: H / HH / Hmm / HHmm
  if (/^\d{1,4}$/.test(trimmed)) {
    if (trimmed.length <= 2) {
      const time = timeIfValid(Number(trimmed), 0);
      return time === undefined ? undefined : { time, days: 0 };
    }

    return draftIfValid(Number(trimmed.slice(0, -2)), Number(trimmed.slice(-2)));
  }

  return undefined;
}

/**
 * Overflow-free convenience over `parseTimeDraft`: plain `'HH:mm'` or the
 * parse gate — overflow drafts are UNDEFINED here (callers that can't
 * carry the day over-count must reject them).
 */
export function parseTime(raw: string): WallClockTime | null | undefined {
  const draft = parseTimeDraft(raw);
  if (draft === null || draft === undefined) return draft;

  return draft.days === 0 ? draft.time : undefined;
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
