import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form, required } from '@angular/forms/signals';
import { MatFormFieldControl, MatFormFieldModule } from '@angular/material/form-field';

import {
  AngularInlineDate,
  AngularInlineDuration,
  AngularInlineTime,
} from 'angular-inline-select/temporal';
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

  it('a chrome click focuses; the form field speaks the errors — the overlay never opens', async () => {
    // An error state — required, emptied, touched — that WOULD open the
    // standalone error overlay once the session opens.
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

    chromeClick();
    expect(document.activeElement).toBe(h.input());
    h.fixture.detectChanges();

    // The adapter told the control a container renders its errors.
    const control = h.fixture.debugElement.query((el) => el.name === 'angular-inline-time')!
      .componentInstance as AngularInlineTime;
    expect(control.externalErrors()).toBe(true);
    expect(document.querySelector('.inline-time__panel')).toBeNull();
    expect(h.adapter.errorState).toBe(true); // …mat-error has the floor

    chromeClick(); // focused: no close-and-reopen flicker, nothing to toggle
    expect(document.querySelector('.inline-time__panel')).toBeNull();
    expect(document.activeElement).toBe(h.input());

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

    const control = fixture.debugElement.query((el) => el.name === 'angular-inline-date')!
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

    const control = fixture.debugElement.query((el) => el.name === 'angular-inline-date')!
      .componentInstance as AngularInlineDate;
    expect(control.overlayOrigin()).toBeNull();
  });
});

// =============================================================================
// floatLabel="always" — the label floats, so the placeholder must SHOW
//
// Material floats the label on `shouldLabelFloat` OR `floatLabel="always"`.
// Keying the placeholder-hiding class off `shouldLabelFloat` alone hid the
// placeholder in exactly the layout that reserves room for it.
// =============================================================================

@Component({
  imports: [MatFormFieldModule, AngularInlineTime, InlineMatFormField, FormField],
  template: `
    <mat-form-field floatLabel="always">
      <mat-label>Starts</mat-label>
      <angular-inline-time inlineMatFormField [formField]="field" locale="en-u-hc-h23" />
    </mat-form-field>
  `,
})
class MatAlwaysFloatHost {
  model = signal<string | null>(null);
  field = form(this.model);
}

describe('InlineMatFormField — floatLabel="always"', () => {
  it('keeps the placeholder visible while empty and unfocused', () => {
    const fixture = TestBed.createComponent(MatAlwaysFloatHost);
    fixture.detectChanges();
    const controlHost = fixture.nativeElement.querySelector('angular-inline-time') as HTMLElement;
    const adapter = fixture.debugElement
      .query((el) => el.name === 'angular-inline-time')!
      .injector.get(MatFormFieldControl) as InlineMatFormField;

    expect(adapter.shouldLabelFloat).toBe(false); // empty + unfocused…
    expect(adapter.labelIsFloating).toBe(true); // …but the form field floats it anyway
    expect(controlHost.classList).toContain('inline-field-bare');
    expect(controlHost.classList).not.toContain('inline-field-bare--hide-placeholder');
  });
});

// =============================================================================
// Inside a mat-form-field the FORM FIELD speaks the errors — a control's own
// error overlay (time, duration) stays closed (`externalErrors`)
// =============================================================================

@Component({
  imports: [MatFormFieldModule, AngularInlineDuration, InlineMatFormField, FormField],
  template: `
    <mat-form-field>
      <mat-label>Length</mat-label>
      <angular-inline-duration inlineMatFormField [formField]="field" />
    </mat-form-field>
  `,
})
class MatDurationHost {
  model = signal<number | null>(null);
  field = form(this.model, (path) => required(path, { message: 'A value is required' }));
}

describe('InlineMatFormField — externalErrors', () => {
  it('a hosted duration never opens its error overlay, even focused and invalid', async () => {
    const fixture = TestBed.createComponent(MatDurationHost);
    fixture.componentInstance.field().markAsTouched();
    fixture.detectChanges();

    const control = fixture.debugElement.query((el) => el.name === 'angular-inline-duration')!
      .componentInstance as AngularInlineDuration;
    expect(control.externalErrors()).toBe(true);

    const input = fixture.nativeElement.querySelector(
      '.inline-duration__input',
    ) as HTMLInputElement;
    input.focus();
    fixture.detectChanges();
    expect(document.querySelector('.inline-duration__panel')).toBeNull();

    input.blur();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  });
});

// =============================================================================
// Found through INLINE_TEMPORAL_MAT_CONTROL, so it mounts as an attribute or
// as a host directive of the control — and is inert outside a mat-form-field
// =============================================================================

@Component({
  imports: [AngularInlineDuration, InlineMatFormField],
  template: `<angular-inline-duration inlineMatFormField [(value)]="value" />`,
})
class StandaloneAdapterHost {
  value = signal<number | null>(3600);
}

describe('InlineMatFormField — outside a mat-form-field', () => {
  it('is inert: the control keeps its own chrome, no id, no bare class', () => {
    const fixture = TestBed.createComponent(StandaloneAdapterHost);
    fixture.detectChanges();
    const host = fixture.nativeElement.querySelector('angular-inline-duration') as HTMLElement;

    expect(host.classList.contains('inline-field-bare')).toBe(false);
    expect(host.hasAttribute('id')).toBe(false);
  });

  it('finds its control through the token every temporal control provides', () => {
    const fixture = TestBed.createComponent(StandaloneAdapterHost);
    fixture.detectChanges();
    const adapter = fixture.debugElement
      .query((el) => el.name === 'angular-inline-duration')!
      .injector.get(InlineMatFormField);

    expect(adapter.empty).toBe(false);
    expect(adapter.placeholder).toBe('HH:MM');
  });
});
