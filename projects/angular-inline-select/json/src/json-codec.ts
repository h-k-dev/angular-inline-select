import type { JsonValue } from './json-doc';

export interface JsonParseResult {
  value?: JsonValue;
  error?: string;
}

/**
 * The ONE deliberate leniency: bare identifier keys. `{ role: "admin" }`
 * reads and types better than `{ "role": "admin" }`, and quoting keys is
 * where most hand-typing errors happen — so the draft may omit key quotes.
 *
 * Everything else stays strict `JSON.parse`: trailing commas, single-quoted
 * strings, comments, unquoted string VALUES all remain errors. This is NOT
 * JSON5 (JSON5 would silently accept trailing commas, which we specifically
 * want rejected) — it is a single, string-aware pre-pass that wraps bare
 * keys in double quotes and hands the result to the strict parser.
 */
export function quoteBareKeys(text: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  const containers: string[] = [];
  let lastSignificant = '';

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      if (ch === '\\') {
        // Copy the escape pair atomically so an escaped quote never ends the string.
        out += ch + (text[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      out += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      lastSignificant = ch;
      i++;
      continue;
    }

    if (ch === '{' || ch === '[') {
      containers.push(ch);
      out += ch;
      lastSignificant = ch;
      i++;
      continue;
    }

    if (ch === '}' || ch === ']') {
      containers.pop();
      out += ch;
      lastSignificant = ch;
      i++;
      continue;
    }

    // A bare identifier in object-KEY position: directly inside `{…}`, right
    // after `{` or `,`, and followed (after whitespace) by `:`. Identifiers
    // in VALUE position (true/false/null after a `:`) never match — their
    // lastSignificant is `:`.
    if (
      /[A-Za-z_$]/.test(ch) &&
      containers[containers.length - 1] === '{' &&
      (lastSignificant === '{' || lastSignificant === ',')
    ) {
      let end = i;
      while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) end++;

      let next = end;
      while (next < text.length && /\s/.test(text[next])) next++;

      if (text[next] === ':') {
        out += `"${text.slice(i, end)}"`;
        lastSignificant = '"';
        i = end;
        continue;
      }

      // Not a key (no colon follows) — copy as-is; strict parse will judge it.
      out += text.slice(i, end);
      lastSignificant = text[end - 1];
      i = end;
      continue;
    }

    out += ch;
    if (!/\s/.test(ch)) lastSignificant = ch;
    i++;
  }

  return out;
}

/**
 * Draft parsing: bare-key leniency (above), then STRICT `JSON.parse` — a
 * trailing comma, an unquoted string value, a single-quoted string: all
 * rejected exactly as `JSON.parse` rejects them. Empty (whitespace-only)
 * text is "no value", not an error — the empty draft never raises the gate.
 */
export function parseJsonDraft(text: string): JsonParseResult {
  const trimmed = text.trim();
  if (trimmed === '') return {};

  try {
    return { value: JSON.parse(quoteBareKeys(trimmed)) as JsonValue };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
}

/**
 * The canonical committed form: strict, compact, double-quoted `JSON.stringify`
 * of the parsed value — what actually lands in the model (and the database).
 * `null` means the text does not parse; `''` means empty.
 */
export function canonicalJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return '';

  const parsed = parseJsonDraft(trimmed);
  if (parsed.error !== undefined || parsed.value === undefined) return null;

  return JSON.stringify(parsed.value);
}
