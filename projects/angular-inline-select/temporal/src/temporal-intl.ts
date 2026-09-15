import { Injectable, signal } from '@angular/core';

import {
  datePlaceholderTokens as builtinDatePlaceholderTokens,
  type DatePlaceholderTokens,
} from './angular-inline-date/date-codec';
import type { SideKey } from './side-session';

/**
 * The temporal controls' localizable CHROME — every fixed UI string a date,
 * time or calendar speaks that isn't itself a date value. Date values keep
 * localizing through `Intl` at the codec boundary (zero bundled translations);
 * this class is only for the surrounding affordance labels and announcements,
 * which `Intl` can't reach.
 *
 * One `providedIn: 'root'` override point, signal-backed so a runtime locale
 * switch re-renders every consumer. This is the `MatDatepickerIntl` pattern,
 * deliberately NOT Angular `$localize`: a distributable library that ships
 * `i18n`-marked templates forces every consumer to extract and merge ITS
 * message IDs into their own catalog, and fights runtime locale switching.
 * A consumer localizes the whole surface by providing a subclass:
 *
 *     { provide: TemporalIntl, useClass: GermanTemporalIntl }
 *
 * and wiring the string signals to whatever i18n backend they already run
 * (transloco, ngx-translate, `$localize`, or plain constants). The
 * word-order-sensitive strings are METHODS so an override can restructure
 * them, not merely swap tokens into an English frame.
 */
@Injectable({ providedIn: 'root' })
export class TemporalIntl {
  /** Calendar month-navigation buttons. */
  readonly prevMonthLabel = signal('Previous month');
  readonly nextMonthLabel = signal('Next month');
  /** The same buttons in the month view, which pages a year at a time. */
  readonly prevYearLabel = signal('Previous year');
  readonly nextYearLabel = signal('Next year');

  /** The header button's description: it zooms out to the year grid… */
  readonly chooseYearLabel = signal('Choose year');
  /** …and, from the year grid, back to the days. */
  readonly chooseDateLabel = signal('Choose date');

  /** The year view's paging buttons — methods so the count can move in the sentence. */
  prevYearsLabel(count: number): string {
    return `Previous ${count} years`;
  }

  nextYearsLabel(count: number): string {
    return `Next ${count} years`;
  }

  /** The 📅 affordance that opens the calendar panel. */
  readonly openCalendarLabel = signal('Open calendar');

  /** The quick-pick command group. */
  readonly quickPicksLabel = signal('Quick picks');

  /** Default accessible names, used when the consumer sets no `ariaLabel`. */
  readonly dateLabel = signal('Date');
  readonly timeLabel = signal('Time');
  /** Names the duration field in its clear-button label (no `ariaLabel` default). */
  readonly durationLabel = signal('Duration');

  /** The side words a ranged field appends to each input's accessible name. */
  readonly rangeStartLabel = signal('start');
  readonly rangeEndLabel = signal('end');

  /** The value a cleared field snaps back to, named in the revert announcement. */
  readonly emptyLabel = signal('empty');

  #sideWord(side: SideKey): string {
    return side === 'start' ? this.rangeStartLabel() : this.rangeEndLabel();
  }

  /** Ranged fields suffix the side onto the accessible name. */
  fieldLabel(base: string, side: SideKey, ranged: boolean): string {
    return ranged ? `${base} ${this.#sideWord(side)}` : base;
  }

  /**
   * The clear-button accessible name (`'single'` → no side word) — spoken by
   * the stock button AND handed to a consumer's own affordance through the
   * `editableClear` template context, so a custom clear button stays
   * localized for free.
   *
   * `noun` is the field being cleared, lower-cased by the caller's convention
   * (each control passes its own — "date", "time", "duration"); it defaults
   * to the date noun for callers that predate the parameter.
   */
  clearLabel(side: SideKey | 'single', noun: string = this.dateLabel().toLowerCase()): string {
    return side === 'single' ? `Clear ${noun}` : `Clear ${this.#sideWord(side)} ${noun}`;
  }

  /**
   * The letters the date field's typing hint spells its parts with, for the
   * locale the field renders in (`tt.mm.jjjj` in German). Field ORDER and
   * separators still come from `Intl` — only the letters are words in a
   * language, which no `Intl` surface exposes. The built-in table covers
   * the common locales; override for one it doesn't know, or to change the
   * casing:
   *
   *     datePlaceholderTokens() {
   *       return { day: 'T', month: 'M', year: 'J' };
   *     }
   */
  datePlaceholderTokens(locale?: string | string[]): DatePlaceholderTokens {
    return builtinDatePlaceholderTokens(locale);
  }

  /** The snap-back announcement; `''` restored → the empty word. */
  revertedLabel(restored: string): string {
    return `Reverted to ${restored === '' ? this.emptyLabel() : restored}`;
  }
}
