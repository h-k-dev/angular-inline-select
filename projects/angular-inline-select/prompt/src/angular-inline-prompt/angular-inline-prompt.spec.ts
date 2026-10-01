import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { AngularInlinePrompt } from './angular-inline-prompt';

describe('AngularInlinePrompt', () => {
  let fixture: ComponentFixture<AngularInlinePrompt>;
  let component: AngularInlinePrompt;

  const host = () => fixture.nativeElement as HTMLElement;
  const isLive = () => host().classList.contains('ProseMirror');
  const lines = () =>
    Array.from(host().children).map((line) =>
      [
        line.getAttribute('data-block') ?? 'paragraph',
        line.getAttribute('data-number'),
        line.textContent,
      ].filter((part) => part !== null),
    );

  const setValue = async (value: string) => {
    fixture.componentRef.setInput('value', value);
    await fixture.whenStable();
  };

  /**
   * jsdom's Range has no geometry, and a command that scrolls the caret into
   * view measures it through `Range.getClientRects()`. Inert stand-ins where a
   * host's test setup has not already provided them: an empty rect list and a
   * zero rect, the answer jsdom gives for an element.
   */
  beforeAll(() => {
    if (typeof Range.prototype.getClientRects === 'function') return;
    Range.prototype.getClientRects = () =>
      ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: [][Symbol.iterator],
      }) as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AngularInlinePrompt] }).compileComponents();
    fixture = TestBed.createComponent(AngularInlinePrompt);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('draws the prompt as static lines at rest, with no view', async () => {
    await setValue('# Rolle\n1. a\n2. b');

    expect(isLive()).toBe(false);
    expect(host().getAttribute('contenteditable')).toBeNull();
    expect(lines()).toEqual([
      ['heading', 'Rolle'],
      ['number', '1', 'a'],
      ['number', '2', 'b'],
    ]);
  });

  it('keeps an empty line one line tall at rest, the way the view does', async () => {
    await setValue('a\n\nb');
    expect(host().children[1].innerHTML).toBe('<br class="ProseMirror-trailingBreak">');
  });

  it('mounts a view on focus and gives it back on blur, drawing the same lines', async () => {
    await setValue('- a\n  - b');
    const atRest = host().innerHTML;

    host().focus();
    await fixture.whenStable();
    expect(isLive()).toBe(true);
    expect(host().getAttribute('contenteditable')).toBe('true');

    host().blur();
    await Promise.resolve();
    await fixture.whenStable();
    expect(isLive()).toBe(false);
    expect(host().getAttribute('contenteditable')).toBeNull();
    expect(host().innerHTML).toBe(atRest);
  });

  it('does not mount while disabled or readonly', async () => {
    await setValue('a');
    fixture.componentRef.setInput('readonly', true);
    await fixture.whenStable();

    host().focus();
    await fixture.whenStable();
    expect(isLive()).toBe(false);
  });

  it('writes what is typed back as Markdown', async () => {
    await setValue('');
    host().focus();
    await fixture.whenStable();

    typeInto('# Regeln');
    press('Enter');
    typeInto('1. eins');
    press('Enter');
    typeInto('zwei');
    press('Enter');
    press('Tab');
    typeInto('- unter');
    await fixture.whenStable();

    expect(component.value()).toBe('# Regeln\n1. eins\n2. zwei\n   - unter');
  });

  it('renumbers a list when an item is added in the middle', async () => {
    await setValue('1. a\n2. b\n3. c');
    host().focus();
    await fixture.whenStable();

    // Caret to the end of the first item, then a new item.
    const pm = currentView();
    pm.dispatch(pm.state.tr.setSelection(TextSelection.create(pm.state.doc, 1 + 'a'.length)));

    press('Enter');
    typeInto('neu');
    await fixture.whenStable();

    expect(component.value()).toBe('1. a\n2. neu\n3. b\n4. c');
  });

  describe('Backspace right after a marker fired', () => {
    beforeEach(async () => {
      await setValue('');
      host().focus();
      await fixture.whenStable();
    });

    for (const marker of ['-', '1.', '#', '###']) {
      it(`gives \`${marker} \` back as \`${marker}\`, and a space fires it again`, async () => {
        typeInto(`${marker} `);
        await fixture.whenStable();
        expect(host().children[0].hasAttribute('data-block')).toBe(true);

        press('Backspace');
        await fixture.whenStable();
        expect(host().children[0].hasAttribute('data-block')).toBe(false);
        expect(component.value()).toBe(marker);

        typeInto(' ');
        await fixture.whenStable();
        expect(host().children[0].hasAttribute('data-block')).toBe(true);
      });
    }

    // Autocorrect, an IME or dictation can deliver the marker and its space as
    // one piece of input; neither was ever in the document.
    it('gives a marker that arrived in one piece back without its space', async () => {
      const pm = currentView();
      const { from, to } = pm.state.selection;
      pm.someProp('handleTextInput', (f) =>
        f(pm, from, to, '- ', () => pm.state.tr.insertText('- ', from, to)),
      );
      expect(host().children[0].getAttribute('data-block')).toBe('bullet');

      press('Backspace');
      await fixture.whenStable();
      expect(component.value()).toBe('-');
    });

    it('lets the writer carry on as text', async () => {
      typeInto('1. ');
      press('Backspace');
      typeInto('5 kg');
      await fixture.whenStable();

      expect(component.value()).toBe('1.5 kg');
    });

    it('gives a nested marker back with its indent', async () => {
      typeInto('  - ');
      press('Backspace');
      await fixture.whenStable();

      expect(component.value()).toBe('  -');
    });

    // Typed into a line that already was an item, the marker re-shaped that
    // item; Backspace gives the item back as it was, with the marker as text.
    it('gives a re-shaped item back as it was', async () => {
      typeInto('- a');
      press('Enter');
      typeInto('1. ');
      press('Backspace');
      await fixture.whenStable();

      expect(component.value()).toBe('- a\n- 1.');
    });
  });

  it('leaves a stored prompt untouched by mounting and unmounting', async () => {
    const stored = '* a\n1. x\n1. y\n  - eingerückt';
    await setValue(stored);

    host().focus();
    await fixture.whenStable();
    host().blur();
    await Promise.resolve();
    await fixture.whenStable();

    expect(component.value()).toBe(stored);
  });

  /**
   * Types through the editable the way keystrokes arrive: `beforeinput` is
   * not available in jsdom, so this goes through the view's text-input hook,
   * which is where input rules fire.
   */
  function typeInto(text: string) {
    const pm = currentView();
    for (const char of text) {
      const { from, to } = pm.state.selection;
      const handled = pm.someProp('handleTextInput', (f) =>
        f(pm, from, to, char, () => pm.state.tr.insertText(char, from, to)),
      );
      if (!handled) pm.dispatch(pm.state.tr.insertText(char, from, to));
    }
  }

  function press(key: string) {
    const pm = currentView();
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    pm.someProp('handleKeyDown', (f) => f(pm, event));
  }

  function currentView(): EditorView {
    const pm = component.editor()?.view;
    if (!pm) throw new Error('no live view');
    return pm;
  }
});
