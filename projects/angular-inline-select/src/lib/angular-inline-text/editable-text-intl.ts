import { Injectable, signal } from '@angular/core';

/**
 * The text control's localizable CHROME — the fixed UI strings its panel
 * speaks around the value: the stock Save / Discard actions and the dirty
 * hint. The value itself is never translated.
 *
 * One `providedIn: 'root'` override point, signal-backed so a runtime locale
 * switch re-renders every panel. The `MatPaginatorIntl` / `TemporalIntl`
 * pattern, deliberately NOT Angular `$localize` (a distributable library that
 * ships `i18n`-marked templates forces every consumer to merge ITS message
 * IDs into their catalog). A consumer localizes the surface by providing a
 * subclass or a factory that writes these signals from whatever i18n backend
 * it already runs:
 *
 *     { provide: EditableTextIntl, useFactory: myEditableTextIntl }
 */
@Injectable({ providedIn: 'root' })
export class EditableTextIntl {
  /** The stock panel action that commits the session. */
  readonly saveLabel = signal('Save');

  /** The stock panel action that reverts the draft and closes. */
  readonly discardLabel = signal('Discard');

  /** The panel hint while the draft differs from the committed value. */
  readonly unsavedChangesLabel = signal('Unsaved changes');
}
