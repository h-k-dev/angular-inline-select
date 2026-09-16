import { detectLink } from './link-detection';

describe('detectLink', () => {
  it('accepts absolute http(s) URLs as they are', () => {
    expect(detectLink('https://example.test/path?q=1')).toBe('https://example.test/path?q=1');
    expect(detectLink('http://example.test')).toBe('http://example.test/');
    expect(detectLink('ftp://example.test')).toBeNull();
  });

  it('accepts a bare domain and gives it https://', () => {
    expect(detectLink('reddit.com')).toBe('https://reddit.com/');
    expect(detectLink('www.example.de/path?q=1')).toBe('https://www.example.de/path?q=1');
    expect(detectLink('  Reddit.COM  ')).toBe('https://reddit.com/');
    expect(detectLink('sub.domain.co.uk')).toBe('https://sub.domain.co.uk/');
  });

  it('refuses word-dot-word values that are not domains', () => {
    expect(detectLink('file.pdf')).toBeNull();
    expect(detectLink('index.html')).toBeNull();
    expect(detectLink('v1.2')).toBeNull();
    expect(detectLink('Some sentence. With dots.')).toBeNull();
    expect(detectLink('name@example.test')).toBeNull();
    expect(detectLink('')).toBeNull();
  });
});
