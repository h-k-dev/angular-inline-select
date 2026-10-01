// Editables
import { promptLinesToDOM } from './clipboard';
import { readPromptLines } from './format';

const html = (markdown: string) => {
  const host = document.createElement('div');
  host.appendChild(promptLinesToDOM(readPromptLines(markdown), document));
  return host.innerHTML;
};

describe('promptLinesToDOM', () => {
  it('writes a heading as the heading element of its depth', () => {
    expect(html('# Rolle\n### Tief')).toBe('<h1>Rolle</h1><h3>Tief</h3>');
  });

  it('writes consecutive items as one list, and prose and empty lines as paragraphs', () => {
    expect(html('- a\n- b\n\nText')).toBe('<ul><li>a</li><li>b</li></ul><p></p><p>Text</p>');
  });

  it('nests the second level inside the item above it', () => {
    expect(html('1. a\n   - x\n   - y\n2. b')).toBe(
      '<ol><li>a<ul><li>x</li><li>y</li></ul></li><li>b</li></ol>',
    );
  });

  it('says where a numbered list starts when it is not at one', () => {
    expect(html('3. c\n4. d')).toBe('<ol start="3"><li>c</li><li>d</li></ol>');
    // A loose list goes on counting across the empty line.
    expect(html('1. a\n\n2. b')).toBe('<ol><li>a</li></ol><p></p><ol start="2"><li>b</li></ol>');
  });

  it('starts a new list where the kind changes', () => {
    expect(html('- a\n1. b')).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
  });

  it('keeps a nested item with nothing above it as a list of its own', () => {
    expect(html('Text\n  - a')).toBe('<p>Text</p><ul><li>a</li></ul>');
  });

  it('writes text as text, never as markup', () => {
    expect(html('- <b>nicht fett</b>')).toBe('<ul><li>&lt;b&gt;nicht fett&lt;/b&gt;</li></ul>');
  });
});
