import { Component, signal, type Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form, required } from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';

import { InlineMatFormField } from 'angular-inline-select/temporal-mat';
import { AngularInlineDateTime } from './angular-inline-datetime';
import { AngularInlineDate } from '../angular-inline-date/angular-inline-date';
import { AngularInlineTime } from '../angular-inline-time/angular-inline-time';
import { composeDbEntry } from '../datetime/db-entry';

const NOW = new Date(2026, 4, 12);
const at = (day: string, time: string) => composeDbEntry(day, time);

// -- [formField] over a DB entry ---------------------------------------------

@Component({
  imports: [AngularInlineDateTime, FormField],
  template: `
    <angular-inline-datetime
      [formField]="field"
      locale="en"
      [now]="now"
      (savedModelChange)="commits.push($event)"
    />
  `,
})
class ValueHost {
  model = signal<string | null>(at('2026-05-12', '09:30'));
  field = form(this.model, (path) => required(path));
  now = () => NOW;

  commits: { value: string | null }[] = [];
}

// -- Hosted by a mat-form-field: the COMPOSITE is the control -----------------

@Component({
  imports: [MatFormFieldModule, AngularInlineDateTime, InlineMatFormField, FormField],
  template: `
    <mat-form-field>
      <mat-label>Timestamp</mat-label>
      <angular-inline-datetime
        inlineMatFormField
        [formField]="field"
        locale="en"
        [now]="now"
        ariaLabel="Meeting"
      />
    </mat-form-field>
  `,
})
class MatHost {
  model = signal<string | null>(at('2026-05-12', '09:30'));
  field = form(this.model);
  now = () => NOW;
}

interface Harness<T> {
  fixture: ComponentFixture<T>;
  host: T;
  composite: () => AngularInlineDateTime;
  dateLeaf: () => AngularInlineDate;
  timeLeaf: () => AngularInlineTime;
  dateInput: () => HTMLInputElement;
  timeInput: () => HTMLInputElement;
}

function setupHost<T>(type: Type<T>): Harness<T> {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();

  const instance = <C>(name: string) =>
    fixture.debugElement.query((el) => el.name === name)!.componentInstance as C;

  return {
    fixture,
    host: fixture.componentInstance,
    composite: () => instance<AngularInlineDateTime>('angular-inline-datetime'),
    dateLeaf: () => instance<AngularInlineDate>('angular-inline-date'),
    timeLeaf: () => instance<AngularInlineTime>('angular-inline-time'),
    dateInput: () => fixture.nativeElement.querySelector('.inline-date__input') as HTMLInputElement,
    timeInput: () => fixture.nativeElement.querySelector('.inline-time__input') as HTMLInputElement,
  };
}

async function settle(h: Harness<unknown>) {
  h.fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  h.fixture.detectChanges();
}

function commitInto(h: Harness<unknown>, input: HTMLInputElement, text: string) {
  input.focus();
  h.fixture.detectChanges();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  h.fixture.detectChanges();
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  h.fixture.detectChanges();
}

async function blurAway(h: Harness<unknown>) {
  (document.activeElement as HTMLElement | null)?.blur();
  await settle(h);
}

describe('AngularInlineDateTime (one instant, two fields)', () => {
  afterEach(async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    await new Promise((resolve) => setTimeout(resolve));
  });

  it('renders BOTH leaves from one instant', () => {
    const h = setupHost(ValueHost);

    expect(h.dateInput().value).toBe('May 12, 2026');
    expect(h.timeInput().value).toBe('09:30');
  });

  it('a DATE commit moves the day, wall-clock PRESERVED — one composed commit', async () => {
    const h = setupHost(ValueHost);

    commitInto(h, h.dateInput(), '24.12.2026');
    await blurAway(h);

    expect(h.host.model()).toBe(at('2026-12-24', '09:30'));
    expect(h.host.commits).toEqual([{ value: at('2026-12-24', '09:30') }]);
  });

  it('a TIME commit sets the wall clock, day PRESERVED', async () => {
    const h = setupHost(ValueHost);

    commitInto(h, h.timeInput(), '2105');
    await blurAway(h);

    expect(h.host.model()).toBe(at('2026-05-12', '21:05'));
    expect(h.host.commits).toEqual([{ value: at('2026-05-12', '21:05') }]);
  });

  it('starting EMPTY: a date commit lands at midnight; the time then refines it', async () => {
    const h = setupHost(ValueHost);
    h.host.model.set(null);
    h.fixture.detectChanges();

    commitInto(h, h.dateInput(), '12.5.2026');
    await blurAway(h);
    expect(h.host.model()).toBe(at('2026-05-12', '00:00'));

    commitInto(h, h.timeInput(), '8');
    await blurAway(h);
    expect(h.host.model()).toBe(at('2026-05-12', '08:00'));
  });

  it('errors show on the leaves’ rule: invalid AND touched — a leaf’s touch counts', async () => {
    const h = setupHost(ValueHost);
    h.host.model.set(null);
    h.fixture.detectChanges();

    // Required and empty, but untouched: nothing shows yet.
    expect(h.composite().errorsVisible()).toBe(false);

    h.dateInput().focus();
    h.fixture.detectChanges();
    await blurAway(h);

    expect(h.composite().errorsVisible()).toBe(true);
  });

  it('names each leaf through TemporalIntl — its own name without a base label', () => {
    const h = setupHost(ValueHost);

    expect(h.dateInput().getAttribute('aria-label')).toBe('Date');
    expect(h.timeInput().getAttribute('aria-label')).toBe('Time');
  });

  it('is a role="group" — unhosted and unlabelled, the group carries no name of its own', () => {
    const h = setupHost(ValueHost);
    const host = h.fixture.nativeElement.querySelector('angular-inline-datetime') as HTMLElement;

    expect(host.getAttribute('role')).toBe('group');
    expect(host.hasAttribute('aria-labelledby')).toBe(false);
    expect(host.hasAttribute('aria-label')).toBe(false);
  });

  it('composes its placeholder from the leaves', () => {
    const h = setupHost(ValueHost);

    expect(h.composite().placeholderText()).toBe(
      `${h.dateLeaf().placeholderText()} ${h.timeLeaf().placeholderText()}`,
    );
  });
});

describe('AngularInlineDateTime in a mat-form-field (the composite is the control)', () => {
  it('a press on EITHER leaf keeps its default; the chrome is shielded', async () => {
    const h = setupHost(MatHost);
    await h.fixture.whenStable();

    const press = (target: Element) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(press(h.timeInput())).toBe(false);
    expect(press(h.dateInput())).toBe(false);

    const chrome = h.fixture.nativeElement.querySelector('.mat-mdc-text-field-wrapper') as Element;
    expect(press(chrome)).toBe(true);
  });

  it('names each leaf as a PART of its label (TemporalIntl.partLabel)', () => {
    const h = setupHost(MatHost);

    expect(h.dateInput().getAttribute('aria-label')).toBe('Meeting date');
    expect(h.timeInput().getAttribute('aria-label')).toBe('Meeting time');
  });

  it('hands its leaves what a hosted control gets: external errors, the overlay origin', async () => {
    const h = setupHost(MatHost);
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.timeLeaf().externalErrors()).toBe(true);
    expect(h.dateLeaf().overlayOrigin()).not.toBeNull();
  });

  it('is the group the form field’s label names — `labelledBy` wins over `ariaLabel`', async () => {
    const h = setupHost(MatHost);
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    const host = h.fixture.nativeElement.querySelector('angular-inline-datetime') as HTMLElement;
    const label = h.fixture.nativeElement.querySelector('label') as HTMLLabelElement;
    expect(label.id).not.toBe('');
    expect(host.getAttribute('role')).toBe('group');
    expect(host.getAttribute('aria-labelledby')).toBe(label.id);
    expect(host.hasAttribute('aria-label')).toBe(false);
  });

  it('carries the bare chrome on its own host; the leaves follow it, never host it', () => {
    const h = setupHost(MatHost);
    const element = (name: string) => h.fixture.nativeElement.querySelector(name) as HTMLElement;

    expect(element('angular-inline-datetime').classList).toContain('inline-field-bare');
    expect(element('angular-inline-date').classList).not.toContain('inline-field-bare');
    expect(element('angular-inline-time').classList).not.toContain('inline-field-bare');
  });
});
