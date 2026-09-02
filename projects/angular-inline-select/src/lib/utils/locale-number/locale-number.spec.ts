import {
  formatLocaleNumber,
  parseLocaleNumber,
  makeLocaleNumberCodec,
  localeNumberSeparators,
  localeNumberChars,
} from './locale-number';

describe('formatLocaleNumber', () => {
  it('groups thousands and picks the decimal mark per locale', () => {
    expect(formatLocaleNumber(1000.25, 'en')).toBe('1,000.25');
    expect(formatLocaleNumber(1000.25, 'de')).toBe('1.000,25');
  });

  it('formats empty as empty', () => {
    expect(formatLocaleNumber(null, 'en')).toBe('');
    expect(formatLocaleNumber(undefined, 'de')).toBe('');
  });

  it('keeps the widest precision by default — a display never rounds the model', () => {
    // Intl's own default would round this to 1.235.
    expect(formatLocaleNumber(1.23456, 'en')).toBe('1.23456');
  });

  it('narrows precision only when asked', () => {
    const money = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    expect(formatLocaleNumber(1250000.5, 'en', money)).toBe('1,250,000.50');
    expect(formatLocaleNumber(1250000.5, 'de', money)).toBe('1.250.000,50');
  });

  it('pins Latin digits whatever the locale', () => {
    expect(formatLocaleNumber(1234, 'ar-EG')).toMatch(/^[0-9٬٫,.\s]+$/u);
    expect(formatLocaleNumber(1234, 'ar-EG')).toContain('1');
  });
});

describe('parseLocaleNumber', () => {
  it('reads the locale display back, grouped or not', () => {
    expect(parseLocaleNumber('1,000.25', 'en')).toBe(1000.25);
    expect(parseLocaleNumber('1000.25', 'en')).toBe(1000.25);
    expect(parseLocaleNumber('1.000,25', 'de')).toBe(1000.25);
    expect(parseLocaleNumber('1000,25', 'de')).toBe(1000.25);
  });

  it('round-trips its own formatter', () => {
    for (const locale of ['en', 'de', 'fr', 'de-CH', 'en-IN']) {
      for (const value of [0, 7, 1234567.89, -0.5, 1e9]) {
        expect(parseLocaleNumber(formatLocaleNumber(value, locale), locale)).toBe(value);
      }
    }
  });

  it('treats empty as null and non-numbers as unparseable', () => {
    expect(parseLocaleNumber('', 'en')).toBeNull();
    expect(parseLocaleNumber('   ', 'de')).toBeNull();
    expect(parseLocaleNumber('abc', 'en')).toBeUndefined();
    expect(parseLocaleNumber('1e3', 'en')).toBeUndefined();
    expect(parseLocaleNumber('0x10', 'en')).toBeUndefined();
  });

  it('the locale fixes each mark\'s role — "1.000" is a thousand under de, one under en', () => {
    expect(parseLocaleNumber('1.000', 'de')).toBe(1000);
    expect(parseLocaleNumber('1.000', 'en')).toBe(1);
    expect(parseLocaleNumber('1,000', 'en')).toBe(1000);
    expect(parseLocaleNumber('1,000', 'de')).toBe(1);
  });

  it('a group that does not look like a group is an error, never a silent ×10', () => {
    // A dot-emitting keyboard on a German field: "1.5" must NOT read as 15.
    expect(parseLocaleNumber('1.5', 'de')).toBeUndefined();
    expect(parseLocaleNumber('1,5', 'en')).toBeUndefined();
    expect(parseLocaleNumber('12.34', 'de')).toBeUndefined();
    // Groups after the first must be full width.
    expect(parseLocaleNumber('1,00', 'en')).toBeUndefined();
    expect(parseLocaleNumber('1,0000', 'en')).toBeUndefined();
  });

  it('reads the whole space-like family as one grouping mark (fr)', () => {
    const { group } = localeNumberSeparators('fr');
    expect(group).not.toBe('');
    expect(group.trim()).toBe('');

    // Intl emits a narrow no-break space; a keyboard types a plain one.
    expect(parseLocaleNumber('1 000,5', 'fr')).toBe(1000.5);
    expect(parseLocaleNumber('1' + String.fromCharCode(0x202f) + '000,5', 'fr')).toBe(1000.5);
    expect(parseLocaleNumber(formatLocaleNumber(1000.5, 'fr'), 'fr')).toBe(1000.5);
  });

  it('accepts the two-digit grouping of locales that group that way (en-IN)', () => {
    expect(formatLocaleNumber(1234567, 'en-IN')).toBe('12,34,567');
    expect(parseLocaleNumber('12,34,567', 'en-IN')).toBe(1234567);
    expect(parseLocaleNumber('1,234,567', 'en-IN')).toBe(1234567);
  });

  it('reads a Unicode minus and a keyboard hyphen alike', () => {
    expect(parseLocaleNumber('-1.5', 'en')).toBe(-1.5);
    expect(parseLocaleNumber(String.fromCharCode(0x2212) + '1.5', 'en')).toBe(-1.5);
    expect(parseLocaleNumber('+1.5', 'en')).toBe(1.5);
  });

  it('accepts a bare fraction and a trailing decimal mark mid-draft', () => {
    expect(parseLocaleNumber('.5', 'en')).toBe(0.5);
    expect(parseLocaleNumber(',5', 'de')).toBe(0.5);
    expect(parseLocaleNumber('12.', 'en')).toBe(12);
  });
});

describe('makeLocaleNumberCodec', () => {
  it('bundles the two halves and the separators for one locale', () => {
    const codec = makeLocaleNumberCodec('de', { maximumFractionDigits: 1 });

    expect(codec.separators).toEqual({ group: '.', decimal: ',', minus: '-' });
    expect(codec.format(1234.56)).toBe('1.234,6');
    expect(codec.parse('1.234,5')).toBe(1234.5);
    expect(codec.parse('')).toBeNull();
    expect(codec.parse('1.5')).toBeUndefined();
  });
});

describe('localeNumberChars', () => {
  it("admits digits, sign, both generic marks and the locale's own separators", () => {
    const en = localeNumberChars('en');
    for (const ch of '0123456789+-.,') expect(en.test(ch)).toBe(true);
    expect(en.test('a')).toBe(false);
    expect(en.test(' ')).toBe(false);

    const fr = localeNumberChars('fr');
    expect(fr.test(' ')).toBe(true);
    expect(fr.test(String.fromCharCode(0x202f))).toBe(true);

    const ch = localeNumberChars('de-CH');
    expect(ch.test(localeNumberSeparators('de-CH').group)).toBe(true);
  });
});
