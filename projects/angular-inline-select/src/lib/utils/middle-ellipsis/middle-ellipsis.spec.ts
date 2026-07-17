import { describe, it, expect } from 'vitest';
import { MIDDLE_ELLIPSIS, fallbackTruncate } from './middle-ellipsis';

// `truncateToVisualLines` needs real canvas text metrics (pretext measures
// with Canvas 2D), which jsdom does not provide — it is exercised through
// the JSON control's facade and in the browser. The measurement-free
// fallback is fully testable here.

describe('fallbackTruncate (shared middle-ellipsis core)', () => {
  it('returns short text unchanged', () => {
    expect(fallbackTruncate('short text', 5)).toBe('short text');
  });

  it('middle-ellipses long text — real head, real tail, bounded output', () => {
    const text = `START-${'x'.repeat(5000)}-END`;

    const result = fallbackTruncate(text, 5);

    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain(MIDDLE_ELLIPSIS);
    expect(result.startsWith('START-')).toBe(true);
    expect(result.endsWith('-END')).toBe(true);
  });

  it('scales its budget with maxLines', () => {
    const text = 'y'.repeat(1000);
    expect(fallbackTruncate(text, 2).length).toBeLessThan(fallbackTruncate(text, 5).length);
  });
});
