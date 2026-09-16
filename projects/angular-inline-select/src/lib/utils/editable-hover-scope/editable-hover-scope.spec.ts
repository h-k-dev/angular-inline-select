import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditableHoverScope } from './editable-hover-scope';
import { AngularInlineText } from '../../angular-inline-text/angular-inline-text';

@Component({
  imports: [AngularInlineText, EditableHoverScope],
  template: `
    <div class="row" editableHoverScope [pressToFocus]="press()">
      <span class="label">Name</span>
      <span class="cell"><angular-inline-text [(value)]="value" /></span>
    </div>
  `,
})
class ScopeHost {
  value = signal('initial');
  press = signal(true);
}

@Component({
  imports: [AngularInlineText, EditableHoverScope],
  template: `
    <div class="row" editableHoverScope>
      <span class="label">Range</span>
      <angular-inline-text [(value)]="start" />
      <angular-inline-text [(value)]="end" />
    </div>
  `,
})
class TwoFieldHost {
  start = signal('a');
  end = signal('b');
}

describe('EditableHoverScope — the container as the interactive unit', () => {
  let fixture: ComponentFixture<ScopeHost>;

  const row = () => fixture.nativeElement.querySelector('.row') as HTMLElement;
  const label = () => fixture.nativeElement.querySelector('.label') as HTMLElement;
  const cell = () => fixture.nativeElement.querySelector('.cell') as HTMLElement;
  const text = () => fixture.nativeElement.querySelector('angular-inline-text') as HTMLElement;
  const display = () =>
    fixture.nativeElement.querySelector('.editable-text__display') as HTMLElement;
  const bubble = () => document.querySelector('.editable-bubble');

  function fire(target: Element, type: string, init: MouseEventInit = {}) {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: type !== 'mouseenter' && type !== 'mouseleave',
        cancelable: true,
        button: 0,
        ...init,
      }),
    );
    fixture.detectChanges();
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(ScopeHost);
    fixture.detectChanges();
    await fixture.whenStable(); // the field finds its scope after the first render
    fixture.detectChanges();
  });

  it('the field finds its scope by DOM and marks itself scoped', () => {
    expect(text().classList.contains('editable-text--scoped')).toBe(true);
  });

  it("hovering the scope arms the field's bubble; leaving disarms it after the grace", async () => {
    expect(bubble()).toBeNull();

    fire(row(), 'mouseenter');
    expect(bubble()).not.toBeNull();

    fire(row(), 'mouseleave');
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();
    expect(bubble()).toBeNull();
  });

  it('paints on hover only', () => {
    expect(row().classList.contains('editable-hover-scope--active')).toBe(false);

    fire(row(), 'mouseenter');
    expect(row().classList.contains('editable-hover-scope--active')).toBe(true);
    fire(row(), 'mouseleave');
    expect(row().classList.contains('editable-hover-scope--active')).toBe(false);
  });

  it('focus-within arms the actions but never paints — a focused row and a hovered row are two shapes', async () => {
    display().focus();
    fixture.detectChanges();

    expect(bubble()).not.toBeNull(); // the keyboard reaches the actions
    expect(row().classList.contains('editable-hover-scope--active')).toBe(false); // the underline is the focus signal

    display().blur();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();
    expect(bubble()).toBeNull();
  });

  it('a press on the scope’s own space focuses the one field, caret nearest', () => {
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 500,
      clientY: 5,
    });
    cell().dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(display());
    // jsdom has no layout: the nearest character is the end
    expect(document.getSelection()?.anchorOffset).toBe('initial'.length);

    // A press on the field itself stays the field's own business
    const own = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    display().dispatchEvent(own);
    expect(own.defaultPrevented).toBe(false);
  });

  it('text keeps its press: a label is never forwarded (a rename gesture, and selectable)', () => {
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    label().dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(display());
  });

  it('pressToFocus false opts the scope out', () => {
    fixture.componentInstance.press.set(false);
    fixture.detectChanges();

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    cell().dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(display());
  });

  it('never forwards when the scope holds more than one field', () => {
    const two = TestBed.createComponent(TwoFieldHost);
    two.detectChanges();

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    two.nativeElement.querySelector('.row').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement?.classList.contains('editable-text__display')).toBe(false);
  });
});
