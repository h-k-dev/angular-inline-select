// Editables
import { copyPrompt, promptLinesToDOM } from './clipboard';
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

describe('copyPrompt', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const originalItem = (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
  let write: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    write = vi.fn(async () => undefined);
    writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { write, writeText },
      configurable: true,
    });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
      constructor(readonly items: Record<string, Blob>) {}
    };
  });

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else delete (navigator as { clipboard?: unknown }).clipboard;
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = originalItem;
  });

  it('writes the Markdown and the lines as HTML, as a copy by hand does', async () => {
    expect(await copyPrompt('# Rolle\n- a', document)).toBe(true);

    const [[[item]]] = write.mock.calls as [[[{ items: Record<string, Blob> }]]];
    expect(await item.items['text/plain'].text()).toBe('# Rolle\n- a');
    expect(await item.items['text/html'].text()).toBe('<h1>Rolle</h1><ul><li>a</li></ul>');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('writes the Markdown alone where the rich write is refused', async () => {
    write.mockRejectedValue(new Error('NotAllowedError'));

    expect(await copyPrompt('- a', document)).toBe(true);
    expect(writeText).toHaveBeenCalledWith('- a');
  });

  it('says so when nothing could be written', async () => {
    write.mockRejectedValue(new Error('NotAllowedError'));
    writeText.mockRejectedValue(new Error('NotAllowedError'));

    expect(await copyPrompt('- a', document)).toBe(false);
  });
});
