// Editables
import { readPromptLines, writePromptLines } from './format';
import { parsePromptText, serializePromptDoc } from './codec';

const shapes = (value: string, mode: 'stored' | 'pasted' = 'stored') =>
  readPromptLines(value, mode).map(({ shape, text }) => ({ ...shape, text }));

describe('prompt format', () => {
  /**
   * The contract that matters most: a prompt saved before this editor existed
   * — or written anywhere else — must come back out byte for byte, or merely
   * opening a routine would rewrite its prompts and arm a save nobody asked for.
   */
  describe('reads a stored prompt back exactly', () => {
    const corpus: Record<string, string> = {
      empty: '',
      prose: 'Extrahiere das Aktenzeichen.',
      'blank lines': '\nA\n\n\nB\n',
      'trailing spaces': 'A  \n  B',
      'windows newlines': 'A\r\nB\r\n',
      headings: '# Rolle\nDu bist Jurist.\n## Aufgabe\n###### Tief',
      'empty heading and item': '# \n- \n1. ',
      'heading lookalikes': '#hashtag\n####### sieben\n #eingerückt',
      bullets: '- a\n- b',
      'other bullet characters': '* a\n+ b\n- c',
      numbers: '1. a\n2. b\n3. c',
      'list starting late': '3. a\n4. b',
      'repeated ones': '1. a\n1. b\n1. c',
      'out of order': '1. a\n5. b\n2. c',
      'zero and leading zero': '0. a\n1. b\n07. c',
      'loose list': '1. a\n\n2. b\n\n3. c',
      'broken by prose': '1. a\nText\n1. b',
      'broken by a heading': '1. a\n# H\n2. b',
      'nested under a bullet': '- a\n  - b\n  - c\n- d',
      'nested under a number': '1. a\n   1. b\n   2. c\n2. d\n   - e',
      'nested two spaces under a number': '1. a\n  - b\n  - c',
      'nested under ten': '9. a\n   - b\n10. c\n    - d',
      'third level folds but survives': '- a\n  - b\n    - c',
      'orphan nested item': 'Text\n  - a\n  1. b',
      'nested restarts under each item': '1. a\n   1. x\n   2. y\n2. b\n   1. x',
      'nested out of order': '1. a\n   3. x\n   4. y',
      'not markers': '1.5 kg\n-dash\n1) eins\n2024. Jahr\n> quote',
      'long prompt': [
        '# Rolle',
        'Du bist ein Assistent für eine Kanzlei.',
        '',
        '## Regeln',
        '1. Antworte nur mit dem Wert.',
        '2. Wenn mehrere Daten vorkommen:',
        '   - nimm das späteste',
        '   - ignoriere Fristen',
        '3. Format: `YYYY-MM-DD`',
        '',
        '## Beispiele',
        '- Eingang: 1. März 2024',
        '* Ausgabe: 2024-03-01',
      ].join('\n'),
    };

    for (const [name, value] of Object.entries(corpus)) {
      it(name, () => {
        expect(writePromptLines(readPromptLines(value))).toBe(value);
        expect(serializePromptDoc(parsePromptText(value))).toBe(value);
      });
    }

    // Lines glued together from marker-shaped pieces, seeded so a failure
    // reproduces: the corpus above is what people write, this is what they
    // might.
    it('for any arrangement of marker-shaped pieces', () => {
      const pieces = [
        '',
        ' ',
        '  ',
        '   ',
        '    ',
        '#',
        '# ',
        '### ',
        '- ',
        '* ',
        '+ ',
        '1. ',
        '2. ',
        '3. ',
      ];
      const tails = ['', 'a', ' a', '10. b', '07. c', '1) d', '-e', '# f'];
      let seed = 42;
      const random = (size: number) => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return seed % size;
      };

      for (let round = 0; round < 500; round += 1) {
        const lines = Array.from({ length: 1 + random(8) }, () => {
          const prefix = pieces[random(pieces.length)] + pieces[random(pieces.length)];
          return prefix + tails[random(tails.length)];
        });
        const value = lines.join('\n');
        expect(serializePromptDoc(parsePromptText(value))).toBe(value);
      }
    });
  });

  describe('shapes', () => {
    it('reads a heading of any depth, keeping the depth', () => {
      expect(shapes('# a\n#### b').map(({ block, depth }) => [block, depth])).toEqual([
        ['heading', 1],
        ['heading', 4],
      ]);
    });

    it('counts a list, and keeps a start only where the count breaks', () => {
      expect(shapes('1. a\n2. b\n5. c\n6. d').map(({ number, start }) => [number, start])).toEqual([
        [1, null],
        [2, null],
        [5, 5],
        [6, null],
      ]);
    });

    it('nests an item indented by its parent marker, with no indent kept', () => {
      const [, nested] = shapes('1. a\n   - b');
      expect(nested).toMatchObject({ block: 'bullet', level: 1, indent: null });
    });

    it('keeps an indent that is not the canonical one', () => {
      const [, nested] = shapes('1. a\n  - b');
      expect(nested).toMatchObject({ block: 'bullet', level: 1, indent: 2 });
    });

    it('keeps a bullet character that is not `-`', () => {
      expect(shapes('* a')[0]).toMatchObject({ block: 'bullet', bullet: '*' });
    });

    it('leaves what the format cannot say as text', () => {
      for (const line of ['1) a', '#a', '07. a', '-a']) {
        expect(shapes(line)[0]).toMatchObject({ block: 'paragraph', text: line });
      }
    });
  });

  describe('pasted text', () => {
    it('counts a pasted list from one, whatever it was numbered', () => {
      expect(shapes('3. a\n4. b', 'pasted').map(({ number, start }) => [number, start])).toEqual([
        [1, null],
        [2, null],
      ]);
    });

    it('takes any bullet character and indent as the canonical one', () => {
      const lines = readPromptLines('* a\n    + b', 'pasted');
      expect(writePromptLines(lines)).toBe('- a\n  - b');
    });
  });

  describe('writing', () => {
    it('indents a nested item by its parent marker', () => {
      expect(serializePromptDoc(parsePromptText('9. a\n   - b\n10. c\n    - d'))).toBe(
        '9. a\n   - b\n10. c\n    - d',
      );
    });
  });
});
