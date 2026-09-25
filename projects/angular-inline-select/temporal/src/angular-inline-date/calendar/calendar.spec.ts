import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Calendar } from './calendar';
import { TemporalIntl } from '../../temporal-intl';

describe('Calendar', () => {
  let component: Calendar;
  let fixture: ComponentFixture<Calendar>;
  let host: HTMLElement;

  const header = () => host.querySelector<HTMLButtonElement>('.cal__label')!;
  const headerText = () => header().querySelector('span')!.textContent!.trim();
  const navButtons = () => host.querySelectorAll<HTMLButtonElement>('.cal__nav');
  const cell = (selector: string) => host.querySelector<HTMLElement>(selector);

  function key(target: Element, key: string) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Calendar],
    }).compileComponents();

    fixture = TestBed.createComponent(Calendar);
    component = fixture.componentInstance;
    host = fixture.nativeElement;
    fixture.componentRef.setInput('locale', 'en-US');
    fixture.componentRef.setInput('now', () => new Date(2026, 8, 15));
    fixture.componentRef.setInput('activeDay', '2026-09-15');
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('weekday headers show the narrow name and speak the LONG one', () => {
    const headers = Array.from(host.querySelectorAll<HTMLElement>('.cal__weekday'));
    expect(headers.length).toBe(7);
    // en-US starts the week on Sunday.
    expect(headers[0].textContent!.trim()).toBe('S');
    expect(headers.map((h) => h.getAttribute('aria-label'))).toEqual([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]);
  });

  it('the navigation speaks through TemporalIntl — an override relabels it live', () => {
    const intl = TestBed.inject(TemporalIntl);
    expect(navButtons()[0].getAttribute('aria-label')).toBe('Previous month');

    intl.prevMonthLabel.set('Vorheriger Monat');
    fixture.detectChanges();
    expect(navButtons()[0].getAttribute('aria-label')).toBe('Vorheriger Monat');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(headerText()).toBe('September 2026');
  });

  it('the header zooms out to a 20-year page aligned to the twenties', () => {
    header().click();
    fixture.detectChanges();

    expect(headerText()).toMatch(/^2020\s?–\s?2039$/); // Intl pads the dash (thin spaces)
    expect(host.querySelectorAll('[data-year]').length).toBe(20);
    expect(cell('[data-year="2026"]')?.hasAttribute('data-active')).toBe(true);
    expect(cell('[data-view="day"]')?.hasAttribute('data-inactive')).toBe(true);
    expect(navButtons()[0].getAttribute('aria-label')).toBe('Previous 20 years');
  });

  it('reaches a 1960 birthday in a handful of clicks: header, 3 pages, year, month, day', () => {
    const picked: string[] = [];
    component.picked.subscribe((day) => picked.push(day));

    header().click();
    fixture.detectChanges();
    for (let page = 0; page < 3; page++) {
      navButtons()[0].click();
      fixture.detectChanges();
    }
    expect(headerText()).toMatch(/^1960\s?–\s?1979$/);

    cell('[data-year="1960"]')!.click();
    fixture.detectChanges();
    expect(headerText()).toBe('1960');
    expect(picked).toEqual([]); // zooming never commits

    cell('[data-month="3"]')!.click();
    fixture.detectChanges();
    expect(headerText()).toBe('March 1960');
    expect(cell('[data-view="day"]')?.hasAttribute('data-inactive')).toBe(false);

    cell('[data-day="1960-03-08"]')!.click();
    expect(picked).toEqual(['1960-03-08']);
  });

  it('the month view pages a year; the header from the years returns to the days', () => {
    header().click();
    fixture.detectChanges();
    cell('[data-year="2026"]')!.click();
    fixture.detectChanges();

    expect(navButtons()[1].getAttribute('aria-label')).toBe('Next year');
    navButtons()[1].click();
    fixture.detectChanges();
    expect(headerText()).toBe('2027');

    header().click(); // month → years
    fixture.detectChanges();
    header().click(); // years → days
    fixture.detectChanges();
    expect(headerText()).toBe('September 2027');
  });

  it('clamps the day when the target month is shorter (Feb 29 → Feb 28)', () => {
    fixture.componentRef.setInput('activeDay', '2024-02-29');
    fixture.detectChanges();

    header().click();
    fixture.detectChanges();
    cell('[data-year="2023"]')!.click();
    fixture.detectChanges();
    cell('[data-month="2"]')!.click();
    fixture.detectChanges();

    expect(cell('[data-day="2023-02-28"]')?.hasAttribute('data-active')).toBe(true);
  });

  it('keyboard: the zoomed grids move, page, pick, and Escape zooms back without leaving', async () => {
    const escaped: unknown[] = [];
    component.escaped.subscribe(() => escaped.push(true));

    component.focusGrid();
    header().click();
    await settle();
    expect(document.activeElement?.getAttribute('data-year')).toBe('2026');

    key(document.activeElement!, 'ArrowUp'); // -4
    key(document.activeElement!, 'PageUp'); // -20
    await settle();
    expect(document.activeElement?.getAttribute('data-year')).toBe('2002');

    key(document.activeElement!, 'Home');
    await settle();
    expect(document.activeElement?.getAttribute('data-year')).toBe('2000');

    key(document.activeElement!, 'Enter');
    await settle();
    expect(headerText()).toBe('2000');
    expect(document.activeElement?.getAttribute('data-month')).toBe('9');

    key(document.activeElement!, 'End');
    await settle();
    key(document.activeElement!, 'Escape');
    await settle();

    expect(escaped).toEqual([]);
    expect(headerText()).toBe('December 2000');
    expect(document.activeElement?.getAttribute('data-day')).toBe('2000-12-15');
  });

  it('a new draft snaps a zoomed calendar back to the days', () => {
    header().click();
    fixture.detectChanges();

    fixture.componentRef.setInput('activeDay', '1960-03-08');
    fixture.detectChanges();

    expect(headerText()).toBe('March 1960');
    expect(host.querySelector('[data-year]')).toBeNull();
  });
  it('ARIA: the header is described by a hidden hint, announced OUTSIDE the button', () => {
    const hint = host.querySelector(`#${header().getAttribute('aria-describedby')}`);
    expect(hint?.textContent?.trim()).toBe('Choose year');
    expect(header().hasAttribute('aria-description')).toBe(false);
    expect(header().querySelector('[aria-live]')).toBeNull();

    header().click();
    fixture.detectChanges();

    expect(hint?.textContent?.trim()).toBe('Choose date');
    const live = host.querySelector('[aria-live]');
    expect(header().contains(live)).toBe(false);
    expect(live?.textContent).toMatch(/^2020\s?–\s?2039$/);
  });

  it('ARIA: today is aria-current — "date" on the day, "true" on its year and month', () => {
    expect(cell('[data-day="2026-09-15"]')?.getAttribute('aria-current')).toBe('date');
    expect(host.querySelectorAll('[aria-current]').length).toBe(1);

    header().click();
    fixture.detectChanges();
    expect(cell('[data-year="2026"]')?.getAttribute('aria-current')).toBe('true');
    expect(cell('[data-year="2025"]')?.hasAttribute('aria-current')).toBe(false);

    cell('[data-year="2026"]')!.click();
    fixture.detectChanges();
    expect(cell('[data-month="9"]')?.getAttribute('aria-current')).toBe('true');
    expect(cell('[data-month="8"]')?.hasAttribute('aria-current')).toBe(false);
  });
});
