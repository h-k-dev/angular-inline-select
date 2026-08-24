import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
  output,
} from '@angular/core';
import {
  FormField,
  form,
  required,
  pattern,
  min,
  max,
  maxLength,
  readonly,
  disabled,
} from '@angular/forms/signals';

// Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// Components — core entry point
import { AngularInlineText } from '../../../../../../angular-inline-select/src/lib/angular-inline-text/angular-inline-text';
import { AngularInlineNumber } from '../../../../../../angular-inline-select/src/lib/angular-inline-number/angular-inline-number';
import {
  EditablePrefix,
  EditableSuffix,
} from '../../../../../../angular-inline-select/src/lib/angular-inline-text/editable-affix';
import { EditableHint } from '../../../../../../angular-inline-select/src/lib/angular-inline-text/editable-hint';
import { EditableMenu } from '../../../../../../angular-inline-select/src/lib/angular-inline-text/editable-menu';
import { EditableErrorTemplate } from '../../../../../../angular-inline-select/src/lib/angular-inline-text/editable-error';
import { AngularInlineJson } from '../../../../../../angular-inline-select/json/src/angular-inline-json';

// Secondary entry points
import { AngularInlinePhone, createLibphonenumberCodec } from 'angular-inline-select/phone';
import metadata from 'libphonenumber-js/metadata.min.json';
import examples from 'libphonenumber-js/examples.mobile.json';
import {
  AngularInlineDate,
  AngularInlineTime,
  AngularInlineDuration,
  composeDbEntry,
  dayToDbEntry,
  dayEndToDbEntry,
  type IsoDateRange,
  type DbTimeRange,
} from 'angular-inline-select/temporal';

/** One phone engine for every instance of the grid — the metadata is expensive. */
const phoneCodec = createLibphonenumberCodec(metadata, examples);

/** The record behind the grid: one model, one signal form, every control. */
export interface RecordModel {
  project: string;
  summary: string;
  status: string;
  reference: string;
  callsign: string;
  budget: number | null;
  cable: number | string | null;
  crew: number | null;
  telephone: string | null;
  mobile: string | null;
  deadline: string | null;
  vacation: IsoDateRange | null;
  kickoff: string | null;
  shift: DbTimeRange | null;
  estimate: number | null;
  metadata: string;
}

/** A settled commit, forwarded to the page's event console. */
export interface FieldGridEmission {
  name: string;
  payload: unknown;
}

const SUMMARY_MAX = 160;

/** Slash-menu options for the status field — the consumer owns the list. */
const STATUS_OPTIONS = [
  { id: 'status-todo', label: 'To do', icon: 'radio_button_unchecked' },
  { id: 'status-active', label: 'In progress', icon: 'pending' },
  { id: 'status-blocked', label: 'Blocked', icon: 'block' },
  { id: 'status-shipped', label: 'Shipped', icon: 'check_circle' },
] as const;

function initialRecord(): RecordModel {
  return {
    project: 'Aurora',
    summary:
      'A label/value grid that folds to stacked rows when its CONTAINER runs out of room. ' +
      'Every value here is an inline editable — click one and type.',
    status: 'In progress',
    reference: 'Junction Point Observatory / Western Rim / survey sector nine / dossier 4471-B',
    callsign: 'AUR-01',
    budget: 48500,
    cable: 48.5,
    crew: 12,
    telephone: '+49301234567',
    mobile: null,
    deadline: dayToDbEntry('2026-07-20'),
    vacation: { start: dayToDbEntry('2026-07-21'), end: dayEndToDbEntry('2026-07-24') },
    kickoff: composeDbEntry('2026-07-20', '09:30'),
    shift: {
      start: composeDbEntry('2026-07-21', '22:00'),
      end: composeDbEntry('2026-07-22', '01:30'),
    },
    estimate: 5400,
    metadata: '{"tags":["survey","rim"],"priority":2}',
  };
}

/**
 * The pattern itself: a label/value grid whose pairs sit SIDE BY SIDE while the
 * container has room and fold TOP DOWN under 40ch. The query is on the
 * CONTAINER, so the same markup can be two-column in a wide page column and
 * stacked in a narrow one — no viewport media query, no measurement, no inputs.
 *
 * It doubles as the tour of the library: every inline control and every slot
 * (prefix, suffix, panel hint, slash menu, projected errors) takes a row, so
 * the fold is exercised against real values rather than placeholders.
 */
@Component({
  selector: 'app-field-grid',
  templateUrl: './field-grid.html',
  styleUrl: './field-grid.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    // Material
    MatButtonModule,
    MatIconModule,

    // Forms
    FormField,

    // Components
    AngularInlineText,
    AngularInlineNumber,
    AngularInlinePhone,
    AngularInlineDate,
    AngularInlineTime,
    AngularInlineDuration,
    AngularInlineJson,

    // Slots
    EditablePrefix,
    EditableSuffix,
    EditableHint,
    EditableMenu,
    EditableErrorTemplate,
  ],
})
export class FieldGrid {
  /** Every settled commit, for the page's event console. */
  readonly emitted = output<FieldGridEmission>();

  protected readonly codec = phoneCodec;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly summaryMax = SUMMARY_MAX;

  /** Callsigns are typed in the shape they are stored in — the filter says so. */
  protected readonly callsignChars = /[A-Z0-9-]/;

  // ---------------------------------------------------------------------------
  // The record: one model, one form, every control
  // ---------------------------------------------------------------------------
  protected recordModel = signal<RecordModel>(initialRecord());

  protected fieldRequired = signal(true);
  protected fieldReadonly = signal(false);
  protected fieldDisabled = signal(false);

  protected recordForm = form(this.recordModel, (path) => {
    // The schema decides validity only — the error TEXTS live in the projected
    // [editable-error] content (the mat-error split).
    required(path.project, { when: () => this.fieldRequired() });
    required(path.telephone, { when: () => this.fieldRequired() });

    maxLength(path.summary, SUMMARY_MAX);
    pattern(path.callsign, /^[A-Z]{2,4}-\d{1,3}$/);
    min(path.budget, 0);
    max(path.budget, 100_000);

    // Applied to the ROOT: readonly/disabled cascade over the whole subtree, so
    // one toggle puts every control in the grid into that state at once.
    readonly(path, { when: () => this.fieldReadonly() });
    disabled(path, { when: () => this.fieldDisabled() });
  });

  // The `hasError(...)` analogues — WHICH error the projected content
  // describes; WHEN it shows is the field's own job.
  protected projectMissing = computed(() =>
    this.recordForm
      .project()
      .errors()
      .some((error) => error.kind === 'required'),
  );

  protected telephoneMissing = computed(() =>
    this.recordForm
      .telephone()
      .errors()
      .some((error) => error.kind === 'required'),
  );

  protected callsignPatternBroken = computed(() =>
    this.recordForm
      .callsign()
      .errors()
      .some((error) => error.kind === 'pattern'),
  );

  protected budgetOutOfRange = computed(() =>
    this.recordForm
      .budget()
      .errors()
      .some((error) => error.kind === 'min' || error.kind === 'max'),
  );

  protected summaryTooLong = computed(() =>
    this.recordForm
      .summary()
      .errors()
      .some((error) => error.kind === 'maxLength'),
  );

  /** Live counter for the summary's panel hint — feedback that never touches the draft. */
  protected summaryLength = computed(() => this.recordModel().summary.length);

  // ---------------------------------------------------------------------------
  // Slots
  // ---------------------------------------------------------------------------
  /** Two decimals for the budget — the € lives in the suffix, outside the draft. */
  protected budgetFormat = (value: number | null): string =>
    value === null ? '' : value.toFixed(2);

  /** The status slash menu's options, filtered by the live query. */
  protected filterStatus(query: string) {
    const needle = query.trim().toLowerCase();
    return this.statusOptions.filter((option) => option.label.toLowerCase().includes(needle));
  }

  // ---------------------------------------------------------------------------
  // Card controls
  // ---------------------------------------------------------------------------
  protected resetRecord() {
    this.recordModel.set(initialRecord());
    this.recordForm().reset();
  }

  protected logEmit(name: string, payload: unknown) {
    this.emitted.emit({ name, payload });
  }
}
