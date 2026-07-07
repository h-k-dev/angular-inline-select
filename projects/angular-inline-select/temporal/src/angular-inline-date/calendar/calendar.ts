import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

import { DateTime } from 'luxon';

import { toIsoDate, formatIsoDate, type IsoDate } from '../date-codec';
import { todayIn } from '../../datetime/db-entry';

interface CalendarDay {
  iso: IsoDate;
  day: number;
  outside: boolean;
  today: boolean;
}

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

  protected weekdayNames = computed(() => {
    const first = firstDayOfWeek(this.locale());
    const format = (day: number) => {
      try {
        // 2023-01-01 was a Sunday — a stable anchor for weekday names.
        return new Intl.DateTimeFormat(this.locale(), { weekday: 'narrow' }).format(
          new Date(2023, 0, 1 + day),
        );
      } catch {
        return 'SMTWTFS'[day];
      }
    };

    return Array.from({ length: 7 }, (_, index) => format((first + index) % 7));
  });

  protected dayAria(iso: IsoDate): string {
    return formatIsoDate(iso, this.locale(), { dateStyle: 'full' });
  }

  /** Moves focus into the grid (the field's ArrowDown handoff). */
  focusGrid() {
    this.#focusActiveCell();
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
      `[data-day="${this.active()}"]`,
    );
    cell?.focus();
  }
}
