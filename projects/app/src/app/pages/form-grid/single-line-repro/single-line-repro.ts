import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
  input,
} from '@angular/core';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/** One line terminator, as the table lists it and the field receives it. */
interface LineBreak {
  label: string;
  /** How the character is written in source — what the table shows. */
  code: string;
  char: string;
}

/** Unicode's mandatory breaks (UAX #14 BK, CR, LF, NL): each one starts a new line. */
const BREAKS: readonly LineBreak[] = [
  { label: 'LF', code: '\\n', char: '\n' },
  { label: 'CRLF', code: '\\r\\n', char: '\r\n' },
  { label: 'CR', code: '\\r', char: '\r' },
  { label: 'VT', code: '\\v', char: '\v' },
  { label: 'FF', code: '\\f', char: '\f' },
  { label: 'NEL', code: '\\u0085', char: '\u0085' },
  { label: 'LINE SEPARATOR', code: '\\u2028', char: '\u2028' },
  { label: 'PARAGRAPH SEPARATOR', code: '\\u2029', char: '\u2029' },
];

/** Every terminator above, for the leak check. */
const ANY_BREAK = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/;

/** The visible token per terminator: `JSON.stringify` leaves U+0085/2028/2029 raw. */
const BREAK_TOKENS: Record<string, string> = {
  '\r\n': '⟨CRLF⟩',
  '\n': '⟨LF⟩',
  '\r': '⟨CR⟩',
  '\v': '⟨VT⟩',
  '\f': '⟨FF⟩',
  '\u0085': '⟨NEL⟩',
  '\u2028': '⟨U+2028⟩',
  '\u2029': '⟨U+2029⟩',
};

/** The value with every line terminator spelled out, so none can hide in the readout. */
function showBreaks(value: string) {
  return value.replace(/\r\n|[\n\r\v\f\u0085\u2028\u2029]/g, (br) => BREAK_TOKENS[br]);
}

/** The field this panel drives: the grid's single-line Attachment (file name) field. */
const FIELD_SELECTOR = '[data-repro="attachment"] .editable-text__display';

/** The elevated editor, rendered in the CDK overlay container while a session is open. */
const EDITOR_SELECTOR = '.editable-text__editor';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Resolves once `ready()` holds, frame by frame; false when it never does within ~1s. */
async function waitFor(ready: () => boolean) {
  for (let frame = 0; frame < 60; frame++) {
    if (ready()) return true;
    await nextFrame();
  }
  return ready();
}

const editorOpen = () => !!document.querySelector(EDITOR_SELECTOR);

/**
 * Single-line leak repro: sends each line terminator into the grid's
 * single-line Attachment field and reports whether it made it into the
 * committed value.
 *
 * Two ways in per terminator:
 * - **Copy** puts `report<br>final` on the clipboard: paste it into the field
 *   by hand, at rest or while editing, and press Enter.
 * - **Type + Enter** replays what dictation, text replacement or an IME send:
 *   one `insertText` keystroke on the resting field that carries the break,
 *   then Enter as soon as the editor opens.
 */
@Component({
  selector: 'app-single-line-repro',
  templateUrl: './single-line-repro.html',
  styleUrl: './single-line-repro.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [MatButtonModule, MatIconModule],
})
export class SingleLineRepro {
  /** The Attachment field's last committed value, from the grid's `fileName.saved`. */
  readonly commit = input<string | null>(null);

  protected readonly breaks = BREAKS;

  protected readonly commitShown = computed(() => {
    const commit = this.commit();
    return commit === null ? null : showBreaks(commit);
  });

  protected readonly commitLeaked = computed(() => ANY_BREAK.test(this.commit() ?? ''));

  // ---------------------------------------------------------------------------
  // Results — what each Type + Enter run committed, per terminator
  // ---------------------------------------------------------------------------
  protected readonly results = signal<Record<string, { shown: string; leaked: boolean } | 'no-session'>>(
    {},
  );

  protected readonly copied = signal<string | null>(null);

  protected async copy(br: LineBreak) {
    await navigator.clipboard.writeText(`report${br.char}final`);
    this.copied.set(br.label);
  }

  /**
   * Numbers each run: an edit that leaves the committed text as it is opens no
   * session, so a repeat of the same text would show nothing.
   */
  #run = 0;

  /** One keystroke carrying the break replaces the whole stem, then Enter commits it. */
  protected async typeAndEnter(br: LineBreak) {
    const display = document.querySelector<HTMLElement>(FIELD_SELECTOR);
    if (!display) return;

    // A session still open would swallow the keystroke: start from rest.
    await waitFor(() => !editorOpen());

    // Select the whole stem (the suffix lives outside the display) so the
    // keystroke replaces it rather than appending to the last run.
    window.getSelection()?.selectAllChildren(display);

    display.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: `report${br.char}final-${++this.#run}`,
        bubbles: true,
        cancelable: true,
      }),
    );

    // The editor opens in an overlay a render or two later.
    if (!(await waitFor(editorOpen))) {
      this.results.update((results) => ({ ...results, [br.label]: 'no-session' }));
      return;
    }

    document
      .querySelector(EDITOR_SELECTOR)!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // Enter settles the session: the overlay closes, `fileName.saved` reaches the page.
    await waitFor(() => !editorOpen());
    await nextFrame();

    const committed = this.commit() ?? '';
    this.results.update((results) => ({
      ...results,
      [br.label]: { shown: showBreaks(committed), leaked: ANY_BREAK.test(committed) },
    }));
  }
}
