import { ApplicationRef, Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { EDITABLE_DIALOG_DATA, EditableDialog, EditableDialogRef } from './editable-dialog';

interface ProbeData {
  label: string;
  close: (draft: string) => void;
}

/** A minimal session-style content component: injects data + ref like MatDialog. */
@Component({
  template: `
    <p class="probe-label">{{ data.label }}</p>
    <button type="button" class="probe-save" (click)="data.close('draft-text')">save</button>
    <button type="button" class="probe-self-close" (click)="ref.close('self')">self close</button>
  `,
})
class Probe {
  protected data = inject(EDITABLE_DIALOG_DATA) as ProbeData;
  protected ref = inject(EditableDialogRef) as EditableDialogRef<string>;
}

function setup() {
  TestBed.configureTestingModule({});
  const dialog = TestBed.inject(EditableDialog);
  const appRef = TestBed.inject(ApplicationRef);
  // The overlay attaches views to the ApplicationRef (no fixture) — render
  // them explicitly after every open/interaction.
  const tick = () => appRef.tick();
  return { dialog, tick };
}

describe('EditableDialog (service)', () => {
  it('opens a component into the container with backdrop and pane', () => {
    const { dialog, tick } = setup();
    dialog.open(Probe, { ariaLabel: 'Probe dialog', data: { label: 'x', close: () => {} } });
    tick();

    const card = document.querySelector('.editable-dialog');
    expect(card).toBeTruthy();
    expect(card?.getAttribute('role')).toBe('dialog');
    expect(card?.getAttribute('aria-label')).toBe('Probe dialog');
    expect(document.querySelector('.editable-scrim')).toBeTruthy();
    expect(document.querySelector('.editable-dialog-pane')).toBeTruthy();
  });

  it('injects data into the content component (MAT_DIALOG_DATA-style)', () => {
    const { dialog, tick } = setup();
    dialog.open(Probe, { data: { label: 'hello data', close: () => {} } });
    tick();

    expect(document.querySelector('.probe-label')?.textContent).toBe('hello data');
  });

  it('the house pattern: content calls the accept callback passed in data', () => {
    const { dialog, tick } = setup();
    const received: string[] = [];
    const ref = dialog.open<string, ProbeData>(Probe, {
      data: { label: 'x', close: (draft) => received.push(draft) },
    });
    tick();

    (document.querySelector('.probe-save') as HTMLElement).click();

    tick();

    expect(received).toEqual(['draft-text']);
    // The OWNER closes on successful commit — the callback alone does not.
    expect(document.querySelector('.editable-dialog')).toBeTruthy();
    ref.close();
  });

  it('content can close itself through the injected ref; closed resolves with the result', async () => {
    const { dialog, tick } = setup();
    const ref = dialog.open<string>(Probe, { data: { label: 'x', close: () => {} } });
    tick();

    (document.querySelector('.probe-self-close') as HTMLElement).click();

    tick();

    await expect(ref.closed).resolves.toBe('self');
    expect(document.querySelector('.editable-dialog')).toBeNull();
  });

  it('scrim click dismisses — closed resolves undefined', async () => {
    const { dialog, tick } = setup();
    const ref = dialog.open(Probe, { data: { label: 'x', close: () => {} } });
    tick();

    (document.querySelector('.editable-scrim') as HTMLElement).click();

    tick();

    await expect(ref.closed).resolves.toBeUndefined();
    expect(document.querySelector('.editable-dialog')).toBeNull();
  });

  it('Escape inside the dialog dismisses', async () => {
    const { dialog, tick } = setup();
    const ref = dialog.open(Probe, { data: { label: 'x', close: () => {} } });
    tick();

    const card = document.querySelector('.editable-dialog') as HTMLElement;
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await expect(ref.closed).resolves.toBeUndefined();
    expect(document.querySelector('.editable-dialog')).toBeNull();
  });

  it('close(result) resolves closed with the result exactly once', async () => {
    const { dialog, tick } = setup();
    const ref = dialog.open<string>(Probe, { data: { label: 'x', close: () => {} } });
    tick();

    ref.close('the result');
    ref.close('a second close is a no-op');

    await expect(ref.closed).resolves.toBe('the result');
  });

  it('supports multiple sequential dialogs', async () => {
    const { dialog, tick } = setup();

    const first = dialog.open(Probe, { data: { label: 'first', close: () => {} } });

    tick();
    first.close();
    await first.closed;

    dialog.open(Probe, { data: { label: 'second', close: () => {} } });

    tick();
    expect(document.querySelector('.probe-label')?.textContent).toBe('second');
  });
});
