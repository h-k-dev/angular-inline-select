import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,

  // Signals
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

import { DateTime } from 'luxon';

import { toIsoDate, formatIsoDate, type IsoDate } from '../date-codec';
import { todayIn } from '../../datetime/db-entry';
import { TemporalIntl } from '../../temporal-intl';

interface CalendarDay {
  iso: IsoDate;
  day: number;
  outside: boolean;
  today: boolean;
}

/** A year or month cell in the zoomed-out views. */
interface CalendarPeriod {
  value: number;
  label: string;
  aria: string;
  today: boolean;
  selected: boolean;
}

/** Day grid, the month grid of one year, or a page of years. */
export type CalendarView = 'day' | 'month' | 'year';

/** One year-view page: 4 × 5 cells, aligned to multiples of 20 (1960–1979). */
const YEARS_PER_PAGE = 20;
/** The year and month grids share one column count (4 × 5 years, 4 × 3 months). */
const PERIOD_COLUMNS = 4;

/** Distinct id per instance — the grid's `aria-labelledby` target. */
let nextCalendarId = 0;

const ISO_DAY = 'yyyy-MM-dd';

function parts(iso: IsoDate): [number, number, number] {
  const [year, month, day] = iso.split('-').map(Number);
  return [year, month, day];
}

function shiftDay(iso: IsoDate, days: number): IsoDate {
  return DateTime.fromISO(iso).plus({ days }).toFormat(ISO_DAY);
}

// Luxon clamps month arithmetic natively (Jan 31 + 1 month = Feb 28/29).
function shiftMonth(iso: IsoDate, months: number): IsoDate {
  return DateTime.fromISO(iso).plus({ months }).toFormat(ISO_DAY);
}

function shiftYear(iso: IsoDate, years: number): IsoDate {
  return DateTime.fromISO(iso).plus({ years }).toFormat(ISO_DAY);
}

/** The same day in another year/month, clamped to its length (Feb 29 → Feb 28). */
function withYearMonth(iso: IsoDate, year: number, month: number): IsoDate {
  const [, , day] = parts(iso);
  const first = DateTime.local(year, month, 1);

  return first.set({ day: Math.min(day, first.daysInMonth ?? 28) }).toFormat(ISO_DAY);
}

/** First year of the page holding `year` — floor-aligned, so BCE-safe too. */
function yearPageStart(year: number): number {
  return year - (((year % YEARS_PER_PAGE) + YEARS_PER_PAGE) % YEARS_PER_PAGE);
}

/** Locale-correct first day of week: JS convention (0 = Sunday). */
function firstDayOfWeek(locale: string | string[] | undefined): number {
  try {
    const tag = Array.isArray(locale) ? locale[0] : locale;
    const intlLocale = new Intl.Locale(tag ?? navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo;

    return (info?.firstDay ?? 1) % 7; // Intl: 1=Mon…7=Sun → JS: 0=Sun
  } catch {
    return 1;
  }
}

/**
 * The calendar grid — the pointer affordance behind the date control's 📅
 * affix and its open-on-edit popup. HAND-ROLLED APG grid pattern (roving
 * tabindex) rather than `@angular/aria` Grid: the popup spends most of its
 * life as an UNFOCUSED mirror of the typed draft, and the month-transition
 * focus dance is exactly where the aria pattern needs internals-poking —
 * the same reasoning that hand-rolled the slash menu's combobox pattern.
 *
 * Keyboard (W3C APG date grid): arrows ±1 day / ±1 week ACROSS month
 * edges, PageUp/PageDown ±1 month (Shift or Ctrl: ±12), Home/End to the
 * month bounds, Enter/Space picks, Escape hands control back to the field.
 *
 * Far dates (a 1960 birthday): the header label zooms out — day grid →
 * a page of 20 years → that year's months → back to its days, the
 * Material/MUI drill. Only a DAY pick emits; year and month picks just
 * move `active`, so zooming never touches the field's draft. The zoomed
 * grids keep the same keyboard model (arrows, PageUp/PageDown a page,
 * Home/End the page bounds, Enter picks) and Escape zooms back to days
 * instead of leaving the calendar. Typing in the field snaps back to days.
 * Localization is pure `Intl` (weekday names, month label, first day of
 * week) — zero bundled translations, the phone lesson; iusta's Luxon
 * adapter stays at ITS boundary.
 */
@Component({
  selector: 'temporal-calendar',
  templateUrl: './calendar.html',
  styleUrl: './calendar.scss',
})
export class Calendar {
  #injector = inject(Injector);
  #document = inject(DOCUMENT);
  protected intl = inject(TemporalIntl);

  /** The month heading's id — the grid names itself by pointing here. */
  protected labelId = `temporal-cal-label-${nextCalendarId}`;
  /** The header button's description ("Choose year") — a hidden text node it points at. */
  protected hintId = `temporal-cal-hint-${nextCalendarId++}`;

  /** The pending day — the field's parsed draft, mirrored per keystroke. */
  activeDay = input<IsoDate | null>(null);

  /** The committed day (rendered filled). */
  selectedDay = input<IsoDate | null>(null);

  /**
   * Range gestures (T5): press-hold-drag paints a range, Ctrl/Cmd+click
   * restarts one. Off by default — single-date fields keep plain picks.
   */
  rangeGestures = input(false);

  /** The committed range endpoints, painted when no drag is in flight. */
  rangeStart = input<IsoDate | null>(null);
  rangeEnd = input<IsoDate | null>(null);

  locale = input<string | string[] | undefined>(undefined);

  /** The display zone (T6) — the today marker is that zone's today. */
  zone = input<string | undefined>(undefined);

  /**
   * Days failing this predicate render DISABLED and cannot be picked — a
   * host's business calendar (holidays, weekends; the date field's
   * `strictMode`). `undefined` = every day picks.
   */
  dayFilter = input<((iso: IsoDate) => boolean) | undefined>(undefined);
  protected dayDisabled(iso: IsoDate): boolean {
    const filter = this.dayFilter();
    return filter !== undefined && !filter(iso);
  }

  /** Reference clock — the today marker and the empty-field fallback month. */
  now = input<() => Date>(() => new Date());

  /** Today, in the display zone. */
  protected today = computed(() => todayIn(this.now()(), this.zone()));

  picked = output<IsoDate>();
  /** Ctrl/Cmd+click (or Ctrl/Cmd+Enter in the grid): "restart the range here". */
  ctrlPicked = output<IsoDate>();
  /** A drag settled across at least two days — the sorted range. */
  dragEnded = output<{ start: IsoDate; end: IsoDate }>();
  escaped = output<void>();

  // -- The drag (iusta's DateRangeDragAndRelease pointer logic, on our cells) ----

  #dragAnchor = signal<IsoDate | null>(null);
  #dragHover = signal<IsoDate | null>(null);
  /** A finished drag must swallow the click the same mouseup produces. */
  #suppressClick = false;
  #detachMouseup: (() => void) | null = null;

  /** What the grid paints: the live drag preview, else the committed range. */
  protected paintedRange = computed<{ start: IsoDate; end: IsoDate } | null>(() => {
    const anchor = this.#dragAnchor();
    if (anchor !== null) {
      const hover = this.#dragHover() ?? anchor;
      return anchor <= hover ? { start: anchor, end: hover } : { start: hover, end: anchor };
    }

    const start = this.rangeStart();
    const end = this.rangeEnd();
    if (start === null || end === null || start === end) return null;

    return start <= end ? { start, end } : { start: end, end: start };
  });

  protected inPaintedRange(iso: IsoDate): boolean {
    const range = this.paintedRange();
    return range !== null && iso > range.start && iso < range.end;
  }

  protected gridRef = inject<ElementRef<HTMLElement>>(ElementRef);
  protected gridFocused = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.#detachMouseup?.());
  }

  #dayOf(event: Event): IsoDate | null {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-day]');
    return cell?.getAttribute('data-day') ?? null;
  }

  /** Anchor a drag on primary-button press over a cell (range mode only). */
  protected handleGridMousedown(event: MouseEvent) {
    if (!this.rangeGestures() || event.button !== 0) return;
    const day = this.#dayOf(event);
    if (day === null) return;

    this.#dragAnchor.set(day);
    this.#dragHover.set(day);

    // Mouseup may land anywhere (outside the grid mid-drag) — listen on the document.
    const onMouseup = () => this.#finishDrag();
    this.#document.addEventListener('mouseup', onMouseup, { once: true });
    this.#detachMouseup = () => this.#document.removeEventListener('mouseup', onMouseup);
  }

  protected handleGridMouseover(event: MouseEvent) {
    if (this.#dragAnchor() === null) return;
    const day = this.#dayOf(event);
    if (day !== null) this.#dragHover.set(day);
  }

  #finishDrag() {
    this.#detachMouseup = null;
    const anchor = this.#dragAnchor();
    const hover = this.#dragHover();
    this.#dragAnchor.set(null);
    this.#dragHover.set(null);
    if (anchor === null || hover === null || anchor === hover) return; // a plain click — let it pick

    this.#suppressClick = true;
    queueMicrotask(() => (this.#suppressClick = false));
    this.dragEnded.emit(
      anchor <= hover ? { start: anchor, end: hover } : { start: hover, end: anchor },
    );
  }

  #cancelDrag() {
    this.#detachMouseup?.();
    this.#detachMouseup = null;
    this.#dragAnchor.set(null);
    this.#dragHover.set(null);
  }

  protected handleCellClick(day: IsoDate, event: MouseEvent) {
    if (this.#suppressClick) return;
    if (this.dayDisabled(day)) return;

    if (this.rangeGestures() && (event.ctrlKey || event.metaKey)) this.ctrlPicked.emit(day);
    else this.picked.emit(day);
  }

  /**
   * The active cell: FOLLOWS the draft mirror (`activeDay`), overridden by
   * grid navigation; an unparseable draft (null source) keeps the last
   * valid day standing.
   */
  protected active = linkedSignal<IsoDate | null, IsoDate>({
    source: this.activeDay,
    computation: (day, previous) => day ?? previous?.value ?? this.today(),
  });

  /**
   * Which grid shows. Resets to days whenever the draft moves — typing is
   * the keyboard route to a far date, and its result is a day.
   */
  protected view = linkedSignal<IsoDate | null, CalendarView>({
    source: this.activeDay,
    computation: () => 'day',
  });

  protected weeks = computed<CalendarDay[][]>(() => {
    const [, month] = parts(this.active());
    const first = firstDayOfWeek(this.locale());
    const today = this.today();

    const firstOfMonth = DateTime.fromISO(this.active()).startOf('month');
    // Luxon weekday: 1=Mon…7=Sun → JS convention (0=Sun) for the lead math.
    const lead = ((firstOfMonth.weekday % 7) - first + 7) % 7;

    const weeks: CalendarDay[][] = [];
    let cursor = firstOfMonth.minus({ days: lead });
    for (let week = 0; week < 6; week++) {
      const days: CalendarDay[] = [];
      for (let day = 0; day < 7; day++) {
        days.push({
          iso: cursor.toFormat(ISO_DAY),
          day: cursor.day,
          outside: cursor.month !== month,
          today: cursor.toFormat(ISO_DAY) === today,
        });
        cursor = cursor.plus({ days: 1 });
      }
      weeks.push(days);
    }

    return weeks;
  });

  protected monthLabel = computed(() => {
    const [year, month] = parts(this.active());
    try {
      return new Intl.DateTimeFormat(this.locale(), { month: 'long', year: 'numeric' }).format(
        new Date(year, month - 1, 1),
      );
    } catch {
      return `${year}-${String(month).padStart(2, '0')}`;
    }
  });

  protected activeYear = computed(() => parts(this.active())[0]);
  protected activeMonth = computed(() => parts(this.active())[1]);

  protected years = computed<CalendarPeriod[][]>(() => {
    const locale = this.locale();
    const start = yearPageStart(parts(this.active())[0]);
    const todayYear = parts(this.today())[0];
    const selected = this.selectedDay();
    const selectedYear = selected === null ? null : parts(selected)[0];

    const cells = Array.from({ length: YEARS_PER_PAGE }, (_, index) => {
      const year = start + index;
      const label = formatYear(locale, year);
      return {
        value: year,
        label,
        aria: label,
        today: year === todayYear,
        selected: year === selectedYear,
      };
    });

    return toRows(cells);
  });

  protected months = computed<CalendarPeriod[][]>(() => {
    const locale = this.locale();
    const [year] = parts(this.active());
    const [todayYear, todayMonth] = parts(this.today());
    const selected = this.selectedDay();
    const [selectedYear, selectedMonth] = selected === null ? [null, null] : parts(selected);

    const cells = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return {
        value: month,
        label: formatMonth(locale, year, month, { month: 'short' }),
        aria: formatMonth(locale, year, month, { month: 'long', year: 'numeric' }),
        today: year === todayYear && month === todayMonth,
        selected: year === selectedYear && month === selectedMonth,
      };
    });

    return toRows(cells);
  });

  /** The header text: "September 2026", "1960", or "1960–1979". */
  protected headerLabel = computed(() => {
    const [year] = parts(this.active());
    switch (this.view()) {
      case 'day':
        return this.monthLabel();
      case 'month':
        return formatYear(this.locale(), year);
      case 'year': {
        const start = yearPageStart(year);
        return formatYearRange(this.locale(), start, start + YEARS_PER_PAGE - 1);
      }
    }
  });

  protected prevLabel = computed(() => {
    switch (this.view()) {
      case 'day':
        return this.intl.prevMonthLabel();
      case 'month':
        return this.intl.prevYearLabel();
      case 'year':
        return this.intl.prevYearsLabel(YEARS_PER_PAGE);
    }
  });

  protected nextLabel = computed(() => {
    switch (this.view()) {
      case 'day':
        return this.intl.nextMonthLabel();
      case 'month':
        return this.intl.nextYearLabel();
      case 'year':
        return this.intl.nextYearsLabel(YEARS_PER_PAGE);
    }
  });

  /** What the header button does, spoken after its visible text. */
  protected headerDescription = computed(() =>
    this.view() === 'year' ? this.intl.chooseDateLabel() : this.intl.chooseYearLabel(),
  );

  protected weekdayNames = computed(() => {
    const first = firstDayOfWeek(this.locale());
    // The visible header is `narrow` ('M') — ambiguous to a screen reader,
    // and doubly so outside English — so each column header carries the
    // `long` name as its accessible label. Both come from `Intl`: the
    // aria upgrade stays at zero bundled translations.
    const format = (style: 'narrow' | 'long', day: number) => {
      try {
        // 2023-01-01 was a Sunday — a stable anchor for weekday names.
        return new Intl.DateTimeFormat(this.locale(), { weekday: style }).format(
          new Date(2023, 0, 1 + day),
        );
      } catch {
        return style === 'narrow'
          ? 'SMTWTFS'[day]
          : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day];
      }
    };

    return Array.from({ length: 7 }, (_, index) => {
      const day = (first + index) % 7;
      return { narrow: format('narrow', day), long: format('long', day) };
    });
  });

  protected dayAria(iso: IsoDate): string {
    return formatIsoDate(iso, this.locale(), { dateStyle: 'full' });
  }

  /** Moves focus into the grid (the field's ArrowDown handoff). */
  focusGrid() {
    this.#focusActiveCell();
  }

  /** The ‹ › buttons: a month, a year, or a page of years, per view. */
  protected page(direction: -1 | 1) {
    switch (this.view()) {
      case 'day':
        this.moveMonths(direction);
        break;
      case 'month':
        this.active.set(shiftYear(this.active(), direction));
        break;
      case 'year':
        this.active.set(shiftYear(this.active(), direction * YEARS_PER_PAGE));
        break;
    }
  }

  /** The header button: zoom out to the years, or from the years back to days. */
  protected toggleView() {
    this.#showView(this.view() === 'year' ? 'day' : 'year');
  }

  protected pickYear(year: number) {
    const [, month] = parts(this.active());
    this.active.set(withYearMonth(this.active(), year, month));
    this.#showView('month');
  }

  protected pickMonth(month: number) {
    const [year] = parts(this.active());
    this.active.set(withYearMonth(this.active(), year, month));
    this.#showView('day');
  }

  #showView(view: CalendarView) {
    this.view.set(view);
    this.#restoreFocusAfterRender();
  }

  protected moveMonths(months: number) {
    this.active.set(shiftMonth(this.active(), months));
    this.#restoreFocusAfterRender();
  }

  #moveDays(days: number) {
    this.active.set(shiftDay(this.active(), days));
    this.#restoreFocusAfterRender();
  }

  protected handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.#moveDays(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.#moveDays(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.#moveDays(-7);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.#moveDays(7);
        break;
      case 'PageUp':
        event.preventDefault();
        this.moveMonths(event.shiftKey || event.ctrlKey ? -12 : -1);
        break;
      case 'PageDown':
        event.preventDefault();
        this.moveMonths(event.shiftKey || event.ctrlKey ? 12 : 1);
        break;
      case 'Home': {
        event.preventDefault();
        const [year, month] = parts(this.active());
        this.active.set(toIsoDate(new Date(year, month - 1, 1)));
        this.#restoreFocusAfterRender();
        break;
      }
      case 'End': {
        event.preventDefault();
        const [year, month] = parts(this.active());
        this.active.set(toIsoDate(new Date(year, month, 0)));
        this.#restoreFocusAfterRender();
        break;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (this.dayDisabled(this.active())) break;
        if (this.rangeGestures() && (event.ctrlKey || event.metaKey)) {
          this.ctrlPicked.emit(this.active());
        } else {
          this.picked.emit(this.active());
        }
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        // Stage zero: a drag in flight cancels; the field keeps the session.
        if (this.#dragAnchor() !== null) {
          this.#cancelDrag();
          break;
        }
        this.escaped.emit();
        break;
    }
  }

  protected handleYearKeydown(event: KeyboardEvent) {
    const [year] = parts(this.active());
    const start = yearPageStart(year);
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -PERIOD_COLUMNS,
      ArrowDown: PERIOD_COLUMNS,
      PageUp: -YEARS_PER_PAGE,
      PageDown: YEARS_PER_PAGE,
      Home: start - year,
      End: start + YEARS_PER_PAGE - 1 - year,
    };

    this.#handlePeriodKeydown(
      event,
      moves[event.key],
      (years) => shiftYear(this.active(), years),
      () => this.pickYear(year),
    );
  }

  protected handleMonthKeydown(event: KeyboardEvent) {
    const [, month] = parts(this.active());
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -PERIOD_COLUMNS,
      ArrowDown: PERIOD_COLUMNS,
      PageUp: -12,
      PageDown: 12,
      Home: 1 - month,
      End: 12 - month,
    };

    this.#handlePeriodKeydown(
      event,
      moves[event.key],
      (months) => shiftMonth(this.active(), months),
      () => this.pickMonth(month),
    );
  }

  /** The zoomed grids' shared keyboard: move by `delta`, Enter/Space picks, Escape zooms back. */
  #handlePeriodKeydown(
    event: KeyboardEvent,
    delta: number | undefined,
    shift: (delta: number) => IsoDate,
    pick: () => void,
  ) {
    if (delta !== undefined) {
      event.preventDefault();
      this.active.set(shift(delta));
      this.#restoreFocusAfterRender();
      return;
    }

    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        pick();
        break;
      case 'Escape':
        // One layer per press: back to the days first, the field after that.
        event.preventDefault();
        event.stopPropagation();
        this.#showView('day');
        break;
    }
  }

  /**
   * The month-transition dance: navigation may re-render the whole grid,
   * destroying the focused cell — re-focus the active one after render,
   * but only when the grid actually held focus (never steal it from the
   * field while mirroring the draft).
   */
  #restoreFocusAfterRender() {
    if (!this.gridFocused) return;

    afterNextRender(() => this.#focusActiveCell(), { injector: this.#injector });
  }

  #focusActiveCell() {
    const cell = this.gridRef.nativeElement.querySelector<HTMLElement>(
      `[data-view="${this.view()}"] [data-active]`,
    );
    cell?.focus();
  }
}

/** APG grids need `row` wrappers — the zoomed grids' cells, PERIOD_COLUMNS per row. */
function toRows<T>(cells: T[]): T[][] {
  return Array.from({ length: Math.ceil(cells.length / PERIOD_COLUMNS) }, (_, row) =>
    cells.slice(row * PERIOD_COLUMNS, (row + 1) * PERIOD_COLUMNS),
  );
}

function formatYear(locale: string | string[] | undefined, year: number): string {
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric' }).format(new Date(year, 0, 1));
  } catch {
    return String(year);
  }
}

function formatYearRange(locale: string | string[] | undefined, from: number, to: number): string {
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric' }).formatRange(
      new Date(from, 0, 1),
      new Date(to, 0, 1),
    );
  } catch {
    return `${from}–${to}`;
  }
}

function formatMonth(
  locale: string | string[] | undefined,
  year: number,
  month: number,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(new Date(year, month - 1, 1));
  } catch {
    return `${year}-${String(month).padStart(2, '0')}`;
  }
}
