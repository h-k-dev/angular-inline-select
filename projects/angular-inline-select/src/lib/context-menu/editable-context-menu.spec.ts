import { TestBed } from '@angular/core/testing';

import { EditableContextMenu } from './editable-context-menu';
import { provideEditableContextMenu } from './editable-context-menu-config';
import { EditableTextIntl } from '../angular-inline-text/editable-text-intl';

describe('EditableContextMenu', () => {
  let anchor: HTMLButtonElement;
  let edit: ReturnType<typeof vi.fn<() => void>>;
  let clear: ReturnType<typeof vi.fn<() => void>>;

  const menu = () => document.querySelector<HTMLElement>('.editable-context-menu');
  const rows = () => [
    ...document.querySelectorAll<HTMLButtonElement>('.editable-context-menu__item'),
  ];

  const pointer = (init: MouseEventInit = {}) =>
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 40,
      clientY: 60,
      ...init,
    });

  const key = (name: string) => {
    menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    TestBed.tick();
  };

  function open(event: Event = pointer(), clearLabel?: string) {
    const opened = TestBed.inject(EditableContextMenu).open(event, {
      anchor,
      edit,
      clear,
      clearLabel,
    });
    TestBed.tick();
    return opened;
  }

  beforeEach(() => {
    anchor = document.createElement('button');
    document.body.append(anchor);
    edit = vi.fn<() => void>();
    clear = vi.fn<() => void>();
  });

  afterEach(() => {
    if (menu()) key('Escape');
    anchor.remove();
  });

  it('opens Edit then Clear, takes the gesture, and holds the keyboard', () => {
    const event = pointer();

    expect(open(event)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(menu()!.getAttribute('role')).toBe('menu');
    expect(rows().map((row) => [row.getAttribute('role'), row.textContent?.trim()])).toEqual([
      ['menuitem', 'Edit'],
      ['menuitem', 'Clear'],
    ]);
    expect(document.activeElement).toBe(menu());
  });

  it('opened by the pointer, no row looks picked until one is reached', () => {
    open();
    expect(rows().map((row) => row.getAttribute('data-active'))).toEqual(['false', 'false']);

    key('ArrowDown');
    expect(rows().map((row) => row.getAttribute('data-active'))).toEqual(['true', 'false']);
    expect(menu()!.getAttribute('aria-activedescendant')).toBe(rows()[0].id);
  });

  it('opened from the keyboard (no pointer), the first row starts active', () => {
    open(pointer({ clientX: 0, clientY: 0 }));

    expect(rows().map((row) => row.getAttribute('data-active'))).toEqual(['true', 'false']);
  });

  it('arrows wrap, Enter runs the active row and closes', () => {
    open();
    key('ArrowUp');
    expect(rows()[1].getAttribute('data-active')).toBe('true');

    key('Enter');

    expect(clear).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it('a click on a row runs it and closes', () => {
    open();

    rows()[0].click();
    TestBed.tick();

    expect(edit).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it('Escape dismisses, runs nothing, and gives focus back', () => {
    anchor.focus();
    open();
    expect(document.activeElement).toBe(menu());

    key('Escape');

    expect(menu()).toBeNull();
    expect(edit).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(anchor);
  });

  it("a press elsewhere dismisses; the right button's own release does not", () => {
    open();

    document.body.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    TestBed.tick();
    expect(menu()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    TestBed.tick();
    expect(menu()).toBeNull();
    expect(clear).not.toHaveBeenCalled();
  });

  it('a second gesture replaces the open menu — there is one for the page', () => {
    open();
    open(pointer(), 'Clear end time');

    expect(document.querySelectorAll('.editable-context-menu').length).toBe(1);
    expect(rows()[1].textContent?.trim()).toBe('Clear end time');
  });

  it("takes a hover scope's forwarded point", () => {
    const forwarded = new CustomEvent('editableScopeContextMenu', {
      detail: { clientX: 5, clientY: 5 },
      cancelable: true,
    });

    expect(open(forwarded)).toBe(true);
    expect(forwarded.defaultPrevented).toBe(true);
    // A point, so not a keyboard gesture.
    expect(rows()[0].getAttribute('data-active')).toBe('false');
  });

  it("the rows speak the app's language (EditableTextIntl)", () => {
    const intl = TestBed.inject(EditableTextIntl);
    intl.editLabel.set('Bearbeiten');
    intl.clearLabel.set('Leeren');

    open();

    expect(rows().map((row) => row.textContent?.trim())).toEqual(['Bearbeiten', 'Leeren']);
  });

  it('the Clear row wears the danger tone; without an icon font the rows are text only', () => {
    open();

    expect(
      rows().map((row) => row.classList.contains('editable-context-menu__item--danger')),
    ).toEqual([false, true]);
    expect(document.querySelector('.editable-context-menu__icon')).toBeNull();
  });

  it("rows lead with an icon in the app's icon font (iconFontClass)", () => {
    TestBed.configureTestingModule({
      providers: [
        provideEditableContextMenu(() => ({ enabled: () => true, iconFontClass: 'my-icon-font' })),
      ],
    });

    open();

    const icons = [...document.querySelectorAll('.editable-context-menu__icon')];
    expect(
      icons.map((icon) => [icon.textContent?.trim(), icon.getAttribute('aria-hidden')]),
    ).toEqual([
      ['edit', 'true'],
      ['close', 'true'],
    ]);
    expect(icons.every((icon) => icon.classList.contains('my-icon-font'))).toBe(true);
    // The icon is decoration: the row still reads as its label.
    expect(
      [...document.querySelectorAll('.editable-context-menu__label')].map((l) =>
        l.textContent?.trim(),
      ),
    ).toEqual(['Edit', 'Clear']);
  });

  describe('switched off (provideEditableContextMenu)', () => {
    let enabled = false;

    beforeEach(() => {
      enabled = false;
      TestBed.configureTestingModule({
        providers: [provideEditableContextMenu(() => ({ enabled: () => enabled }))],
      });
    });

    it('does nothing at all: no menu, no preventDefault', () => {
      const event = pointer();

      expect(open(event)).toBe(false);

      expect(event.defaultPrevented).toBe(false);
      expect(menu()).toBeNull();
      expect(TestBed.inject(EditableContextMenu).enabled).toBe(false);
    });

    it('asks again on every gesture, so the answer can follow the viewport', () => {
      expect(open()).toBe(false);

      enabled = true;

      expect(open()).toBe(true);
    });
  });
});
