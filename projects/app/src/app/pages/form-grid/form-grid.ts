import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
} from '@angular/core';

// Pattern
import { FieldGrid, type FieldGridEmission } from './field-grid/field-grid';

/** The fold threshold — the one in field-grid.scss, for the copy above the grid. */
const FOLD_CH = 40;

/**
 * Form Grid — the label/value layout every record page ends up needing, built
 * so the LAYOUT decision belongs to the container: side by side while there is
 * room, stacked top down under 40ch, decided by a container query.
 *
 * The page is deliberately just the grid: the fold is a property of the
 * container's width, so devtools (or the window) is the control surface.
 */
@Component({
  selector: 'app-form-grid',
  templateUrl: './form-grid.html',
  styleUrl: './form-grid.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FieldGrid],
})
export class FormGridPage {
  protected readonly foldCh = FOLD_CH;

  // ---------------------------------------------------------------------------
  // Event console — every settled commit from the grid, newest first
  // ---------------------------------------------------------------------------
  protected emittedEvents = signal<string[]>([]);

  protected logEmit({ name, payload }: FieldGridEmission) {
    this.emittedEvents.update((events) =>
      [`${name} → ${JSON.stringify(payload)}`, ...events].slice(0, 8),
    );
  }
}
