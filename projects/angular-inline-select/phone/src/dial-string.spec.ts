import { joinDialString, splitDialString, telHref } from './dial-string';

describe('splitDialString', () => {
  it.each([
    // PBX code + space
    ['#0 0049 123 456789', '#0', '0049 123 456789'],
    ['#12 030 12345678', '#12', '030 12345678'],
    ['  #0   +49 30 12345678 ', '#0', '+49 30 12345678'],

    // GSM/USSD codes — closed by their own `#`, no space needed
    ['*31#0049 30 12345678', '*31#', '0049 30 12345678'],
    ['#31# 0043 1 2345678', '#31#', '0043 1 2345678'],
    ['*#21# 030 1', '*#21#', '030 1'],

    // Several tokens — USSD codes around ONE PBX code
    ['#0 *31# 0043 1 2345678', '#0 *31#', '0043 1 2345678'],
    ['*31# #0 0043 1 2345678', '*31# #0', '0043 1 2345678'],
    ['#0 #0 +43 1 2345678', '#0', '#0 +43 1 2345678'],
  ])('%j → prefix %j, number %j', (raw, prefix, number) => {
    expect(splitDialString(raw)).toEqual({ prefix, number });
  });

  it.each([
    '+49 30 12345678',
    '030 12345678',
    '030 12345678#12', // a trailing `#` is an extension, not a prefix
    '#00049 30 12345678', // ambiguous PBX code without its space
    '#0', // a lone code — nothing after it yet
    '',
  ])('%j has no prefix', (raw) => {
    expect(splitDialString(raw)).toEqual({ prefix: '', number: raw.trim() });
  });
});

describe('joinDialString', () => {
  it('writes the number in 00 form after the prefix', () => {
    expect(joinDialString('#0', '+49 30 12345678')).toBe('#0 0049 30 12345678');
    expect(joinDialString('*31#', '+43 1 2345678')).toBe('*31# 0043 1 2345678');
  });

  it('round-trips through splitDialString', () => {
    expect(splitDialString(joinDialString('#0', '+41 44 668 18 00'))).toEqual({
      prefix: '#0',
      number: '0041 44 668 18 00',
    });
  });
});

describe('telHref', () => {
  it('escapes # so the number stays out of the URI fragment', () => {
    expect(telHref('#0 0049 123 456789')).toBe('tel:%230 0049 123 456789');
    expect(new URL(telHref('#0 0049 123 456789')).hash).toBe('');
  });

  it('leaves E.164 and * untouched', () => {
    expect(telHref('+493012345678')).toBe('tel:+493012345678');
    expect(telHref('*31# 0049 30 1')).toBe('tel:*31%23 0049 30 1');
  });
});
