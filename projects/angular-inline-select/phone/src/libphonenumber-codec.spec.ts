import metadata from 'libphonenumber-js/metadata.min.json';
import examples from 'libphonenumber-js/examples.mobile.json';

import { createLibphonenumberCodec } from './libphonenumber-codec';
import { countryFlagEmoji } from './phone-codec';

const codec = createLibphonenumberCodec(metadata, examples);

describe('createLibphonenumberCodec', () => {
  it('parses a national number against the default country', () => {
    const result = codec.parse('0171 2345678', 'DE');

    expect(result).toEqual({
      ok: true,
      e164: '+491712345678',
      country: 'DE',
      dialCode: '49',
      nationalNumber: '1712345678',
      national: '0171 2345678',
      international: '+49 171 2345678',
    });
  });

  it('detects the country from +CC input, overriding the default', () => {
    const result = codec.parse('+33 1 42 68 53 00', 'DE');

    expect(result?.ok).toBe(true);
    if (result?.ok) expect(result.country).toBe('FR');
  });

  it('empty input is null, not an error', () => {
    expect(codec.parse('', 'DE')).toBeNull();
    expect(codec.parse('   ', 'DE')).toBeNull();
  });

  it('structurally unreadable input fails with a reason (the commit gate)', () => {
    expect(codec.parse('abc', 'DE')).toEqual({ ok: false, reason: 'not-a-number' });
    // National digits without any country context
    expect(codec.parse('0171 2345678')).toEqual({ ok: false, reason: 'invalid-country' });
    expect(codec.parse('+999 123456')).toEqual({ ok: false, reason: 'invalid-country' });
  });

  it('suspicious-but-readable numbers parse with a warning (warn, do not block)', () => {
    const short = codec.parse('017', 'DE');
    expect(short?.ok).toBe(true);
    if (short?.ok) {
      expect(short.warning).toBe('too-short');
      expect(short.e164).toBe('+49017');
    }

    const long = codec.parse('0171 23456789012345', 'DE');
    expect(long?.ok).toBe(true);
    if (long?.ok) expect(long.warning).toBe('too-long');
  });

  it('formats E.164 for display in both styles', () => {
    expect(codec.format('+491712345678', 'international')).toBe('+49 171 2345678');
    expect(codec.format('+491712345678', 'national')).toBe('0171 2345678');
    // Unreadable input passes through unchanged
    expect(codec.format('garbage', 'international')).toBe('garbage');
  });

  it('pretty-prints incomplete drafts for the preview', () => {
    expect(codec.formatIncomplete?.('01712', 'DE')).toBe('0171 2');
  });

  it('provides example-number placeholders', () => {
    expect(codec.placeholderExample?.('DE', 'mobile')).toBe('01512 3456789');
  });
});

describe('countryFlagEmoji', () => {
  it('builds regional-indicator pairs from ISO codes', () => {
    expect(countryFlagEmoji('DE')).toBe('🇩🇪');
    expect(countryFlagEmoji('fr')).toBe('🇫🇷');
    expect(countryFlagEmoji('001')).toBe('');
  });
});
