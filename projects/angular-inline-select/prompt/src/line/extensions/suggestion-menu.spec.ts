// 3rd Party
import { Schema } from 'prosemirror-model';
import { Command, EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

// Editables
import { SuggestionCommandItem, SuggestionMenuState, createSuggestionMenu, matchSuggestions } from './suggestion-menu';

/**
 * The menu is read from the text: a caret after `/` and a query is a session,
 * its list matched as typed; the arrows, Enter and Escape are the menu's while
 * it shows; picking takes the trigger and query out and runs the item there.
 * A bare schema stands in for a dialect's.
 */
describe('createSuggestionMenu', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      line: { group: 'block', content: 'text*', attrs: { kind: { default: 'text' } }, toDOM: () => ['p', 0] },
      text: {},
    },
  });

  /** An item that marks its line with its id. */
  const item = (id: string, title: string, keywords?: string[]): SuggestionCommandItem => {
    const command: Command = (state, dispatch) => {
      dispatch?.(state.tr.setNodeMarkup(state.selection.$from.before(), undefined, { kind: id }));
      return true;
    };
    return { id, title, keywords, command };
  };
  const ITEMS = [
    item('text', 'Text'),
    item('heading-1', 'Überschrift 1', ['heading']),
    item('heading-2', 'Überschrift 2', ['heading']),
    item('quote', 'Zitat', ['quote']),
  ];

  let view: EditorView;
  let state: SuggestionMenuState;
  let mount: HTMLElement;
  let outside: KeyboardEvent[];

  const type = (text: string) => {
    for (const char of text) view.dispatch(view.state.tr.insertText(char));
  };
  const press = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    return view.someProp('handleKeyDown', (handle) => handle(view, event)) ?? false;
  };
  const kind = () => view.state.doc.firstChild!.attrs['kind'];
  const text = () => view.state.doc.textContent;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    outside = [];
    document.addEventListener('keydown', (event) => outside.push(event));
    const extension = createSuggestionMenu({
      items: () => ITEMS,
      onChange: (next) => (state = next),
      placeholder: () => 'Tippen zum Filtern…',
    });
    view = new EditorView(mount, {
      state: EditorState.create({
        doc: schema.nodes['doc'].create(null, schema.nodes['line'].create()),
        plugins: extension.plugins!({ schema, extensions: [extension] }),
      }),
    });
  });

  afterEach(() => {
    view.destroy();
    mount.remove();
  });

  it('opens on a slash at the start of a line, every item listed, the first lit', () => {
    type('/');
    expect(state.open).toBe(true);
    expect(state.query).toBe('');
    expect(state.items.map((i) => i.id)).toEqual(['text', 'heading-1', 'heading-2', 'quote']);
    expect(state.activeIndex).toBe(0);
    expect(state.range).toEqual({ from: 1, to: 2 });
  });

  it('opens after a space, not inside a word', () => {
    type('und/');
    expect(state.open).toBe(false);
    type(' /');
    expect(state.open).toBe(true);
  });

  it('searches as typed, the title first, then the keywords', () => {
    type('/über');
    expect(state.items.map((i) => i.id)).toEqual(['heading-1', 'heading-2']);
    type('schrift 2');
    expect(state.items.map((i) => i.id)).toEqual(['heading-2']);
  });

  it('closes when nothing matches, and on a space right after the slash', () => {
    type('/xyz');
    expect(state.open).toBe(false);
    view.dispatch(view.state.tr.delete(2, 5));
    expect(state.open).toBe(true);
    type(' ');
    expect(state.open).toBe(false);
  });

  it('walks the list with the arrows, round at the ends, and picks with Enter', () => {
    type('/');
    expect(press('ArrowUp')).toBe(true);
    expect(state.activeIndex).toBe(3);
    press('ArrowDown');
    press('ArrowDown');
    expect(state.activeIndex).toBe(1);
    expect(press('Enter')).toBe(true);
    expect(kind()).toBe('heading-1');
    expect(text()).toBe('');
    expect(state.open).toBe(false);
  });

  it('takes the trigger and the query out, and runs the item there', () => {
    type('Hallo /zit');
    state.select(state.items[0]);
    expect(text()).toBe('Hallo ');
    expect(kind()).toBe('quote');
  });

  it('dismisses on Escape — which never reaches what is around the editor — until the caret leaves', () => {
    type('/');
    expect(press('Escape')).toBe(true);
    expect(state.open).toBe(false);
    expect(outside).toHaveLength(0);
    type('zit');
    expect(state.open).toBe(false);

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    expect(state.open).toBe(true);
  });

  it('leaves the keys alone while closed', () => {
    type('Hallo');
    expect(press('Enter')).toBe(false);
    expect(press('ArrowDown')).toBe(false);
  });

  it('moves the one highlight with the pointer', () => {
    type('/');
    state.highlight(2);
    expect(state.activeIndex).toBe(2);
  });

  it('marks the trigger in the text, with the hint while the query is empty', () => {
    type('/');
    const mark = mount.querySelector('.m-suggestion');
    expect(mark?.textContent).toBe('/');
    expect(mark?.getAttribute('data-hint')).toBe('Tippen zum Filtern…');
    type('z');
    expect(mount.querySelector('.m-suggestion')?.hasAttribute('data-hint')).toBe(false);
  });

  it('matches every word, the title before a keyword', () => {
    expect(matchSuggestions(ITEMS, 'quote').map((i) => i.id)).toEqual(['quote']);
    expect(matchSuggestions(ITEMS, 'zi').map((i) => i.id)).toEqual(['quote']);
    // "Text" starts with it, the rest only hold it: in their given order after.
    expect(matchSuggestions(ITEMS, 't').map((i) => i.id)).toEqual(['text', 'heading-1', 'heading-2', 'quote']);
    expect(matchSuggestions(ITEMS, 'heading').map((i) => i.id)).toEqual(['heading-1', 'heading-2']);
  });

  it('opens anywhere in a word where told, on a query of its own rules, beside another menu', () => {
    let tags!: SuggestionMenuState;
    const second = createSuggestionMenu({
      trigger: '{{',
      startOfWord: false,
      query: /^[^{}]*$/,
      items: () => [item('cf-70', 'Aktenzeichen')],
      onChange: (next) => (tags = next),
    });
    view.updateState(
      view.state.reconfigure({
        plugins: [...view.state.plugins, ...second.plugins!({ schema, extensions: [second] })],
      }),
    );
    type('Az:{{ akten');
    expect(tags.open).toBe(true);
    expect(tags.query).toBe(' akten');
    expect(state.open).toBe(false);
    type('}');
    expect(tags.open).toBe(false);
  });

  it('lists the best matches up to its limit, each section together where its best ranks', () => {
    const sectioned = createSuggestionMenu({
      trigger: '#',
      limit: 3,
      items: () => [
        { ...item('a1', 'Zeile'), section: 'A' },
        { ...item('b1', 'Zitat'), section: 'B' },
        { ...item('a2', 'Zier'), section: 'A' },
        { ...item('b2', 'Zitrone'), section: 'B' },
      ],
      onChange: (next) => (state = next),
    });
    view.updateState(view.state.reconfigure({ plugins: sectioned.plugins!({ schema, extensions: [sectioned] }) }));
    type('#');
    // The first three, B's second gone; A's two together, as A's best leads.
    expect(state.items.map((i) => i.id)).toEqual(['a1', 'a2', 'b1']);
    type('zit');
    expect(state.items.map((i) => i.id)).toEqual(['b1', 'b2']);
  });
});
