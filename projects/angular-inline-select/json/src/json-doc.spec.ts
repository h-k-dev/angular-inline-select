import { describe, it, expect } from 'vitest';
import { previewJsonLines, printEditableJson, printJson, type JsonValue } from './json-doc';
import { parseJsonDraft } from './json-codec';

describe('printJson', () => {
  it('pretty-prints with 2-space indent, always expanded', () => {
    expect(printJson({ a: 1, b: [1, 2] })).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  });

  it('round-trips primitive typing', () => {
    const value = { n: 42, s: 'hi', b: true, nil: null };
    expect(JSON.parse(printJson(value))).toEqual(value);
  });
});

describe('printEditableJson — the bare-key editing form', () => {
  it('prints identifier keys without quotes', () => {
    expect(printEditableJson({ role: 'admin', active: true })).toBe(
      '{\n  role: "admin",\n  active: true\n}',
    );
  });

  it('keeps quoting keys that are not valid identifiers', () => {
    expect(printEditableJson({ 'a-b': 1, '1x': 2, 'has space': 3 })).toBe(
      '{\n  "a-b": 1,\n  "1x": 2,\n  "has space": 3\n}',
    );
  });

  it('nests and matches printJson layout otherwise', () => {
    expect(printEditableJson({ a: { b: [1, 2] } })).toBe('{\n  a: {\n    b: [\n      1,\n      2\n    ]\n  }\n}');
  });

  it('prints empty containers compactly', () => {
    expect(printEditableJson({})).toBe('{}');
    expect(printEditableJson([])).toBe('[]');
  });

  it('round-trips through the codec back to the same value', () => {
    const value: JsonValue = { role: 'admin', 'a-b': 1, nested: { list: [1, 'x', null] } };
    expect(parseJsonDraft(printEditableJson(value)).value).toEqual(value);
  });
});

describe('previewJsonLines — flat cases', () => {
  it('renders a small flat object on one line', () => {
    const result = previewJsonLines({ a: 1, b: 2 });
    expect(result.truncated).toBe(false);
    expect(result.lines).toEqual(['{ "a": 1, "b": 2 }']);
  });

  it('renders scalars on one line regardless of maxLines', () => {
    expect(previewJsonLines('hello').lines).toEqual(['"hello"']);
    expect(previewJsonLines(42).lines).toEqual(['42']);
    expect(previewJsonLines(true).lines).toEqual(['true']);
    expect(previewJsonLines(null).lines).toEqual(['null']);
  });

  it('preserves native primitive typing — numbers unquoted, strings quoted', () => {
    const result = previewJsonLines({ count: 5, label: '5' });
    expect(result.lines[0]).toContain('"count": 5');
    expect(result.lines[0]).toContain('"label": "5"');
  });

  it('renders empty containers compactly', () => {
    expect(previewJsonLines({}).lines).toEqual(['{}']);
    expect(previewJsonLines([]).lines).toEqual(['[]']);
  });
});

describe('previewJsonLines — expands when it fits within budget, no ellipsis', () => {
  it('expands a small object that does not flatten within flatWidth', () => {
    const value = { longKeyNameOne: 'a fairly long value string', longKeyNameTwo: 2 };
    const result = previewJsonLines(value, { flatWidth: 20, maxLines: 5 });
    expect(result.truncated).toBe(false);
    expect(result.lines).toEqual([
      '{',
      '  "longKeyNameOne": "a fairly long value string",',
      '  "longKeyNameTwo": 2',
      '}',
    ]);
  });
});

describe('previewJsonLines — truncation with real head AND real tail content', () => {
  it('truncates a large flat object to 5 lines with head, ellipsis, tail', () => {
    const value: JsonValue = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 };
    const result = previewJsonLines(value, { maxLines: 5, flatWidth: 10 });

    expect(result.truncated).toBe(true);
    expect(result.lines.length).toBeLessThanOrEqual(5);
    expect(result.lines[0]).toBe('{');
    expect(result.lines.at(-1)).toBe('}');

    // Real head content (from the front) and real tail content (from the back) —
    // not synthesized closing brackets standing in for them.
    expect(result.lines.some((l) => l.includes('"a": 1'))).toBe(true);
    expect(result.lines.some((l) => l.includes('"g": 7'))).toBe(true);
    expect(result.lines.some((l) => /⋯ \d+ more/.test(l))).toBe(true);

    // The middle keys never got materialized into the preview.
    expect(result.lines.some((l) => l.includes('"d": 4'))).toBe(false);
  });

  it('never exceeds maxLines regardless of how large the value is', () => {
    const huge: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) huge[`key${i}`] = i;

    const result = previewJsonLines(huge, { maxLines: 5 });
    expect(result.lines.length).toBeLessThanOrEqual(5);
    expect(result.truncated).toBe(true);
    expect(result.lines.some((l) => l.includes('"key0": 0'))).toBe(true);
    expect(result.lines.some((l) => l.includes('"key4999": 4999'))).toBe(true);
  });

  it('truncates arrays the same way, preserving element order at head and tail', () => {
    const value = Array.from({ length: 20 }, (_, i) => i);
    const result = previewJsonLines(value, { maxLines: 5, flatWidth: 5 });

    expect(result.truncated).toBe(true);
    expect(result.lines[0]).toBe('[');
    expect(result.lines.at(-1)).toBe(']');
    expect(result.lines.some((l) => l.trim() === '0,')).toBe(true);
    expect(result.lines.some((l) => l.trim() === '19')).toBe(true);
  });

  it('gives the last shown line no trailing comma', () => {
    const value: JsonValue = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
    const result = previewJsonLines(value, { maxLines: 5, flatWidth: 10 });
    const lastContentLine = result.lines[result.lines.length - 2];
    expect(lastContentLine.endsWith(',')).toBe(false);
  });
});

describe('previewJsonLines — nested truncation', () => {
  it('collapses a deeply/widely nested child to a summary marker when its own sub-budget is tiny', () => {
    const bigNested: Record<string, number> = {};
    for (let i = 0; i < 50; i++) bigNested[`k${i}`] = i;

    const value = { small: 1, huge: bigNested, other: 2, another: 3, more: 4 };
    const result = previewJsonLines(value, { maxLines: 5, flatWidth: 15 });

    expect(result.lines.length).toBeLessThanOrEqual(5);
    // The nested huge object degrades gracefully instead of blowing the budget.
    expect(result.lines.some((l) => l.includes('⋯50⋯') || l.includes('⋯'))).toBe(true);
  });

  it('renders a small nested object correctly at depth with correct bracket alignment', () => {
    const value = { outer: { inner: 1 } };
    const result = previewJsonLines(value, { maxLines: 5, flatWidth: 5 });
    expect(result.lines).toEqual(['{', '  "outer": {', '    "inner": 1', '  }', '}']);
  });
});

describe('previewJsonLines — budget edge cases', () => {
  it('collapses to a one-line summary when maxLines is too small for any structure', () => {
    // flatWidth forces expansion (does not trivially fit on one line), so
    // the tight maxLines budget is what forces the collapse, not tryFlat.
    const value = { a: 1, b: 2, c: 3 };
    const result = previewJsonLines(value, { maxLines: 2, flatWidth: 5 });
    expect(result.lines.length).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.lines[0]).toContain('⋯3⋯');
  });

  it('maxLines defaults to 5', () => {
    const value: JsonValue = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
    const result = previewJsonLines(value, { flatWidth: 10 });
    expect(result.lines.length).toBeLessThanOrEqual(5);
  });
});
