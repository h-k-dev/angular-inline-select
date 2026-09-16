/**
 * THE LINK DETECTION behind an "open" action on a text value — the seed of
 * the link control's codec (ROADMAP → "Next up — angular-inline-link"); iusta's
 * text-v2 uses it for its stock open-in-new-tab button.
 *
 * Two roads to a link, both ending in a real `URL`:
 * 1. An absolute http(s) URL — what the legacy `m-editable-text` accepted.
 * 2. A BARE DOMAIN, with or without a path — `reddit.com`,
 *    `www.example.de/path?q=1` — given `https://`. The legacy code prepended
 *    `http://` in a helper that never ran because its detector demanded a
 *    scheme; users type domains without one, so the detector has to.
 *
 * The bare road needs a guard, because "file.pdf" and "index.html" are also
 * "word dot word": the last label must look like a top-level domain — a
 * two-letter country code, or one of the generic TLDs a value in this app is
 * likely to carry. Anything with whitespace or an `@` (an email) is out.
 * Returns the normalised `href`, or null.
 */
const GENERIC_TLDS = new Set([
  'com',
  'net',
  'org',
  'info',
  'biz',
  'edu',
  'gov',
  'int',
  'mil',
  'io',
  'co',
  'ai',
  'app',
  'dev',
  'tech',
  'cloud',
  'digital',
  'online',
  'site',
  'website',
  'me',
  'tv',
  'fm',
  'ly',
  'gg',
  'sh',
  'xyz',
  'club',
  'blog',
  'shop',
  'store',
  'news',
  'media',
  'law',
  'legal',
  'agency',
  'group',
  'company',
  'consulting',
  'finance',
  'bank',
  'insurance',
  'email',
  'chat',
  'social',
  'live',
  'video',
  'wiki',
  'eu',
  'asia',
  'berlin',
  'hamburg',
  'wien',
]);

const BARE_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,})(?:[/?#][^\s]*)?$/i;

export function detectLink(value: string): string | null {
  const text = value.trim();
  if (text === '' || /\s/.test(text) || text.includes('@')) return null;

  const absolute = parse(text);
  if (absolute !== null) return absolute;

  const match = BARE_DOMAIN.exec(text);
  if (match === null) return null;
  const tld = match[1].toLowerCase();
  if (tld.length !== 2 && !GENERIC_TLDS.has(tld)) return null;

  return parse(`https://${text}`);
}

function parse(text: string): string | null {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
