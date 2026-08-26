/**
 * Family gesture conformance — the CROSS-CONTROL contract, pinned.
 *
 * Every control already has a spec that covers its own behaviour in depth,
 * and `editable-scope.spec.ts` pins the Tab floor for the text engine (text,
 * number) and for one temporal control (date). What nothing covered until
 * now is the FAMILY view: the same gesture asserted against every control
 * that shares an engine, so a divergence shows up as a failing pin instead
 * of surviving unnoticed — which is exactly how the date control drifted
 * away from text's two-stage Escape, and how a keyboard-only calendar-pick
 * bug hid behind that drift.
 *
 * This suite is a CHARACTERIZATION harness. It asserts what the controls do
 * TODAY, not what they arguably should do. Where they legitimately differ,
 * the difference is DATA in the case table (see `escapePressesToRevert`) so
 * the divergence is visible at a glance rather than buried in prose. Nothing
 * here changes a control; its whole job is to make the next drift fail CI.
 *
 * Scope: the NATIVE-INPUT engine (date, time, duration), whose keydown
 * handlers are near-identical by construction, plus a characterization of
 * phone — which composes the text engine and, as the pins below establish,
 * INHERITS its Tab-commit rather than standing outside the scheme. Duration
 * had no Tab coverage anywhere before this file. Text and number are absent:
 * their
 * gestures are already pinned in `editable-scope.spec.ts`, and their session
 * lives in a portaled dialog over a contenteditable, so folding them in here
 * would mean a harness of conditionals rather than shared assertions. JSON
 * is absent for the same reason and by its own design — a modal is a
 * deliberate stop (see `angular-inline-json.ts`).
 *
 * Assertions are RELATIVE to a baseline captured from the DOM at setup, not
 * against hard-coded display strings. That keeps each case to a few lines
 * and keeps the suite about invariants rather than about formatting.
 */

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import metadata from 'libphonenumber-js/metadata.min.json';
import examples from 'libphonenumber-js/examples.mobile.json';

import {
  AngularInlineDate,
  AngularInlineTime,
  AngularInlineDuration,
  composeDbEntry,
  dayToDbEntry,
} from 'angular-inline-select/temporal';
import { AngularInlinePhone } from 'angular-inline-select/phone';
import { createLibphonenumberCodec } from '../../phone/src/libphonenumber-codec';

import { EditableScope, type EditableScopeBlockedPolicy } from './utils/editable-scope/editable-scope';

const phoneCodec = createLibphonenumberCodec(metadata, examples);

/** The one field of a `saved` payload this suite cares about, across controls. */
interface Settlement {
  changed: boolean;
}

// =============================================================================
// Host — the three native-input controls in ONE scope, in DOM order, with a
// bare tabbable last. A Tab-advance therefore has a real next stop for every
// case, and the walk crosses control TYPES the way a mixed grid does.
// =============================================================================

@Component({
  imports: [AngularInlineDate, AngularInlineTime, AngularInlineDuration, EditableScope],
  template: `
    <div editableScope [tabCommits]="tabCommits()" [onBlocked]="onBlocked()">
      <angular-inline-date [(value)]="dateValue" locale="en" (saved)="dateSaved.push($event)" />
      <angular-inline-time [(value)]="timeValue" locale="en-u-hc-h23" (saved)="timeSaved.push($event)" />
      <angular-inline-duration [(value)]="durationValue" [step]="60" (saved)="durationSaved.push($event)" />
      <input class="after" type="text" />
    </div>
  `,
})
class NativeEngineHost {
  dateValue = signal<string | null>(dayToDbEntry('2026-05-12'));
  timeValue = signal<string | null>(composeDbEntry('2026-05-12', '09:30'));
  durationValue = signal<number | null>(5400);

  dateSaved: Settlement[] = [];
  timeSaved: Settlement[] = [];
  durationSaved: Settlement[] = [];

  tabCommits = signal(true);
  onBlocked = signal<EditableScopeBlockedPolicy>('revert');
}

// =============================================================================
// The case table — one row per control, and the row IS the record of where
// that control differs from its siblings.
// =============================================================================

interface NativeCase {
  name: string;
  /** Selector for the control's own real <input>. */
  inputSelector: string;
  /** A draft the codec reads, and that differs from the seeded value. */
  validDraft: string;
  /** A draft the codec cannot read at all. */
  invalidDraft: string;
  /** The `saved` emissions the host has seen for this control. */
  settlements: (host: NativeEngineHost) => Settlement[];
  /**
   * PINNED DIVERGENCE — how many Escape presses it takes to revert a draft.
   *
   * Date is 2: its panel is summoned chrome, so the first press peels the
   * panel and the second reverts (the house two-stage Escape, matching the
   * text control's slash menu). Time and duration are 1: their panel only
   * ever carries an error, which is feedback rather than summoned chrome and
   * does not survive the revert, so it costs no press.
   */
  escapePressesToRevert: number;
}

const NATIVE_CASES: NativeCase[] = [
  {
    name: 'date',
    inputSelector: '.inline-date__input',
    validDraft: '24.12.2026',
    invalidDraft: 'not a date',
    settlements: (host) => host.dateSaved,
    escapePressesToRevert: 2,
  },
  {
    name: 'time',
    inputSelector: '.inline-time__input',
    validDraft: '21:45',
    invalidDraft: 'half past nonsense',
    settlements: (host) => host.timeSaved,
    escapePressesToRevert: 1,
  },
  {
    name: 'duration',
    inputSelector: '.inline-duration__input',
    validDraft: '0:45',
    invalidDraft: 'ages',
    settlements: (host) => host.durationSaved,
    escapePressesToRevert: 1,
  },
];

// =============================================================================
// Harness
// =============================================================================

interface Harness {
  fixture: ComponentFixture<NativeEngineHost>;
  host: NativeEngineHost;
  input: HTMLInputElement;
  /** The committed display at setup — every assertion is relative to it. */
  baseline: string;
}

function setup(testCase: NativeCase): Harness {
  const fixture = TestBed.createComponent(NativeEngineHost);
  fixture.detectChanges();

  const input = fixture.nativeElement.querySelector(testCase.inputSelector) as HTMLInputElement;
  if (!input) throw new Error(`no input for ${testCase.name} (${testCase.inputSelector})`);

  return {
    fixture,
    host: fixture.componentInstance,
    input,
    baseline: input.value,
  };
}

/**
 * The settlement cadence, reduced to what is FAMILY-wide: how many `saved`
 * emissions, and what each claimed about having changed anything. Payload
 * shape is per-control (time adds `side`, `dayOverflow`, `explicitDay`) and
 * is each control's own spec to assert — a cross-control pin that reached
 * into it would break on any control gaining a field.
 */
function changedFlags(testCase: NativeCase, h: Harness): boolean[] {
  return testCase.settlements(h.host).map((settlement) => settlement.changed);
}

function type(h: Harness, text: string) {
  h.input.focus();
  h.fixture.detectChanges();
  h.input.value = text;
  h.input.dispatchEvent(new Event('input', { bubbles: true }));
  h.fixture.detectChanges();
}

function press(h: Harness, key: string, options: KeyboardEventInit = {}) {
  h.input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
  h.fixture.detectChanges();
}

/** Focus settlement runs a macrotask behind (`setTimeout(0)`) — flush it. */
async function settle(h: Harness) {
  h.fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  h.fixture.detectChanges();
}

async function blurAway(h: Harness) {
  h.input.blur();
  await settle(h);
}

// =============================================================================
// The native-input engine
// =============================================================================

describe.each(NATIVE_CASES)('gesture conformance — $name', (testCase) => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  // -- blur: navigation, never a validity checkpoint --------------------------

  it('blur COMMITS a readable draft', async () => {
    const h = setup(testCase);

    type(h, testCase.validDraft);
    await blurAway(h);

    expect(h.input.value).not.toBe(h.baseline);
    expect(changedFlags(testCase, h)).toEqual([true]);
  });

  it('blur SNAPS BACK an unreadable draft — and never blocks', async () => {
    const h = setup(testCase);

    type(h, testCase.invalidDraft);
    await blurAway(h);

    expect(h.input.value).toBe(h.baseline);
    // The floor: focus is gone from the field regardless of validity.
    expect(document.activeElement).not.toBe(h.input);
  });

  // -- Escape: peels one layer per press --------------------------------------

  it(`reverts a draft on Escape press ${testCase.escapePressesToRevert}, not before`, () => {
    const h = setup(testCase);
    type(h, testCase.validDraft);

    // Every press before the last must leave the draft ALONE.
    for (let i = 1; i < testCase.escapePressesToRevert; i++) {
      press(h, 'Escape');
      expect(h.input.value).toBe(testCase.validDraft);
    }

    press(h, 'Escape');
    expect(h.input.value).toBe(h.baseline);
  });

  it('Escape settles ONCE and reports `changed: false`', async () => {
    // Not "emits nothing": the family cadence is one emission per settled
    // session, changed or not, so a consumer can distinguish a no-op
    // settlement from silence. The `changed` flag is what has to tell the
    // truth — and a revert never changed anything.
    const h = setup(testCase);

    h.input.focus();
    h.fixture.detectChanges();
    for (let i = 0; i < testCase.escapePressesToRevert; i++) press(h, 'Escape');
    await settle(h);

    expect(changedFlags(testCase, h)).toEqual([false]);
    expect(h.input.value).toBe(h.baseline);
  });

  it('CURRENT BEHAVIOUR: Escape is swallowed even with NOTHING left to peel', () => {
    // Pinned, not endorsed — the family's accepted divergence, recorded so
    // that changing it has to be a decision rather than a drift.
    //
    // The press under test is one PAST the last one that does anything: the
    // panel is already dismissed and the draft already reverted, so there is
    // no layer left to cancel. The control still stops propagation, which
    // means one of these fields inside a dialog eats the Escape and the
    // dialog will not close. Fixing it means touching all three, which is
    // why it stands for now.
    const h = setup(testCase);
    h.input.focus();
    h.fixture.detectChanges();
    for (let i = 0; i < testCase.escapePressesToRevert; i++) press(h, 'Escape');

    let reachedAncestor = false;
    const listener = () => (reachedAncestor = true);
    document.addEventListener('keydown', listener);
    try {
      press(h, 'Escape'); // nothing left to cancel
    } finally {
      document.removeEventListener('keydown', listener);
    }

    expect(reachedAncestor).toBe(false);
  });

  // -- Tab: leaves, settles everything, exactly one press ---------------------

  it('Tab COMMITS a readable draft and advances in ONE press', async () => {
    const h = setup(testCase);

    type(h, testCase.validDraft);
    press(h, 'Tab');
    // The Tab OWNS the focus move; the settle then completes through the
    // normal focusout path, which is a macrotask behind.
    await settle(h);

    expect(h.input.value).not.toBe(h.baseline);
    expect(changedFlags(testCase, h)).toEqual([true]);
    expect(document.activeElement).not.toBe(h.input);
  });

  it("Tab on an unreadable draft under 'revert' snaps back and STILL advances", async () => {
    const h = setup(testCase);

    type(h, testCase.invalidDraft);
    press(h, 'Tab');
    await settle(h);

    expect(h.input.value).toBe(h.baseline);
    // WCAG 2.1.2: navigation is never a validity checkpoint.
    expect(document.activeElement).not.toBe(h.input);
  });

  it("Tab on an unreadable draft under 'stay' refuses the advance (opt-in policy)", () => {
    const h = setup(testCase);
    h.host.onBlocked.set('stay');
    h.fixture.detectChanges();

    type(h, testCase.invalidDraft);
    press(h, 'Tab');

    // The one deliberate inversion of the Tab rule — mat submit semantics.
    // Escape remains the keyboard way out, which is why it must stay rare.
    expect(document.activeElement).toBe(h.input);
  });
});

// =============================================================================
// Phone — characterization only.
//
// Phone composes the text engine rather than hosting a native input, so the
// open question is whether it INHERITS the engine's gestures the way number
// does (see "a composed control (number) inherits Tab-commit through its
// inner text engine" in editable-scope.spec.ts) or whether it wires none of
// its own. These pins record the answer either way.
// =============================================================================

@Component({
  imports: [AngularInlinePhone, EditableScope],
  template: `
    <div editableScope [tabCommits]="true">
      <angular-inline-phone [(value)]="value" [codec]="codec" defaultCountry="DE" />
      <input class="after" type="text" />
    </div>
  `,
})
class PhoneScopeHost {
  codec = phoneCodec;
  value = signal<string | null>('+491712345678');
}

describe('gesture conformance — phone (characterization)', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('renders on the TEXT engine, not a native input', () => {
    // Why phone is characterized separately rather than joining the table
    // above: there is no `<input>` to drive. Its value surface is the text
    // control's contenteditable display, which is also why its gestures can
    // only come from the engine beneath it.
    const fixture = TestBed.createComponent(PhoneScopeHost);
    fixture.detectChanges();

    const host = fixture.nativeElement.querySelector('angular-inline-phone') as HTMLElement;
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('.editable-text__display')).not.toBeNull();
  });

  it('INHERITS Tab-commit from the text engine — it is not outside the scheme', async () => {
    // The audit said phone has no Tab wiring of its own, which was true and
    // misleading: like number, it composes `angular-inline-text`, and the
    // engine's Tab-commit comes with it. Pinned so the distinction survives
    // — phone needs no Tab work; what it genuinely lacks is an Escape-revert
    // on its own value surface, which is the engine's `cancel()` to give.
    const fixture = TestBed.createComponent(PhoneScopeHost);
    fixture.detectChanges();

    const display = fixture.nativeElement.querySelector('.editable-text__display') as HTMLElement;

    // Elevate the way the engine does: an intercepted first edit.
    const event = new Event('beforeinput', { bubbles: true, cancelable: true }) as InputEvent;
    Object.defineProperty(event, 'inputType', { value: 'insertText' });
    Object.defineProperty(event, 'data', { value: '9' });
    display.dispatchEvent(event);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const panel = document.querySelector('.editable-panel');
    expect(panel).not.toBeNull(); // the engine's session opened

    panel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    // The engine owned the Tab: the session settled rather than the panel
    // trapping focus and cycling its own actions.
    expect(document.querySelector('.editable-panel')).toBeNull();
  });
});
