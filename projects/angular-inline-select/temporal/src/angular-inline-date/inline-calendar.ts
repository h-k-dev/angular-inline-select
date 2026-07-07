import {
  Component,
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

import { DateTime } from 'luxon';

import { toIsoDate, formatIsoDate, type IsoDate } from './date-codec';

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
  selector: 'angular-inline-calendar',
  template: `
    <div class="cal__header">
      <button
        type="button"
        class="cal__nav"
        aria-label="Previous month"
        (mousedown)="$event.preventDefault()"
        (click)="moveMonths(-1)"
      >
        ‹
      </button>
      <div class="cal__label" aria-live="polite">{{ monthLabel() }}</div>
      <button
        type="button"
        class="cal__nav"
        aria-label="Next month"
        (mousedown)="$event.preventDefault()"
        (click)="moveMonths(1)"
      >
        ›
      </button>
    </div>

    <div
      #grid
      class="cal__grid"
      role="grid"
      [attr.aria-label]="monthLabel()"
      (keydown)="handleKeydown($event)"
      (focusin)="gridFocused = true"
      (focusout)="gridFocused = false"
    >
      <div class="cal__weekdays" role="row">
        @for (name of weekdayNames(); track $index) {
          <span class="cal__weekday" role="columnheader">{{ name }}</span>
        }
      </div>
      @for (week of weeks(); track $index) {
        <div class="cal__week" role="row">
          @for (cell of week; track cell.iso) {
            <button
              type="button"
              role="gridcell"
              class="cal__day"
              [attr.data-day]="cell.iso"
              [attr.data-outside]="cell.outside || null"
              [attr.data-today]="cell.today || null"
              [attr.data-active]="cell.iso === active() || null"
              [attr.data-selected]="cell.iso === selectedDay() || null"
              [attr.aria-selected]="cell.iso === selectedDay()"
              [attr.aria-label]="dayAria(cell.iso)"
              [tabindex]="cell.iso === active() ? 0 : -1"
              (mousedown)="$event.preventDefault()"
              (click)="picked.emit(cell.iso)"
            >
              {{ cell.day }}
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: 8px;
      user-select: none;
    }
    .cal__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 4px 6px;
    }
    .cal__label {
      font: var(--mat-sys-title-small, 500 0.875rem/1.25 system-ui);
      text-transform: capitalize;
    }
    .cal__nav {
      border: 0;
      background: transparent;
      cursor: pointer;
      font-size: 1.1rem;
      line-height: 1;
      padding: 4px 8px;
      border-radius: var(--mat-sys-corner-small, 0.5rem);
      color: var(--mat-sys-on-surface-variant, #5f6368);
    }
    .cal__nav:hover { background: var(--mat-sys-surface-container-highest, #eee); }
    .cal__weekdays, .cal__week {
      display: grid;
      grid-template-columns: repeat(7, 2.1rem);
    }
    .cal__weekday {
      text-align: center;
      font: var(--mat-sys-label-small, 500 0.6875rem/1.6 system-ui);
      color: var(--mat-sys-on-surface-variant, #5f6368);
      padding-block: 2px;
    }
    .cal__day {
      height: 2.1rem;
      border: 0;
      background: transparent;
      border-radius: 50%;
      cursor: pointer;
      font: var(--mat-sys-body-small, 0.8125rem/1 system-ui);
      color: var(--mat-sys-on-surface, #1f1f1f);
    }
    .cal__day:hover { background: var(--mat-sys-surface-container-highest, #eee); }
    .cal__day[data-outside] { color: var(--mat-sys-outline, #999); }
    .cal__day[data-today] { outline: 1px solid var(--mat-sys-outline, #999); outline-offset: -1px; }
    .cal__day[data-active] { outline: 2px solid var(--mat-sys-primary, #4285f4); outline-offset: -2px; }
    .cal__day[data-selected] {
      background: var(--mat-sys-primary, #4285f4);
      color: var(--mat-sys-on-primary, #fff);
    }
    .cal__day:focus-visible { outline: 2px solid var(--mat-sys-primary, #4285f4); outline-offset: 1px; }
  `,
})
export class AngularInlineCalendar {
  #injector = inject(Injector);

  /** The pending day — the field's parsed draft, mirrored per keystroke. */
  activeDay = input<IsoDate | null>(null);

  /** The committed day (rendered filled). */
  selectedDay = input<IsoDate | null>(null);

  locale = input<string | string[] | undefined>(undefined);

  /** Reference clock — the today marker and the empty-field fallback month. */
  now = input<() => Date>(() => new Date());

  picked = output<IsoDate>();
  escaped = output<void>();

  protected gridRef = inject<ElementRef<HTMLElement>>(ElementRef);
  protected gridFocused = false;

  /**
   * The active cell: FOLLOWS the draft mirror (`activeDay`), overridden by
   * grid navigation; an unparseable draft (null source) keeps the last
   * valid day standing.
   */
  protected active = linkedSignal<IsoDate | null, IsoDate>({
    source: this.activeDay,
    computation: (day, previous) => day ?? previous?.value ?? toIsoDate(this.now()()),
  });

  protected weeks = computed<CalendarDay[][]>(() => {
    const [, month] = parts(this.active());
    const first = firstDayOfWeek(this.locale());
    const today = toIsoDate(this.now()());

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
        this.picked.emit(this.active());
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
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
