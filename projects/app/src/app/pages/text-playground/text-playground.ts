import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
} from '@angular/core';
import { FormField, form, required, pattern, disabled, readonly } from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';

// Components
import { AngularInlineText } from '../../../../../angular-inline-select/src/lib/angular-inline-text/angular-inline-text';

export interface DemoRow {
  position: number;
  name: string;
  notes: string;
}

const INITIAL_PROJECT_NAME = 'Aurora';
const INITIAL_SUMMARY =
  'Click any highlighted text on this page and start typing. ' +
  'Save with Ctrl+Enter or the Save button, discard with Escape — ' +
  'the overlay only appears once you actually change something.';

// Mixed lengths on purpose: short names sit naturally, long ones must
// ellipsize inside the fixed-width name column without pushing it.
const SAMPLE_NAMES = [
  'Iris',
  'Aurora Borealis',
  'Halo',
  'Gossamer Drift Relay',
  'Ember',
  'Junction Point Observatory of the Western Rim',
  'Cascade',
  'Flux Capacitor Calibration and Maintenance Facility Northwest',
  'Drift',
  'The Extraordinarily Long Research Vessel Designation That Never Fits Anywhere',
];

// Mixed lengths on purpose: empty shows the placeholder, short ones stay on
// one line, long ones must wrap to several lines inside the notes column.
const SAMPLE_NOTES = [
  '',
  'Stable.',
  'Needs a follow-up during the next maintenance window.',
  'Recalibrated twice this cycle. The drift is within tolerance, but keep an eye on the secondary readings until the next full diagnostic.',
  'Long-form note to exercise wrapping: the array was realigned after the last storm season, power draw is nominal, and the relay handshake completes in under forty milliseconds. Crew rotation is scheduled for the third week, pending transport availability and weather on the pass.',
];

@Component({
  selector: 'app-text-playground',
  templateUrl: './text-playground.html',
  styleUrl: './text-playground.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    // Material
    MatButtonModule,
    MatTableModule,

    // Forms
    FormField,

    // Components
    AngularInlineText,
  ],
})
export class TextPlayground {
  // ---------------------------------------------------------------------------
  // Paragraph example
  // ---------------------------------------------------------------------------
  protected projectName = signal(INITIAL_PROJECT_NAME);
  protected summary = signal(INITIAL_SUMMARY);

  // Normalization playground: toggle trimming on the multi-line summary and
  // reset the copy to retry — commits trim edge whitespace only, interior
  // spaces and line breaks always survive.
  protected summaryNormalize = signal(true);

  protected resetParagraphExample() {
    this.projectName.set(INITIAL_PROJECT_NAME);
    this.summary.set(INITIAL_SUMMARY);
  }

  // ---------------------------------------------------------------------------
  // Signal form example: schema-driven validation + field state toggles
  // ---------------------------------------------------------------------------
  protected fieldRequired = signal(true);
  protected fieldReadonly = signal(false);
  protected fieldDisabled = signal(false);

  protected vesselModel = signal({ callsign: 'AUR-01' });

  protected vesselForm = form(this.vesselModel, (path) => {
    // The schema only decides validity — the error texts live in the
    // projected [editable-error] content (the mat-error split). A field
    // without projected content renders message-carrying errors itself.
    required(path.callsign, { when: () => this.fieldRequired() });
    pattern(path.callsign, /^[A-Z]{2,4}-\d{1,3}$/);

    readonly(path.callsign, { when: () => this.fieldReadonly() });
    disabled(path.callsign, { when: () => this.fieldDisabled() });
  });

  // The `hasError(...)` analogues: pick WHICH error the projected content
  // describes. WHEN errors show (touched / save attempt) is the field's own
  // job — no touched() check here.
  protected callsignMissing = computed(() =>
    this.vesselForm.callsign().errors().some((error) => error.kind === 'required'),
  );

  protected callsignPatternBroken = computed(() =>
    this.vesselForm.callsign().errors().some((error) => error.kind === 'pattern'),
  );

  // Event console: everything the callsign field emits, newest first — makes
  // the legacy outputs vs. the settled-session `saved` event comparable live.
  protected emittedEvents = signal<string[]>([]);

  protected logEmit(name: string, payload: unknown) {
    this.emittedEvents.update((events) =>
      [`${name} → ${JSON.stringify(payload)}`, ...events].slice(0, 8),
    );
  }

  // ---------------------------------------------------------------------------
  // Table example (100 rows)
  // ---------------------------------------------------------------------------
  protected displayedColumns = ['position', 'name', 'notes'];

  // 10 × 5 pools with coprime-ish striding so name and note lengths combine
  // in every variation across the 100 rows.
  protected rows: DemoRow[] = Array.from({ length: 100 }, (_, i) => ({
    position: i + 1,
    name: `${SAMPLE_NAMES[i % SAMPLE_NAMES.length]} ${i + 1}`,
    notes: SAMPLE_NOTES[(i + Math.floor(i / 5)) % SAMPLE_NOTES.length],
  }));

  // ---------------------------------------------------------------------------
  // Layout shift tester
  // ---------------------------------------------------------------------------
  // Pushes the whole content area aside with a left margin to stress-test
  // layout stability: the in-flow display text must move with the page while
  // idle, and typing in the elevated editor must never shift the page.
  protected pushMargin = signal(0);
  protected oscillate = signal(false);
}
