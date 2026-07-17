import { describe, it, expect } from 'vitest';
import { canonicalJson, parseJsonDraft, quoteBareKeys } from './json-codec';

describe('quoteBareKeys', () => {
  it('quotes a bare identifier key', () => {
    expect(quoteBareKeys('{a: 1}')).toBe('{"a": 1}');
  });

  it('quotes multiple keys including $ and _ identifiers', () => {
    expect(quoteBareKeys('{foo: 1, _bar: 2, $baz3: 3}')).toBe('{"foo": 1, "_bar": 2, "$baz3": 3}');
  });

  it('is idempotent on strict JSON (already-quoted keys untouched)', () => {
    const strict = '{"a": 1, "b": {"c": [1, 2]}}';
    expect(quoteBareKeys(strict)).toBe(strict);
  });

  it('never touches string CONTENT that looks like a key', () => {
    expect(quoteBareKeys('{"s": "a: 1, {b: 2}"}')).toBe('{"s": "a: 1, {b: 2}"}');
  });

  it('handles escaped quotes inside strings', () => {
    const text = '{"s": "he said \\" x: 1"}';
    expect(quoteBareKeys(text)).toBe(text);
  });

  it('does not quote true/false/null in VALUE position', () => {
    expect(quoteBareKeys('{a: true, b: null}')).toBe('{"a": true, "b": null}');
  });

  it('does not touch identifiers in arrays (stay errors for strict parse)', () => {
    expect(quoteBareKeys('[a, b]')).toBe('[a, b]');
  });

  it('quotes nested object keys at any depth', () => {
    expect(quoteBareKeys('{a: {b: {c: 1}}}')).toBe('{"a": {"b": {"c": 1}}}');
  });

  it('handles URLs (a // inside a string is not special)', () => {
    const text = '{url: "https://example.com/x?y=1"}';
    expect(quoteBareKeys(text)).toBe('{"url": "https://example.com/x?y=1"}');
  });

  it('handles whitespace between key and colon', () => {
    expect(quoteBareKeys('{a   : 1}')).toBe('{"a"   : 1}');
  });

  it('quotes keys after a nested container closes', () => {
    expect(quoteBareKeys('{a: [1], b: 2}')).toBe('{"a": [1], "b": 2}');
  });
});

describe('parseJsonDraft — bare-key leniency, otherwise strict', () => {
  it('accepts bare identifier keys', () => {
    expect(parseJsonDraft('{role: "admin", active: true}').value).toEqual({ role: 'admin', active: true });
  });

  it('still types primitives natively', () => {
    const parsed = parseJsonDraft('{n: 42, s: "42", b: false, nil: null}').value as Record<string, unknown>;
    expect(parsed['n']).toBe(42);
    expect(parsed['s']).toBe('42');
    expect(parsed['b']).toBe(false);
    expect(parsed['nil']).toBeNull();
  });

  it('REJECTS a trailing comma — this is not JSON5', () => {
    expect(parseJsonDraft('{"a": 1,}').error).toBeDefined();
    expect(parseJsonDraft('{a: 1,}').error).toBeDefined();
    expect(parseJsonDraft('[1, 2,]').error).toBeDefined();
  });

  it('rejects single-quoted strings', () => {
    expect(parseJsonDraft("{a: 'x'}").error).toBeDefined();
  });

  it('rejects unquoted string VALUES', () => {
    expect(parseJsonDraft('{a: admin}').error).toBeDefined();
  });

  it('rejects comments', () => {
    expect(parseJsonDraft('{"a": 1} // note').error).toBeDefined();
  });

  it('treats empty/whitespace text as no value, not an error', () => {
    expect(parseJsonDraft('')).toEqual({});
    expect(parseJsonDraft('   \n ')).toEqual({});
  });
});

describe('canonicalJson', () => {
  it('serializes to compact, double-quoted strict JSON', () => {
    expect(canonicalJson('{ role : "admin",\n  active: true }')).toBe('{"role":"admin","active":true}');
  });

  it('is null for unparseable text', () => {
    expect(canonicalJson('{a: 1,}')).toBeNull();
  });

  it('is the empty string for empty text', () => {
    expect(canonicalJson('  ')).toBe('');
  });

  it('agrees across typing styles — bare vs quoted keys canonicalize identically', () => {
    expect(canonicalJson('{a: 1}')).toBe(canonicalJson('{"a": 1}'));
  });
});
