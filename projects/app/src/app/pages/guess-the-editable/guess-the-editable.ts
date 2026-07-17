import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
} from '@angular/core';

// Every editable family, so we can scatter one of each through the prose.
import { AngularInlineText, AngularInlineNumber } from 'angular-inline-select';
import { AngularInlinePhone, createLibphonenumberCodec } from 'angular-inline-select/phone';
import {
  AngularInlineDate,
  AngularInlineTime,
  AngularInlineDuration,
  composeDbEntry,
  type InlineDateValue,
  type InlineTimeValue,
} from 'angular-inline-select/temporal';
import { AngularInlineJson } from 'angular-inline-select/json';
import metadata from 'libphonenumber-js/metadata.min.json';
import examples from 'libphonenumber-js/examples.mobile.json';

const phoneCodec = createLibphonenumberCodec(metadata, examples);

/**
 * "Guess the Editable" — a benchmark, not a demo.
 *
 * The host sets `--editable-text-underline: none` (and the temporal border
 * variant), so every scattered control hides its resting affordance and must
 * pass as plain prose. Holding Ctrl flips the tokens back on — the reveal —
 * so any control that ALREADY stood out (a stray baseline, a prefix chrome,
 * a boxed preview) is the one that "fails to look inline enough".
 */
@Component({
  selector: 'app-guess-the-editable',
  templateUrl: './guess-the-editable.html',
  styleUrl: './guess-the-editable.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    AngularInlineText,
    AngularInlineNumber,
    AngularInlinePhone,
    AngularInlineDate,
    AngularInlineTime,
    AngularInlineDuration,
    AngularInlineJson,
  ],
  host: {
    class: 'guess',
    '[class.guess--reveal]': 'revealed()',
    // Ctrl is a HOLD, not a toggle: track its live state on every key event
    // (`ctrlKey` is true on Ctrl-down and any key held with it, false on its
    // release), and reset on blur so a Ctrl+Tab away never leaves it stuck on.
    '(document:keydown)': 'trackCtrl($event)',
    '(document:keyup)': 'trackCtrl($event)',
    '(window:blur)': 'revealed.set(false)',
  },
})
export class GuessTheEditable {
  protected revealed = signal(false);

  protected trackCtrl(event: KeyboardEvent) {
    // metaKey too, so ⌘ works for Mac muscle memory.
    this.revealed.set(event.ctrlKey || event.metaKey);
  }

  protected codec = phoneCodec;

  // The scattered values — one of every family, seeded so each shows real
  // content (an empty field's italic placeholder would be a giveaway).
  protected title = signal('The Quiet Craft of Inline Editing');
  protected author = signal('Hong Knop');
  protected publishDate = signal<InlineDateValue>('2019-04-15');
  protected publishTime = signal<InlineTimeValue>(composeDbEntry('2019-04-15', '09:30'));
  protected teamSize = signal<number | string | null>(4);
  protected workDuration = signal<number | null>(8 * 3600); // "8:00" at h:mm
  protected authorPhone = signal<string | null>('+493012345678');
  protected readCount = signal<number | string | null>(4200);
  protected fieldCount = signal<number | string | null>(12);
  protected settings = signal('{"theme":"dark","density":0}');
  protected note = signal('Leave a note here if you spot them all.');

  // Price is a number with a currency FORMAT — two decimals — so it reads as
  // money. The € stays inline prose so nothing but the digits is the field.
  protected price = signal<number | string | null>(9);
  protected priceFormat = (value: number | null): string => (value === null ? '' : value.toFixed(2));
}
