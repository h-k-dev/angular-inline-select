import { describe, it, expect } from 'vitest';
import { fallbackTruncate, PREVIEW_ELLIPSIS } from './json-preview';

// `truncateToVisualLines` needs real canvas text metrics (pretext measures
// with Canvas 2D), which jsdom does not provide — it is exercised in the
// browser. The measurement-free fallback is fully testable here.

describe('fallbackTruncate', () => {
  it('returns short text unchanged', () => {
    expect(fallbackTruncate('{"a":1}', 5)).toBe('{"a":1}');
  });

  it('middle-ellipses long text with real head and tail content', () => {
    const huge: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) huge[`key${i}`] = i;
    const text = JSON.stringify(huge);

    const result = fallbackTruncate(text, 5);

    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain(PREVIEW_ELLIPSIS);
    expect(result.startsWith('{"key0":0')).toBe(true);
    expect(result.endsWith('"key4999":4999}')).toBe(true);
  });

  it('scales its budget with maxLines', () => {
    const text = 'x'.repeat(1000);
    const five = fallbackTruncate(text, 5);
    const two = fallbackTruncate(text, 2);
    expect(two.length).toBeLessThan(five.length);
  });
});
