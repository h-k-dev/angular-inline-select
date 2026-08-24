import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { AngularInlineDate } from 'angular-inline-select/temporal';

import {
  AngularInlineText,
  type InlineTextSaved,
} from '../../angular-inline-text/angular-inline-text';
import { AngularInlineNumber } from '../../angular-inline-number/angular-inline-number';
import {
  EditableScope,
  type EditableScopeAdvanceMode,
  type EditableScopeBlockedPolicy,
} from './editable-scope';

// =============================================================================
// Host — a bare tabbable, then two scoped text fields (in DOM order)
// =============================================================================

@Component({
  imports: [AngularInlineText, EditableScope],
  template: `
    <div
      editableScope
      [tabCommits]="tabCommits()"
      [onBlocked]="onBlocked()"
      [advanceMode]="advanceMode()"
      [wrap]="wrap()"
    >
      <input class="between" type="text" />
      <angular-inline-text
        class="first"
        [(value)]="first"
        [isSingleLine]="true"
        [invalid]="firstInvalid()"
        (saved)="sessions.push($event)"
      />
      <angular-inline-text class="second" [(value)]="second" [isSingleLine]="true" />
    </div>
  `,
})
class ScopedHost {
  first = signal('alpha');
  second = signal('beta');
  firstInvalid = signal(false);

  tabCommits = signal(true);
  onBlocked = signal<EditableScopeBlockedPolicy>('revert');
  advanceMode = signal<EditableScopeAdvanceMode>('focus');
  wrap = signal(false);

  sessions: InlineTextSaved[] = [];
}

// =============================================================================
// Helpers
// =============================================================================

interface Harness {
  fixture: ComponentFixture<ScopedHost>;
  host: ScopedHost;
  display: (which: 'first' | 'second') => HTMLElement;
  between: () => HTMLElement;
  editor: () => HTMLElement | null;
  panel: () => HTMLElement | null;
}

function setup(): Harness {
  const fixture = TestBed.createComponent(ScopedHost);
  fixture.detectChanges();

  return {
    fixture,
    host: fixture.componentInstance,
    display: (which) =>
      fixture.nativeElement.querySelector(`.${which} .editable-text__display`) as HTMLElement,
    between: () => fixture.nativeElement.querySelector('.between') as HTMLElement,
    // Session surfaces render in the CDK overlay container (document level).
    editor: () => document.querySelector('.editable-text__editor') as HTMLElement | null,
    panel: () => document.querySelector('.editable-panel') as HTMLElement | null,
  };
}

/** Dispatches an intercepted first edit on a display element to elevate that field. */
async function elevate(h: Harness, which: 'first' | 'second') {
  const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
  Object.defineProperty(event, 'inputType', { value: 'insertText' });
  Object.defineProperty(event, 'data', { value: 'x' });

  h.display(which).dispatchEvent(event);
  h.fixture.detectChanges();
  await h.fixture.whenStable();
  h.fixture.detectChanges();
}

function type(h: Harness, text: string) {
  const editor = h.editor();
  if (!editor) throw new Error('elevated editor not found');

  editor.textContent = text;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  h.fixture.detectChanges();
}

function pressTab(h: Harness, shift = false) {
  const panel = h.panel();
  if (!panel) throw new Error('elevated panel not found');

  panel.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
  );
  h.fixture.detectChanges();
}

// =============================================================================
// Specs
// =============================================================================

describe('EditableScope — Tab-to-accept', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('Tab commits the draft, closes the session, and focuses the next field', async () => {
    const h = setup();
    await elevate(h, 'first');
    type(h, 'alpha edited');

    pressTab(h);

    expect(h.host.first()).toBe('alpha edited');
    expect(h.panel()).toBeNull();
    expect(h.host.sessions).toEqual([{ value: 'alpha edited', changed: true }]);
    expect(document.activeElement).toBe(h.display('second'));
  });

  it('Shift+Tab commits and moves backwards to a bare tab stop', async () => {
    const h = setup();
    await elevate(h, 'first');
    type(h, 'alpha edited');

    pressTab(h, true);

    expect(h.host.first()).toBe('alpha edited');
    expect(h.panel()).toBeNull();
    expect(document.activeElement).toBe(h.between());
  });

  it("an invalid draft under 'revert' snaps back and still advances", async () => {
    const h = setup();
    h.host.firstInvalid.set(true);
    await elevate(h, 'first');
    type(h, 'doomed draft');

    pressTab(h);

    expect(h.host.first()).toBe('alpha');
    expect(h.panel()).toBeNull();
    expect(h.host.sessions).toEqual([{ value: 'alpha', changed: false }]);
    expect(document.activeElement).toBe(h.display('second'));
  });

  it("an invalid draft under 'stay' keeps the session open and refuses the advance", async () => {
    const h = setup();
    h.host.firstInvalid.set(true);
    h.host.onBlocked.set('stay');
    await elevate(h, 'first');
    type(h, 'doomed draft');

    pressTab(h);

    expect(h.host.first()).toBe('doomed draft'); // still the live draft channel
    expect(h.panel()).not.toBeNull();
    expect(h.host.sessions).toEqual([]);
  });

  it('Tab off the last stop parks focus on the settled field (no wrap by default)', async () => {
    const h = setup();
    await elevate(h, 'second');
    type(h, 'last stop');

    pressTab(h);

    expect(h.host.second()).toBe('last stop');
    expect(h.panel()).toBeNull();
    // accept() refocused the display; the refused advance left it there.
    expect(document.activeElement).toBe(h.display('second'));
  });

  it('wraps from the last stop to the first when opted in', async () => {
    const h = setup();
    h.host.wrap.set(true);
    await elevate(h, 'second');
    type(h, 'wrapping');

    pressTab(h);

    expect(document.activeElement).toBe(h.between());
  });

  it("advanceMode 'edit' opens the landed field's session with the editor seeded", async () => {
    const h = setup();
    h.host.advanceMode.set('edit');
    await elevate(h, 'first');
    type(h, 'alpha edited');

    pressTab(h);
    await h.fixture.whenStable();
    h.fixture.detectChanges();

    expect(h.host.first()).toBe('alpha edited');
    expect(h.panel()).not.toBeNull(); // the SECOND field's session
    expect(h.editor()?.textContent).toBe('beta');
  });

  it('describes the Tab behavior to assistive tech inside the panel', async () => {
    const h = setup();
    await elevate(h, 'first');

    const hint = h.panel()?.querySelector('.editable-visually-hidden');
    expect(hint?.textContent).toContain('Tab saves');

    // The hint container is the editor's existing described-by target.
    const editor = h.editor();
    expect(hint?.closest(`#${editor?.getAttribute('aria-describedby')}`)).not.toBeNull();
  });

  it('announces a changed commit politely and a snap-back assertively', async () => {
    const h = setup();
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

    await elevate(h, 'first');
    type(h, 'alpha edited');
    pressTab(h);
    expect(announce).toHaveBeenLastCalledWith('Saved', 'polite');

    h.host.firstInvalid.set(true);
    await elevate(h, 'first');
    type(h, 'doomed draft');
    pressTab(h);
    expect(announce).toHaveBeenLastCalledWith('Not saved — previous value restored', 'assertive');
  });

  it("announces a refused settle under 'stay'", async () => {
    const h = setup();
    h.host.firstInvalid.set(true);
    h.host.onBlocked.set('stay');
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

    await elevate(h, 'first');
    type(h, 'doomed draft');
    pressTab(h);

    expect(announce).toHaveBeenLastCalledWith('Not saved — the value has errors', 'assertive');
  });

  it('an unchanged Tab-settle announces nothing (a non-event stays quiet)', async () => {
    const h = setup();
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

    await elevate(h, 'first');
    type(h, 'alpha'); // back to the baseline: the session settles unchanged
    pressTab(h);

    expect(announce).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(h.display('second'));
  });

  it('a temporal edge Tab drives the scope walk — the landed field opens (seam closed)', async () => {
    @Component({
      imports: [AngularInlineDate, AngularInlineText, EditableScope],
      template: `
        <div editableScope>
          <angular-inline-date [(value)]="day" />
          <angular-inline-text class="after" [(value)]="text" [isSingleLine]="true" />
        </div>
      `,
    })
    class TemporalScopedHost {
      day = signal<string | null>('2026-05-12T00:00:00.000Z');
      text = signal('after');
    }

    const fixture = TestBed.createComponent(TemporalScopedHost);
    fixture.detectChanges();

    const dateInput = fixture.nativeElement.querySelector(
      '.inline-date__input',
    ) as HTMLInputElement;
    dateInput.focus();

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dateInput.dispatchEvent(tab);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The scope owned the landing: the text field's session opened (edit default).
    expect(tab.defaultPrevented).toBe(true);
    expect(document.querySelector('.editable-panel')).not.toBeNull();
    expect(document.querySelector('.editable-text__editor')?.textContent).toBe('after');
  });

  it('a temporal Tab off the LAST stop falls through natively — never a Tab trap', async () => {
    @Component({
      imports: [AngularInlineText, AngularInlineDate, EditableScope],
      template: `
        <div editableScope>
          <angular-inline-text [(value)]="text" [isSingleLine]="true" />
          <angular-inline-date [(value)]="day" />
        </div>
      `,
    })
    class DateLastHost {
      text = signal('before');
      day = signal<string | null>('2026-05-12T00:00:00.000Z');
    }

    const fixture = TestBed.createComponent(DateLastHost);
    fixture.detectChanges();

    const dateInput = fixture.nativeElement.querySelector(
      '.inline-date__input',
    ) as HTMLInputElement;
    dateInput.focus();

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dateInput.dispatchEvent(tab);
    fixture.detectChanges();

    // The walk had nowhere to go (no wrap): the NATIVE Tab must proceed so
    // blur can settle the draft and focus can leave the region.
    expect(tab.defaultPrevented).toBe(false);
  });

  it("a temporal parse-failed draft under 'stay' refuses the Tab and announces", async () => {
    @Component({
      imports: [AngularInlineText, AngularInlineDate, EditableScope],
      template: `
        <div editableScope onBlocked="stay">
          <angular-inline-date [(value)]="day" />
          <angular-inline-text [(value)]="text" [isSingleLine]="true" />
        </div>
      `,
    })
    class DateStayHost {
      day = signal<string | null>('2026-05-12T00:00:00.000Z');
      text = signal('after');
    }

    const fixture = TestBed.createComponent(DateStayHost);
    fixture.detectChanges();
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

    const dateInput = fixture.nativeElement.querySelector(
      '.inline-date__input',
    ) as HTMLInputElement;
    dateInput.focus();
    dateInput.value = 'not a date';
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dateInput.dispatchEvent(tab);
    fixture.detectChanges();

    expect(tab.defaultPrevented).toBe(true); // refused, no advance
    expect(document.querySelector('.editable-panel')).toBeNull(); // text session did NOT open
    expect(announce).toHaveBeenLastCalledWith('Not saved — the value has errors', 'assertive');
  });

  it('a hidden field drops out of the walk (never landed on, never opened)', async () => {
    @Component({
      imports: [AngularInlineText, EditableScope],
      template: `
        <div editableScope advanceMode="focus">
          <angular-inline-text class="first" [(value)]="first" [isSingleLine]="true" />
          <angular-inline-text
            class="ghost"
            [(value)]="ghost"
            [isSingleLine]="true"
            [hidden]="true"
          />
          <angular-inline-text class="third" [(value)]="third" [isSingleLine]="true" />
        </div>
      `,
    })
    class HiddenHost {
      first = signal('alpha');
      ghost = signal('never');
      third = signal('gamma');
    }

    const fixture = TestBed.createComponent(HiddenHost);
    fixture.detectChanges();

    const display = (which: string) =>
      fixture.nativeElement.querySelector(`.${which} .editable-text__display`) as HTMLElement;

    const edit = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
    Object.defineProperty(edit, 'inputType', { value: 'insertText' });
    Object.defineProperty(edit, 'data', { value: 'x' });
    display('first').dispatchEvent(edit);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const panel = document.querySelector('.editable-panel');
    if (!panel) throw new Error('elevated panel not found');
    panel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();

    expect(document.activeElement).toBe(display('third')); // ghost skipped
  });

  it('a composed control (number) inherits Tab-commit through its inner text engine', async () => {
    @Component({
      imports: [AngularInlineNumber, AngularInlineText, EditableScope],
      template: `
        <div editableScope advanceMode="focus">
          <angular-inline-number [(value)]="amount" />
          <angular-inline-text class="after" [(value)]="text" [isSingleLine]="true" />
        </div>
      `,
    })
    class NumberHost {
      amount = signal<number | string | null>(5);
      text = signal('after');
    }

    const fixture = TestBed.createComponent(NumberHost);
    fixture.detectChanges();

    const display = fixture.nativeElement.querySelector(
      'angular-inline-number .editable-text__display',
    ) as HTMLElement;
    const edit = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
    Object.defineProperty(edit, 'inputType', { value: 'insertText' });
    Object.defineProperty(edit, 'data', { value: '7' });
    display.dispatchEvent(edit);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const editor = document.querySelector('.editable-text__editor') as HTMLElement;
    editor.textContent = '42';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    const panel = document.querySelector('.editable-panel');
    if (!panel) throw new Error('elevated panel not found');
    panel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.amount()).toBe(42); // committed as a NUMBER
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('.after .editable-text__display') as HTMLElement,
    );
  });

  it('tabCommits=false leaves Tab alone (the focus trap keeps the panel)', async () => {
    const h = setup();
    h.host.tabCommits.set(false);
    await elevate(h, 'first');
    type(h, 'trapped');

    const panel = h.panel();
    if (!panel) throw new Error('elevated panel not found');
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    panel.dispatchEvent(event);
    h.fixture.detectChanges();

    // Untouched: not consumed by the scope handler, session still open.
    expect(event.defaultPrevented).toBe(false);
    expect(h.panel()).not.toBeNull();
    expect(h.host.sessions).toEqual([]);
  });
});
