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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTableModule } from '@angular/material/table';

// Components
import {
  AngularInlineText,
  type InlineTextWrapBehavior,
} from '../../../../../angular-inline-select/src/lib/angular-inline-text/angular-inline-text';

export interface DemoRow {
  position: number;
  /** One logical line, always far too long for its column. */
  title: string;
  /** One logical line whose overflow is a single unbreakable word. */
  compound: string;
  /** Several authored lines, each too long for its column. */
  note: string;
  /** Several authored lines with an unbreakable word in them. */
  report: string;
}

const INITIAL_PROJECT_NAME = 'Aurora';
const INITIAL_SUMMARY =
  'Click any highlighted text on this page and start typing. ' +
  'Save with Ctrl+Enter or the Save button, discard with Escape — ' +
  'the overlay only appears once you actually change something.';

/**
 * Sub-header slot values. The long one is what the example exists for: it can
 * never fit the phone-width slot, so `noWrap` must ellipsize it. The short one
 * is the control case — it fits, so nothing is clipped.
 */
const SHORT_OWNER = 'R. Vance';
const LONG_OWNER = 'Rosalind Vance-Okonkwo, Western Rim survey office';

// Every cell below is deliberately too long for its column: what these tables
// demonstrate is what happens AT the width constraint, so nothing may fit.

/** One logical line — no line break anywhere, plenty of whitespace to break at. */
const SAMPLE_TITLES = [
  'Junction Point Observatory of the Western Rim, survey sector nine',
  'Flux Capacitor Calibration and Maintenance Facility, Northwest Approach',
  'The Extraordinarily Long Research Vessel Designation That Never Fits Anywhere',
  'Gossamer Drift Relay, secondary handshake array and telemetry mast',
  'Aurora Borealis Deep Field Observation Platform, upper orbital ring',
];

/** One logical line whose overflow is a single word — nowhere to break politely. */
const SAMPLE_COMPOUNDS = [
  'Rekalibrierungsmaßnahmenverordnung filed against the starboard array',
  'Pending: interplanetaryhyperspectralimagingandtelemetrysubsystemoverhaul',
  'Betriebssicherheitsüberprüfungsbescheinigung issued for the whole ring',
  'Escalated as antidisestablishmentarianism_of_the_docking_clamp_committee',
  'Filed under Höchstgeschwindigkeitsbegrenzungsüberschreitung, third cycle',
];

/**
 * Several authored lines — the line breaks are user content and must survive.
 * Some samples include a BLANK line (paragraph break): an empty line is user
 * content too, and both paints must keep it.
 */
const SAMPLE_NOTES = [
  'Recalibrated twice this cycle and the drift is still within tolerance.\n' +
    'Keep an eye on the secondary readings until the next full diagnostic.',
  'The array was realigned after the last storm season and power draw is nominal.\n' +
    'Relay handshake completes in under forty milliseconds, every attempt.\n' +
    '\n' +
    'Crew rotation is scheduled for the third week, pending transport.',
  'Follow-up needed during the next maintenance window, whenever that lands.\n' +
    '\n' +
    'Nothing here is urgent, but none of it should be forgotten either.',
];

/** Several authored lines, at least one of which is an unbreakable word. */
const SAMPLE_REPORTS = [
  'Status: Verkehrsinfrastrukturfinanzierungsgesellschaft review outstanding.\n' +
    'Everything else on the checklist came back clean on the first pass.',
  'Flagged: supercalifragilisticexpialidocious_diagnostic_output_channel_seven\n' +
    'Downgraded to advisory after the second read, no action required today.\n' +
    '\n' +
    'Next audit lands with the quarterly rotation.',
  'Awaiting Grundstücksverkehrsgenehmigungszuständigkeitsübertragungsverordnung.\n' +
    'The paperwork trails the work by about a week, as it always does.',
];

// Striding across pools of different sizes so the four columns of a row never
// line up into the same combination twice down the table.
function makeDemoRows(count: number): DemoRow[] {
  return Array.from({ length: count }, (_, i) => ({
    position: i + 1,
    title: SAMPLE_TITLES[i % SAMPLE_TITLES.length],
    compound: SAMPLE_COMPOUNDS[(i + 2) % SAMPLE_COMPOUNDS.length],
    note: SAMPLE_NOTES[i % SAMPLE_NOTES.length],
    report: SAMPLE_REPORTS[(i + 1) % SAMPLE_REPORTS.length],
  }));
}

@Component({
  selector: 'app-text-playground',
  templateUrl: './text-playground.html',
  styleUrl: './text-playground.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    // Material
    MatButtonModule,
    MatButtonToggleModule,
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
  // Page sub header: the value lives in a phone-width slot at the inline END of
  // a full-bleed bar, so it sits flush against the screen edge AND can only
  // ellipsize. Exposed to the template so the switch can swap the two cases.
  // ---------------------------------------------------------------------------
  protected readonly SHORT_OWNER = SHORT_OWNER;
  protected readonly LONG_OWNER = LONG_OWNER;
  protected subheaderOwner = signal(LONG_OWNER);

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
  // Table examples: isSingleLine (the VALUE) vs wrapBehavior (the PAINT)
  //
  // Two tables — one per isSingleLine — each with an exclusive wrapBehavior
  // toggle, so every combination is two clicks away. Each column is narrower
  // than its content, so every cell has to make the decision under test.
  // ---------------------------------------------------------------------------

  /** "Single Line in Table": one whitespace-heavy column, one unbreakable-word column. */
  protected singleLineColumns = ['position', 'title', 'compound'];
  protected singleLineRows: DemoRow[] = makeDemoRows(4);
  protected singleLineWrap = signal<InlineTextWrapBehavior>('noWrap');

  /**
   * "Text Area in Table": authored line breaks, with and without a long word.
   * No paint controls here — multi-line always wraps (`wrapBehavior` is
   * single-line-only).
   */
  protected textAreaColumns = ['position', 'note', 'report'];
  protected textAreaRows: DemoRow[] = makeDemoRows(4);

  // ---------------------------------------------------------------------------
  // Floating nav
  // ---------------------------------------------------------------------------
  // Plain `href="#…"` resolves against `<base href="/">` and would navigate to
  // "/#…", losing the /text route — so the nav scrolls programmatically.
  // scrollIntoView also handles the real scroll container (the sidenav
  // content, not the document); `scroll-margin-top` clears the sticky tabs.
  protected scrollToExample(event: Event, id: string) {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

}
