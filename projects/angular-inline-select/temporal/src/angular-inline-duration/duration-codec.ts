/**
 * Duration codec — the value is SECONDS (`number | null`), display is a
 * clock-style string. Same contract shape as the number codec: `''` → `null`
 * (empty), unparseable → `undefined` (raises the parse gate).
 */

import { Duration } from 'luxon';

/** How colon notation reads and how values render. */
export type DurationFormat = 'h:mm' | 'h:mm:ss' | 'mm:ss';

/**
 * The `savedModelChange` payload — the duration MODEL (iusta's house shape):
 * total seconds plus the clock decomposition, numeric and zero-padded.
 * Consumers read `.duration`. An empty/cleared field reports zero.
 */
export interface DurationSavedDetails {
  duration: number;
  hour: number;
  minute: number;
  second: number;
  hourString: string;
  minuteString: string;
  secondString: string;
}

/** The clock decomposition of a second count (iusta's house helper, verbatim). */
export function timeDetailsFromSeconds(durationInSeconds: number) {
  const duration = Duration.fromObject({ seconds: durationInSeconds }).shiftTo(
    'hours',
    'minutes',
    'seconds',
  );

  return {
    hour: duration.hours,
    minute: duration.minutes,
    second: duration.seconds,
    hourString: duration.hours.toString().padStart(2, '0'),
    minuteString: duration.minutes.toString().padStart(2, '0'),
    secondString: duration.seconds.toString().padStart(2, '0'),
  };
}

const UNIT_SECONDS: Record<string, number> = {
  h: 3600,
  m: 60,
  s: 1,
};

/**
 * Parses a duration draft into seconds.
 *
 * Accepted shapes:
 * - Colon notation, positional by `format`: `'1:30'` is 1 h 30 min under
 *   `h:mm`, but 1 min 30 s under `mm:ss`. Positions after the first must be
 *   valid sexagesimal (0–59).
 * - Unit tokens, format-independent: `'1h 30m'`, `'45m'`, `'90s'`, `'1.5h'`.
 * - A bare number: minutes under hour-based formats, seconds under `mm:ss`.
 */
export function parseDuration(raw: string, format: DurationFormat = 'h:mm'): number | null | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '') return null;

  // Unit tokens: "1h 30m", "45m", "1.5h", "90s"
  if (/^(\d+(?:\.\d+)?\s*[hms]\s*)+$/.test(trimmed)) {
    let seconds = 0;
    for (const [, amount, unit] of trimmed.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/g)) {
      seconds += Number(amount) * UNIT_SECONDS[unit];
    }
    return Math.round(seconds);
  }

  // Colon notation: positional by format
  if (/^\d+(?::\d{1,2})+$/.test(trimmed)) {
    const parts = trimmed.split(':').map(Number);
    if (parts.slice(1).some((part) => part > 59)) return undefined;

    if (format === 'mm:ss') {
      if (parts.length !== 2) return undefined;
      return parts[0] * 60 + parts[1];
    }

    if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return undefined;
  }

  // Bare number: minutes for hour-based formats, seconds for mm:ss
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const amount = Number(trimmed);
    return Math.round(format === 'mm:ss' ? amount : amount * 60);
  }

  return undefined;
}

/** Renders seconds in the given clock format (`null` → `''`). */
export function formatDuration(seconds: number | null, format: DurationFormat = 'h:mm'): string {
  if (seconds === null) return '';

  const pad = (value: number) => String(value).padStart(2, '0');

  if (format === 'mm:ss') {
    return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (format === 'h:mm:ss') return `${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}`;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** Human reading for the live interpretation preview: `'1 h 30 min'`. */
export function describeDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  const parts: string[] = [];
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (rest || parts.length === 0) parts.push(`${rest} s`);

  return parts.join(' ');
}
