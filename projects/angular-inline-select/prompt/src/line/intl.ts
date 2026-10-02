// Angular
import {
  Injectable,

  // Signals
  signal,
} from '@angular/core';

/**
 * The line editors' localizable chrome — the fixed words an editor shows
 * around the text, never the text itself. Today one: the hint an empty
 * heading line gives, "Heading 1", which is this word and the depth.
 *
 * One `providedIn: 'root'` override point, signal-backed so a runtime locale
 * switch reaches every editor. The `EditableTextIntl` / `MatPaginatorIntl`
 * pattern: a consumer localizes by providing a subclass or a factory that
 * writes these signals from the i18n backend it already runs:
 *
 *     { provide: LineEditorIntl, useFactory: myLineEditorIntl }
 */
@Injectable({ providedIn: 'root' })
export class LineEditorIntl {
  /** The word an empty heading line shows before its depth. */
  readonly headingLabel = signal('Heading');
}
