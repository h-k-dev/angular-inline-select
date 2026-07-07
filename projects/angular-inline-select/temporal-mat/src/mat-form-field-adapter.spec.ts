import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form, required } from '@angular/forms/signals';
import { MatFormFieldControl, MatFormFieldModule } from '@angular/material/form-field';

import { AngularInlineDate, AngularInlineTime } from 'angular-inline-select/temporal';
import { composeDbEntry } from 'angular-inline-select/temporal';
import { InlineMatFormField } from './mat-form-field-adapter';

const at = (time: string) => composeDbEntry('2026-07-21', time);

@Component({
  imports: [MatFormFieldModule, AngularInlineTime, InlineMatFormField, FormField],
  template: `
    <mat-form-field>
      <mat-label>Starts</mat-label>
      <angular-inline-time inlineMatFormField [formField]="field" locale="en-u-hc-h23" />
      <mat-hint>24-hour time</mat-hint>
    </mat-form-field>
  `,
})
class MatHost {
  model = signal<string | null>(at('09:30'));
  // Required, so an emptied + touched field turns the adapter's errorState.
  field = form(this.model, (path) => required(path));
}

interface Harness {
  fixture: ComponentFixture<MatHost>;
  host: MatHost;
  adapter: InlineMatFormField;
  input: () => HTMLInputElement;
  controlHost: () => HTMLElement;
}

function setup(): Harness {
  const fixture = TestBed.createComponent(MatHost);
  fixture.detectChanges();

  const controlHost = () =>
    fixture.nativeElement.querySelector('angular-inline-time') as HTMLElement;

  return {
    fixture,
    host: fixture.componentInstance,
    adapter: fixture.debugElement
      .query((el) => el.name === 'angular-inline-time')!
      .injector.get(MatFormFieldControl) as InlineMatFormField,
    input: () => fixture.nativeElement.querySelector('.inline-time__input') as HTMLInputElement,
    controlHost,
  };
}

describe('InlineMatFormField (the temporal-mat adapter)', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
  });

  it('registers as the form-field control: type class on the root, value rendered', () => {
    const root = h.fixture.nativeElement.querySelector('mat-form-field') as HTMLElement;
    expect(root.classList).toContain('mat-mdc-form-field-type-inline-temporal');
    expect(h.input().value).toBe('09:30');
    expect(h.fixture.nativeElement.textContent).toContain('Starts');
  });

  it('derives empty/float state from the control signals — mat-ignorantly', () => {
    expect(h.adapter.empty).toBe(false);
    expect(h.adapter.shouldLabelFloat).toBe(true);

    h.host.model.set(null);
    h.fixture.detectChanges();

    expect(h.adapter.empty).toBe(true);
    expect(h.adapter.shouldLabelFloat).toBe(false); // unfocused + empty
  });

  it('applies the generic BARE-CHROME classes: no own underline, placeholder deferred to the label', () => {
    expect(h.controlHost().classList).toContain('inline-field-bare');
    // Value present → label floats → placeholder may show.
    expect(h.controlHost().classList).not.toContain('inline-field-bare--hide-placeholder');

    h.host.model.set(null);
    h.fixture.detectChanges();
    expect(h.controlHost().classList).toContain('inline-field-bare--hide-placeholder');
  });

  it('errorState mirrors the control errorsVisible verdict and pokes stateChanges', () => {
    let pokes = 0;
    const subscription = h.adapter.stateChanges.subscribe(() => pokes++);

    expect(h.adapter.errorState).toBe(false);

    // Required + emptied + touched → the field says errors show.
    h.host.model.set(null);
    h.host.field().markAsTouched();
    h.fixture.detectChanges();

    expect(h.adapter.errorState).toBe(true);
    expect(pokes).toBeGreaterThan(0);
    subscription.unsubscribe();
  });

  it('a chrome click focuses when idle, then TOGGLES the panel — never close-and-reopen', async () => {
    // The panel is error-only now (there is no live preview), so put the
    // field in an error state — required, emptied, touched — to give the
    // panel something to show once the session opens.
    h.host.model.set(null);
    h.host.field().markAsTouched();
    h.fixture.detectChanges();

    const container = h.fixture.nativeElement.querySelector('mat-form-field') as HTMLElement;
    const chromeClick = () => {
      const event = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(event, 'target', { value: container });
      h.adapter.onContainerClick(event);
      h.fixture.detectChanges();
    };

    // Idle: the click focuses (the session opens on focusin, the error panel follows).
    chromeClick();
    expect(document.activeElement).toBe(h.input());
    h.fixture.detectChanges();
    expect(document.querySelector('.inline-time__panel')).not.toBeNull();

    // Focused: the chrome click TOGGLES — close, then reopen.
    chromeClick();
    expect(document.querySelector('.inline-time__panel')).toBeNull();
    chromeClick();
    expect(document.querySelector('.inline-time__panel')).not.toBeNull();

    h.input().blur();
    await new Promise((resolve) => setTimeout(resolve));
    h.fixture.detectChanges();
  });

  it('container CHROME mousedowns are prevented — the session must not blur away', () => {
    const container = h.fixture.nativeElement.querySelector('mat-form-field') as HTMLElement;

    // Chrome (outside the control host): prevented, focus survives.
    const chrome = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    container.dispatchEvent(chrome);
    expect(chrome.defaultPrevented).toBe(true);

    // The control's own input: untouched — the caret needs it.
    const own = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    h.input().dispatchEvent(own);
    expect(own.defaultPrevented).toBe(false);
  });

  it('describes the input with the form-field hint ids', () => {
    // Material calls setDescribedByIds with the mat-hint id after render.
    expect(h.input().getAttribute('aria-describedby')).toContain('mat-mdc-hint');
  });
});

@Component({
  imports: [MatFormFieldModule, AngularInlineDate, InlineMatFormField, FormField],
  template: `
    <mat-form-field>
      <mat-label>Deadline</mat-label>
      <angular-inline-date inlineMatFormField [formField]="field" />
    </mat-form-field>
  `,
})
class MatDateHost {
  model = signal<string | null>(null);
  field = form(this.model);
}

@Component({
  imports: [AngularInlineDate, FormField],
  template: `<angular-inline-date [formField]="field" />`,
})
class BareDateHost {
  model = signal<string | null>(null);
  field = form(this.model);
}

describe('InlineMatFormField calendar anchoring', () => {
  it('anchors the calendar to the form-field FLEX box, not the bare input wrapper', () => {
    const fixture = TestBed.createComponent(MatDateHost);
    fixture.detectChanges();

    const control = fixture.debugElement
      .query((el) => el.name === 'angular-inline-date')!
      .componentInstance as AngularInlineDate;
    const origin = control.overlayOrigin();
    // getConnectedOverlayOrigin() returns the text-field wrapper — the box
    // INCLUDING the underline (line ripple), excluding the subscript row —
    // the exact anchor mat-select/-datepicker use, not the text baseline.
    const wrapper = fixture.nativeElement.querySelector(
      '.mat-mdc-text-field-wrapper',
    ) as HTMLElement;

    expect(wrapper).not.toBeNull();
    expect(origin).not.toBeNull();
    expect((origin as { nativeElement: HTMLElement }).nativeElement).toBe(wrapper);
  });

  it('leaves the origin null when the control stands alone — anchors to its own wrapper', () => {
    const fixture = TestBed.createComponent(BareDateHost);
    fixture.detectChanges();

    const control = fixture.debugElement
      .query((el) => el.name === 'angular-inline-date')!
      .componentInstance as AngularInlineDate;
    expect(control.overlayOrigin()).toBeNull();
  });
});
