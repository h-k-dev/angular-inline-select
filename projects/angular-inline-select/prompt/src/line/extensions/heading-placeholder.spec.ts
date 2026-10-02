// 3rd Party
import { Attrs, Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';

// Editables
import { headingPlaceholderDecorations, HeadingPlaceholderOptions } from './heading-placeholder';

/**
 * An empty heading line says what it is; anything else says nothing. A bare
 * schema stands in for a dialect's: the extension reads the heading kind and
 * depth through the grammar it is given, never through a dialect's own names.
 */
describe('headingPlaceholderDecorations', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      line: {
        group: 'block',
        content: 'text*',
        attrs: { block: { default: 'paragraph' }, depth: { default: null } },
        toDOM: () => ['p', 0],
      },
      text: {},
    },
  });

  const options: HeadingPlaceholderOptions = {
    grammar: {
      heading: 'heading',
      headingDepth: (attrs: Attrs) => (attrs['depth'] as number | null) ?? 1,
    },
    label: () => 'Überschrift',
  };

  const line = (attrs: Attrs, text = '') =>
    schema.nodes['line'].create(attrs, text ? schema.text(text) : null);

  const hints = (...lines: ReturnType<typeof line>[]) =>
    headingPlaceholderDecorations(
      EditorState.create({ doc: schema.nodes['doc'].create(null, lines) }),
      options,
    )
      .find()
      .map((decoration) => ({
        from: decoration.from,
        hint: (decoration as unknown as { type: { attrs: Record<string, string> } }).type.attrs[
          'data-placeholder'
        ],
      }));

  it('names an empty heading by its depth', () => {
    expect(hints(line({ block: 'heading', depth: 1 }))).toEqual([
      { from: 0, hint: 'Überschrift 1' },
    ]);
    expect(hints(line({ block: 'heading', depth: 2 }))).toEqual([
      { from: 0, hint: 'Überschrift 2' },
    ]);
    expect(hints(line({ block: 'heading', depth: 4 }))).toEqual([
      { from: 0, hint: 'Überschrift 4' },
    ]);
  });

  it('names nothing once the heading has text, and never a plain or shaped line', () => {
    expect(hints(line({ block: 'heading', depth: 1 }, 'Titel'))).toEqual([]);
    expect(hints(line({ block: 'paragraph' }))).toEqual([]);
    expect(hints(line({ block: 'bullet' }))).toEqual([]);
  });

  it('finds an empty heading below other lines', () => {
    expect(hints(line({ block: 'paragraph' }, 'ab'), line({ block: 'heading', depth: 2 }))).toEqual(
      [{ from: 4, hint: 'Überschrift 2' }],
    );
  });

  it('reads the label on every redraw', () => {
    let word = 'Heading';
    const live: HeadingPlaceholderOptions = { ...options, label: () => word };
    const state = EditorState.create({
      doc: schema.nodes['doc'].create(null, [line({ block: 'heading', depth: 1 })]),
    });
    const hintOf = () =>
      (
        headingPlaceholderDecorations(state, live).find()[0] as unknown as {
          type: { attrs: Record<string, string> };
        }
      ).type.attrs['data-placeholder'];

    expect(hintOf()).toBe('Heading 1');
    word = 'Überschrift';
    expect(hintOf()).toBe('Überschrift 1');
  });
});
