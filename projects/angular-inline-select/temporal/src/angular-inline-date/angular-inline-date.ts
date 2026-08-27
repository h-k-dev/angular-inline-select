import {
  Component,
  ElementRef,
  Injector,

  // Signals
  afterNextRender,
  computed,
  contentChild,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  type Signal,
  type TemplateRef,
  viewChild,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';

// CDK
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  type ConnectedPosition,
} from '@angular/cdk/overlay';

// Form
import { FormValueControl, type ValidationError } from '@angular/forms/signals';

// Core
import {
  EDITABLE_SCOPE,
  EditablePrefix,
  EditableSuffix,
  BubbleMenu,
  EditableClearButton,
  EditableClearTemplate,
  type BubbleMenuSide,
  type EditableClearContext,
} from 'angular-inline-select';
import {
  parseDateInput,
  formatIsoDate,
  describeIsoDate,
  buildDateCommands,
  inferDateShape,
  toInternalRange,
  echoDateShape,
  dateValuesEqual,
  localeDatePlaceholder,
  type DateCommand,
  type DateSavedDetails,
  type IsoDate,
  type InlineDateValue,
  type DateValueShape,
  type InternalDateRange,
} from './date-codec';
import { INLINE_TEMPORAL_BUBBLE_SIDE, INLINE_TEMPORAL_LEAF_STATE } from '../leaf-state';
import {
  dayToDbEntry,
  dayEndToDbEntry,
  localDayOf,
  toDateTime,
  type DbDateTime,
} from '../datetime/db-entry';
import { INLINE_TEMPORAL_ZONE } from '../datetime/zone';
import {
  makeSideSessionChrome,
  makeClearBubbleVisibility,
  makeClearContexts,
  makeShapeMemory,
  makeSideCore,
  sideSize,
  wireEditingBridge,
  type SideCore,
  type SideKey,
} from '../side-session';
import { TemporalIntl } from '../temporal-intl';
import { Calendar } from './calendar/calendar';

/**
 * The `resolved` verdict, per side: `true` when that side's BOUND entry is
 * readable or empty, `false` while an injected entry (e.g. a backend
 * `'0000-00-00 00:00:00'`) is present but unreadable. A single-string
 * binding speaks through `start`; `end` idles at `true` there.
 */
export interface DateResolvedState {
  start: boolean;
  end: boolean;
}

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineDateSaved {
  /** The value the session settled on, in the consumer's bound shape. */
  value: InlineDateValue;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
}

/**
 * The date side: the shared session core (see `SideCore`; `committed` is
 * this side's LOCAL day) plus what a DATE session must snapshot.
 */
interface DateSide extends SideCore<IsoDate> {
  /** The committed day at session start — what Escape and snap-back restore. */
  baselineDay: IsoDate | null;
  /**
   * The UNRESOLVED raw entry at session start (`null` when the baseline was
   * a readable day or empty). When set, Escape and snap-back restore THIS
   * verbatim — a `baselineDay` of `null` over an occupied value must never
   * settle to `null` (that would be the swallow this control refuses).
   */
  baselineRaw: DbDateTime | null;
  /**
   * The draft's codec reading, CACHED per side (`null` empty, `undefined`
   * unreadable) — the one parse per keystroke every consumer (live channel,
   * grid, preview, parse gate, settlement) reads.
   */
  readonly parsed: Signal<IsoDate | null | undefined>;
}

/**
 * Inline date on NATIVE INPUTS — the input rehost (see ROADMAP-DATETIME).
 * A `FormValueControl` for calendar dates and date RANGES. Canonical value:
 * UTC ISO DB entries (iusta's `toDBEntry` of the local `startOf('day')`;
 * range ends `endOf('day')`), SHAPE-ECHOED — a string binds ONE field, an
 * object binds the start–end pair. Display is the localized local day.
 *
 * The family feel is styling, not shared DOM: dashed underline idle, solid
 * error color when invalid, `field-sizing: content` + a fixed-size
 * placeholder so layout shift is impossible.
 *
 * Session semantics are GESTURE-TIERED (the Notion/GCal convention):
 * - Enter  = explicit commit — an unreadable draft BLOCKS with the error.
 * - Escape = two-stage, the house convention: the first press peels the
 *   summoned panel (draft intact), the next reverts to the session
 *   baseline. A panel showing only the parse gate is skipped — a broken
 *   draft clears in ONE press.
 * - Tab / blur = navigation, never a validity checkpoint: a readable draft
 *   COMMITS and focus moves on; an unreadable draft SNAPS BACK to the
 *   baseline and focus moves anyway. Never trap, never persist a draft
 *   error — the idle solid underline is reserved for SCHEMA errors.
 *
 * The calendar opens on focus WITHOUT stealing it (the grid mirrors the
 * typed draft per keystroke); ArrowDown hands focus to the grid; a pick
 * COMMITS the focused side — and hands the session to the empty other side
 * when picking a range.
 *
 * An UNRESOLVED injected value (a bound entry the codec cannot read — a
 * backend `'0000-00-00 00:00:00'`) is neither swallowed nor dismissed: the
 * raw entry displays verbatim under the error underline, `resolved` carries
 * the per-side verdict (and the acknowledge seam), and Escape/snap-back
 * restore the raw entry — only an actual commit or clear replaces it.
 * Date-only; duration and time have no such gate.
 */
@Component({
  selector: 'angular-inline-date',
  imports: [
    NgTemplateOutlet,

    // CDK
    CdkConnectedOverlay,
    CdkOverlayOrigin,

    // Components
    Calendar,
    BubbleMenu,
    EditableClearButton,
  ],
  templateUrl: './angular-inline-date.html',
  styleUrl: './angular-inline-date.scss',
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineDate implements FormValueControl<InlineDateValue> {
  #document = inject(DOCUMENT);
  #injector = inject(Injector);

  /**
   * The committed value channel — polymorphic UTC ISO DB entries (iusta's
   * `toDBEntry`): a single string binds a single date, `{ start, end? }`
   * binds a range, and the control ECHOES whichever shape it received.
   * Behind the back a day is its local `startOf('day')` in UTC (range ends
   * `endOf('day')`); the DISPLAY is the localized local calendar day.
   */
  value = model<InlineDateValue>(null);

  /**
   * Cold-start shape default: which shape a `null`-bound field emits before
   * any non-null value has declared one. Ignored once a shape has been seen.
   */
  ranged = input(false);

  /** Form Value Contract. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  /**
   * Placeholder override. Unset, the field shows the LOCALE'S numeric date
   * pattern, spelled in the locale's own field letters (`'tt.mm.jjjj'`
   * German, `'mm/dd/yyyy'` en-US; letters from `TemporalIntl`) — fixed size
   * per locale, so the placeholder-floored width never shifts.
   */
  placeholder = input<string | undefined>(undefined);
  /**
   * End-field placeholder override. Unset, a FULLY EMPTY range shows the
   * locale pattern on both sides; once a start exists the end side switches
   * to the half-open display (`'Jul 21 – …'`).
   */
  endPlaceholder = input<string | undefined>(undefined);

  /** Public: the resolved placeholder verdict (adapters render from this, not the input). */
  readonly effectivePlaceholder = computed(() => {
    const explicit = this.placeholder();
    if (explicit !== undefined) return explicit;

    const locale = this.locale();
    return localeDatePlaceholder(locale, this.intl.datePlaceholderTokens(locale));
  });

  /**
   * The UNIFORM adapter surface (every temporal control exposes it): the
   * resolved placeholder text, so hosting containers never branch on the
   * concrete control.
   */
  readonly placeholderText = computed(() => this.effectivePlaceholder());
  protected effectiveEndPlaceholder = computed(() => {
    const explicit = this.endPlaceholder();
    if (explicit !== undefined) return explicit;
    return this.internalRange().start === null ? this.effectivePlaceholder() : '…';
  });

  /** Accessible base name; ranged fields append " start" / " end". */
  ariaLabel = input<string | undefined>(undefined);

  /**
   * Which edge a SINGLE field's clear bubble grows from. Unset, the leaf
   * ROLE decides (`INLINE_TEMPORAL_BUBBLE_SIDE` — `rangeDay`/`rangeStart`
   * provide `'start'` so inline-START leaves open outward), else `'end'`.
   * Range fields ignore this: each side's bubble always opens outward
   * (start→left, end→right).
   */
  clearBubbleSide = input<BubbleMenuSide | undefined>(undefined);

  #bubbleSideDefault = inject(INLINE_TEMPORAL_BUBBLE_SIDE, { optional: true });

  protected effectiveClearBubbleSide = computed(
    () => this.clearBubbleSide() ?? this.#bubbleSideDefault ?? 'end',
  );

  /** Locale for display + parsing (`Intl`); browser default when omitted. */
  locale = input<string | string[] | undefined>(undefined);

  /**
   * T6 — the DISPLAY ZONE (IANA id): which zone's calendar day the value
   * boundary speaks. Falls back to the app-wide `INLINE_TEMPORAL_ZONE`
   * provider, then the machine zone. Values stay UTC DB entries.
   */
  zone = input<string | undefined>(undefined);

  #zoneDefault = inject(INLINE_TEMPORAL_ZONE, { optional: true });

  readonly effectiveZone = computed(() => this.zone() ?? this.#zoneDefault?.());

  /** The calendar grid affordance (📅 trigger + open-on-focus popup). */
  showCalendar = input(true);

  /**
   * Generic overlay-anchor override — a container seam, NOT a mat one. When
   * unset (the default) the panel anchors to the bare `.inline-date` wrapper.
   * A host that draws its own chrome (the mat adapter passes the form field's
   * flex box; a dense table cell could pass its own) hands the ElementRef/
   * element here so the calendar anchors under the WHOLE field, below the
   * underline — never learning what that container is. The control stays
   * mat-ignorant; the type is CDK-generic, not Material. `model` (not
   * `input`) so a host directive on the same element can `.set()` it
   * programmatically — the same public-writable seam as `editing`.
   */
  overlayOrigin = model<ElementRef<HTMLElement> | HTMLElement | null>(null);

  /**
   * Quick-pick commands rendered as chips in the panel. Defaults to
   * yesterday/today/tomorrow — INJECTABLE so a consumer's copy can grow
   * its own presets ("last 30 days") without touching the control.
   */
  quickPicks = input<readonly DateCommand[] | undefined>(undefined);

  /** Reference clock — injectable for tests; a fresh `Date` per read otherwise. */
  now = input<() => Date>(() => new Date());

  /** Affix template passthrough (composition channel + content sugar). */
  prefixTemplate = input<TemplateRef<unknown> | undefined>(undefined);
  suffixTemplate = input<TemplateRef<unknown> | undefined>(undefined);

  private contentPrefix = contentChild(EditablePrefix);
  private contentSuffix = contentChild(EditableSuffix);

  protected prefixTpl = computed(() => this.prefixTemplate() ?? this.contentPrefix()?.templateRef);
  protected consumerSuffixTpl = computed(
    () => this.suffixTemplate() ?? this.contentSuffix()?.templateRef,
  );

  /**
   * Group-forwarded contract state (role-provided; absent standalone).
   * Merged by PULL — the leaf stays decoupled, no effects involved.
   */
  #leafState = inject(INLINE_TEMPORAL_LEAF_STATE, { optional: true, self: true });

  /** Public: the composed disabled verdict (own input + group-fed state). */
  readonly effectiveDisabled = computed(
    () => this.disabled() || (this.#leafState?.disabled() ?? false),
  );
  protected effectiveReadonly = computed(
    () => this.readonly() || (this.#leafState?.readonly() ?? false),
  );
  protected effectiveTouched = computed(
    () => this.touched() || (this.#leafState?.touched() ?? false),
  );
  protected effectiveInvalid = computed(
    () => this.invalid() || (this.#leafState?.invalid() ?? false),
  );

  /** Form Value Contract: touch — emitted whenever a session settles. */
  touch = output<void>();

  /**
   * THE consumer commit event — the family DNA: fires once per changed
   * settlement (accept-timed, change-gated) with the date MODEL as Luxon
   * details (`DateSavedDetails`; single mode always carries `end: null`).
   * App code binds this; the raw bound value still flows through `value`.
   */
  savedModelChange = output<DateSavedDetails>();

  /**
   * The MACHINERY channel: exactly one emission per settled session (commit,
   * snap-back, Escape, clear — changed or not). Range groups and hosting
   * adapters bind this; app consumers should bind `savedModelChange`.
   */
  saved = output<InlineDateSaved>();

  /** Whether an edit session is open (= focus is within). Two-way bindable. */
  editing = model(false);

  #shapeMemory = makeShapeMemory<InlineDateValue, DateValueShape>({
    value: this.value,
    infer: inferDateShape,
    ranged: this.ranged,
    singleShape: 'single',
    rangeShape: 'range',
  });

  /** The effective shape: last seen, or the `ranged` cold-start default. */
  readonly shape = this.#shapeMemory.shape;

  /** Object shapes render the start–end input pair; a string renders one field. */
  protected twoFields = this.#shapeMemory.twoFields;

  /**
   * One canonical internal model, always: `{ start, end }` as LOCAL
   * calendar DAYS — the user-facing side; DB entries live only at the
   * value boundary.
   *
   * A WRITABLE view (22.1 `linkedSignal`, custom `set`): reads derive from
   * `value`, and writing a day range routes SYNCHRONOUSLY back through the
   * shape echo into `value` — every commit path speaks days, and the DB
   * conversion lives in exactly one place. Echo-equal writes are dropped,
   * so the write-back can never loop.
   */
  readonly internalRange = linkedSignal<InlineDateValue, InternalDateRange>({
    source: this.value,
    computation: (value) => {
      const zone = this.effectiveZone();
      const { start, end } = toInternalRange(value);
      return {
        start: start === null ? null : localDayOf(start, zone),
        end: end === null ? null : localDayOf(end, zone),
      };
    },
    set: (range) => {
      const echoed = this.#daysToDbShape(range, this.shape());
      if (!dateValuesEqual(echoed, this.value())) this.value.set(echoed);
    },
  });

  /** The value boundary, outbound: local days → DB entries in the echoed shape. */
  #daysToDbShape(days: InternalDateRange, shape: DateValueShape): InlineDateValue {
    const zone = this.effectiveZone();
    const echoed = echoDateShape(days, shape);
    if (echoed === null) return null;
    if (typeof echoed === 'string') return dayToDbEntry(echoed, zone);

    const start = echoed.start === null ? null : dayToDbEntry(echoed.start, zone);
    if (!('end' in echoed)) return { start };

    return { start, end: echoed.end == null ? null : dayEndToDbEntry(echoed.end, zone) };
  }

  // -- Unresolved injected values (display, never swallow) -----------------------

  /**
   * The bound value's RAW per-side entries (`''` normalized to `null`) —
   * what the consumer actually handed us, BEFORE the codec's verdict. The
   * `internalRange`/`#rawRange` pair is what makes an UNRESOLVED injected
   * value (a backend `'0000-00-00 00:00:00'`) visible instead of swallowed:
   * its day reads `null`, but the raw entry keeps existing here.
   */
  readonly #rawRange = computed<InternalDateRange>(() => {
    const { start, end } = toInternalRange(this.value());
    return { start: start || null, end: end || null };
  });

  /** A side's codec verdict on the BOUND value: raw present but unreadable. */
  #sideUnresolved(key: SideKey): boolean {
    return this.#rawRange()[key] !== null && this.internalRange()[key] === null;
  }

  /** The raw entry a session must restore when its baseline day reads `null` but the value wasn't empty. */
  #unresolvedRawOf(key: SideKey): DbDateTime | null {
    return this.#sideUnresolved(key) ? this.#rawRange()[key] : null;
  }

  /**
   * Whether the BOUND value resolved through the codec, PER SIDE (see
   * `DateResolvedState`) — a `false` side shows its raw entry VERBATIM
   * under the error underline rather than swallowing or dismissing it; a
   * commit, clear, or fresh injection re-derives the verdict. THE one
   * mechanism of the unresolved feature: the template classes,
   * `aria-invalid` and consumers all read this signal.
   *
   * Writable — the ACKNOWLEDGE seam: `resolved.set({ start: true, end:
   * true })` lifts the flag without touching the value (the raw entry
   * stays on display, quietly). The custom `set` (22.1) clamps writes to
   * acknowledgements: a side whose entry actually reads fine can never be
   * flagged `false` — only the codec issues that verdict. Sourced on the
   * unresolved RAW entries — not booleans — so a DIFFERENT bad injection
   * re-derives the verdict even after an acknowledgement of the previous
   * one. Date-only — duration and time have no such gate.
   */
  readonly resolved = linkedSignal<
    { start: DbDateTime | null; end: DbDateTime | null },
    DateResolvedState
  >({
    source: computed(() => ({
      start: this.#unresolvedRawOf('start'),
      // A single-string binding mirrors its raw into `end` INTERNALLY; the
      // verdict speaks the CONSUMER's shape, where no end side exists.
      end: this.twoFields() ? this.#unresolvedRawOf('end') : null,
    })),
    computation: (unresolved) => ({
      start: unresolved.start === null,
      end: unresolved.end === null,
    }),
    equal: (a, b) => a.start === b.start && a.end === b.end,
    set: (next, rawSet) =>
      rawSet({
        start: next.start || this.#unresolvedRawOf('start') === null,
        end: next.end || !this.twoFields() || this.#unresolvedRawOf('end') === null,
      }),
  });

  // -- The two sides -----------------------------------------------------------

  readonly #startSide = this.#makeSide('start');
  readonly #endSide = this.#makeSide('end');

  #side(key: SideKey): DateSide {
    return key === 'start' ? this.#startSide : this.#endSide;
  }

  #makeSide(key: SideKey): DateSide {
    const committed = computed(() => this.internalRange()[key]);
    const display = computed(() => {
      const day = committed();
      if (day !== null) return formatIsoDate(day, this.locale());

      // An unresolved injected value displays VERBATIM — never swallowed.
      return this.#rawRange()[key] ?? '';
    });
    const core = makeSideCore(key, committed, display);

    return {
      ...core,
      baselineDay: null,
      baselineRaw: null,
      parsed: computed(() =>
        parseDateInput(core.draft(), this.now()(), this.locale(), this.effectiveZone()),
      ),
    };
  }

  protected startDraft = computed(() => this.#startSide.draft());
  protected endDraft = computed(() => this.#endSide.draft());

  /** The localizable chrome strings (nav/clear/quick-pick labels, revert prose). */
  protected intl = inject(TemporalIntl);

  /** The shared session chrome: focus target, snap-back flash, focus timers. */
  #chrome = makeSideSessionChrome((key) => this.#inputOf(key));

  protected focusTarget = this.#chrome.focusTarget;

  protected overlayOpen = signal(false);

  /**
   * One-shot: the `focusin` that Escape's own focus-return fires must not
   * re-open the panel Escape just closed. Set by `escapeCalendar`, consumed
   * by the next `handleFocusIn`. A flag rather than statement order, because
   * `focus()` dispatches `focusin` asynchronously in some environments —
   * closing "after" the focus call is not a guarantee anywhere.
   */
  #suppressPanelOnFocus = false;

  /** Public: whether the panel is showing (hosting containers coordinate on it). */
  readonly panelVisible = computed(() => this.overlayOpen());

  protected startInput = viewChild<ElementRef<HTMLInputElement>>('startInput');
  protected endInput = viewChild<ElementRef<HTMLInputElement>>('endInput');
  protected calendar = viewChild(Calendar);
  protected panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  /**
   * The current draft's ISO reading (`null` empty, `undefined` unreadable)
   * — a SELECTION over the sides' cached parses, so a focus flip never
   * re-parses an unchanged draft.
   */
  readonly parsedDraft = computed(() => this.#side(this.focusTarget() ?? 'start').parsed());

  /** The parse gate: whether the focused draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(() => this.parsedDraft() === undefined);

  #selfTouched = signal(false);

  protected isInvalid = computed(
    () =>
      this.effectiveInvalid() ||
      this.errors().length > 0 ||
      (this.#leafState?.errors().length ?? 0) > 0,
  );

  /**
   * The mat split: the consumer decides what errors say, the field when they
   * show. Public — it is the field's presentational verdict, the thing a
   * hosting container (a mat-form-field adapter) needs to mirror.
   */
  readonly errorsVisible = computed(
    () => this.isInvalid() && (this.effectiveTouched() || this.#selfTouched()),
  );

  /**
   * Public: whether the field holds no value at all (both sides empty).
   * Reads the RAW range — an unresolved injected value counts as content.
   */
  readonly isEmpty = computed(() => {
    const { start, end } = this.#rawRange();
    return start === null && end === null;
  });

  /** The parse-gate reveal: Enter was attempted on an unreadable draft. */
  protected parseGateVisible = computed(() => {
    const key = this.focusTarget();
    return key !== null && this.#side(key).saveAttempted() && this.parseFailed();
  });

  protected errorSlotVisible = computed(() => this.errorsVisible() || this.parseGateVisible());

  /** Live interpretation preview: `Tuesday, 12 May 2026` / `… raw`. */
  protected preview = computed(() => {
    const side = this.#side(this.focusTarget() ?? 'start');
    const raw = side.draft().trim();
    if (!raw) return '';

    const iso = side.parsed();
    if (iso === null || iso === undefined) return `… ${raw}`;

    return `${describeIsoDate(iso, this.locale())}`;
  });

  /** The grid's pending day: the focused side's parsed draft, else its committed day. */
  protected pendingDay = computed<IsoDate | null>(() => {
    const side = this.#side(this.focusTarget() ?? 'start');
    const draft = side.parsed();
    if (typeof draft === 'string') return draft;

    return side.committed() ?? this.internalRange().start;
  });

  protected selectedForGrid = computed(() =>
    this.focusTarget() === 'end' ? this.internalRange().end : this.internalRange().start,
  );

  /** Quick-pick chips: consumer-injected, else yesterday/today/tomorrow. */
  protected quickPickList = computed(
    () =>
      this.quickPicks() ??
      buildDateCommands(this.now()(), this.locale(), this.effectiveZone()).slice(0, 3),
  );

  protected overlayPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  protected revertFlash = this.#chrome.revertFlash;
  protected revertNotice = this.#chrome.revertNotice;

  constructor() {
    wireEditingBridge({
      editing: this.editing,
      focusTarget: this.focusTarget,
      focusSide: (key) => this.#chrome.focusSide(key),
      deactivate: (focused) => {
        this.#settle(focused);
        this.overlayOpen.set(false);
        this.focusTarget.set(null);
        this.#inputOf(focused)?.blur();
      },
    });
  }

  // -- Sizing (no layout shift: content-sized, placeholder-floored) -------------

  protected sizeOf(key: SideKey): number {
    const placeholder =
      key === 'end' ? this.effectiveEndPlaceholder() : this.effectivePlaceholder();
    return sideSize(this.#side(key).draft(), placeholder);
  }

  protected ariaLabelOf(key: SideKey): string {
    return this.intl.fieldLabel(this.ariaLabel() ?? this.intl.dateLabel(), key, this.twoFields());
  }

  protected ariaInvalidOf(key: SideKey): boolean {
    const side = this.#side(key);
    return (
      this.errorsVisible() ||
      !this.resolved()[key] ||
      (side.open() && side.saveAttempted() && this.parseFailed())
    );
  }

  // -- The live channel ---------------------------------------------------------

  /** Every keystroke: readable drafts flow into the model live, in the bound shape. */
  protected handleInput(key: SideKey, raw: string) {
    const side = this.#side(key);
    // A settled-but-still-focused field (Enter, outside click) restarts its
    // session on the next keystroke.
    if (!side.open()) {
      side.baselineDay = side.committed();
      side.baselineRaw = this.#unresolvedRawOf(key);
      side.open.set(true);
    }

    side.draft.set(raw); // the setter marks the side dirty
    side.saveAttempted.set(false);
    this.overlayOpen.set(true);

    const day = side.parsed();
    if (day !== undefined) this.#writeSideDay(key, day);
  }

  /**
   * Writes one side's local day into the value, echoed in the bound shape.
   * In the one-key `{ start }` shape the end is a MIRROR, not data — a
   * start edit moves the single-day range whole; only an END edit creates
   * a distinct end (and grows the key, per the echo).
   */
  #writeSideDay(key: SideKey, day: IsoDate | null) {
    const current = this.internalRange();
    const moveWhole = !this.twoFields() || (key === 'start' && this.shape() === 'start-only');
    const next: InternalDateRange = moveWhole
      ? { start: day, end: day }
      : key === 'start'
        ? { start: day, end: current.end }
        : { start: current.start, end: day };

    // The linked view carries the write back (echoed shape, deduped).
    this.internalRange.set(next);
  }

  /**
   * Restores a side's RAW bound entry verbatim (same slot logic as
   * `#writeSideDay`, but the entry bypasses the day view — it has no day) —
   * the un-swallow: an unresolved injected value survives Escape and
   * snap-back exactly as it arrived, error underline and all.
   */
  #writeSideRaw(key: SideKey, raw: DbDateTime) {
    const current = toInternalRange(this.value());
    const moveWhole = !this.twoFields() || (key === 'start' && this.shape() === 'start-only');
    const next: InternalDateRange = moveWhole
      ? { start: raw, end: raw }
      : key === 'start'
        ? { start: raw, end: current.end }
        : { start: current.start, end: raw };

    const echoed = echoDateShape(next, this.shape());
    if (!dateValuesEqual(echoed, this.value())) this.value.set(echoed);
  }

  // -- Focus flow ----------------------------------------------------------------

  protected handleFocusIn(key: SideKey) {
    // Tab-advance: focus landing HERE ends the partner's session. It settles
    // NOW — before this session snapshots its baseline — so Escape and
    // snap-back never resurrect a pre-SORT pair (a settle can move the
    // partner: the typed-commit sort).
    const partner = this.#side(key === 'start' ? 'end' : 'start');
    if (partner.open()) this.#settle(partner.key);

    const side = this.#side(key);
    if (!side.open()) {
      side.baselineDay = side.committed();
      side.baselineRaw = this.#unresolvedRawOf(key);
      side.dirty.set(false);
      side.saveAttempted.set(false);
      side.open.set(true);
    }

    this.focusTarget.set(key);

    const suppressed = this.#suppressPanelOnFocus;
    this.#suppressPanelOnFocus = false;
    if (!suppressed && !this.effectiveReadonly() && !this.effectiveDisabled()) {
      this.overlayOpen.set(true);
    }

    this.editing.set(true);
  }

  /**
   * A pointer in the field OPENS the panel — it never closes it. This is the
   * only pointer route back in after a pick: the grid cells `preventDefault`
   * their mousedown, so focus never left the field, the next click fires no
   * `focusin`, and `handleFocusIn` never runs.
   *
   * Open-only, NOT a toggle, per the ARIA combobox division of labour: the
   * TEXTBOX is a text-editing surface — a click there is a caret move, and
   * must not also dismiss the popup (the touch case makes that plain) —
   * while the 📅 BUTTON is the toggle. Idempotent, so the pointer that also
   * brings focus simply agrees with `handleFocusIn`. Nothing is prevented:
   * the caret still lands where it was clicked.
   */
  protected handleInputPointerdown() {
    if (this.effectiveDisabled() || this.effectiveReadonly()) return;

    this.overlayOpen.set(true);
  }

  /**
   * Focusout settles ASYNCHRONOUSLY: where focus LANDS decides what happens
   * (the other input = Tab-advance, the panel = same session, outside =
   * settle + close), and that is only knowable a tick later.
   */
  protected handleFocusOut() {
    this.#chrome.scheduleFocusSettle(() => this.#onFocusSettled());
  }

  #onFocusSettled() {
    const active = this.#document.activeElement;
    const inStart = active !== null && active === this.startInput()?.nativeElement;
    const inEnd = active !== null && active === this.endInput()?.nativeElement;
    const inPanel = (active !== null && this.panelRef()?.nativeElement.contains(active)) ?? false;

    // The grid is part of the focused side's session — panel focus settles
    // nothing. A side that lost focus to anywhere else settles NOW:
    // commit-if-readable, snap-back if not. Never trap, never block.
    if (!inPanel) {
      if (this.#startSide.open() && !inStart) this.#settle('start');
      if (this.#endSide.open() && !inEnd) this.#settle('end');
    }

    if (!inStart && !inEnd && !inPanel) {
      this.overlayOpen.set(false);
      this.focusTarget.set(null);
      this.editing.set(false);
    } else if (inStart) {
      this.focusTarget.set('start');
    } else if (inEnd) {
      this.focusTarget.set('end');
    }
  }

  // -- Settlement (ONE per session — commit, snap-back, Escape, clear) -----------

  /**
   * Settles a side's session. Resolution order: an explicit `resolve` day
   * (calendar pick), `revert` (Escape), else the draft — where an
   * unreadable draft resolves to the BASELINE (snap-back; a brief flash +
   * aria-live announce the restoration, no persistent state).
   */
  #settle(
    key: SideKey,
    options: { resolve?: IsoDate | null; revert?: boolean; keepOpen?: boolean } = {},
  ) {
    const side = this.#side(key);
    if (!side.open()) return;

    // An untouched session settles where the value stands — no re-derive,
    // no write (see DateSide.dirty).
    const untouched = !options.revert && options.resolve === undefined && !side.dirty();

    let day: IsoDate | null;
    let snappedBack = false;
    if (untouched) {
      day = side.committed();
    } else if (options.revert) {
      day = side.baselineDay;
    } else if (options.resolve !== undefined) {
      day = options.resolve;
    } else {
      const parsed = side.parsed();
      snappedBack = parsed === undefined;
      day = parsed === undefined ? side.baselineDay : parsed;
    }

    // A baseline restoration (Escape, snap-back) over an UNRESOLVED injected
    // value restores the RAW entry — never the `null` its day reads as: that
    // write would be the swallow this control refuses.
    const baselineRaw = side.baselineRaw;
    const restoresRaw =
      !untouched && (options.revert || snappedBack) && day === null && baselineRaw !== null;

    if (!untouched) {
      if (restoresRaw) this.#writeSideRaw(key, baselineRaw!);
      else this.#writeSideDay(key, day);

      // A typed commit sorts like a calendar pick (iusta-style): a date
      // pair never lands inverted — days carry no overnight reading (that
      // is the TIME control's roll), so end-before-start is only ever
      // backwards. Restorations (Escape, snap-back) stay literal.
      if (!options.revert && !snappedBack) {
        this.#sortIfInverted();
        day = side.committed();
      }
    }
    // Settling away from an unresolved baseline changed the value even when
    // both days read `null` (raw → parsed day, raw → deliberately cleared).
    const changed =
      !untouched && !restoresRaw && (day !== side.baselineDay || baselineRaw !== null);
    side.dirty.set(false);

    if (options.keepOpen) {
      // Enter / pick settle in place: the session continues on the new baseline.
      side.baselineDay = day;
      side.baselineRaw = this.#unresolvedRawOf(key);
      side.restore();
      side.saveAttempted.set(false);
    } else {
      side.open.set(false);
      side.saveAttempted.set(false);
    }

    if (snappedBack) this.#chrome.announceRevert(key, side.display());

    this.#selfTouched.set(true);
    this.touch.emit();

    const value = this.value();
    if (changed) this.#emitSavedModel();
    this.saved.emit({ value, changed });
  }

  /**
   * The commit payload — the date MODEL as Luxon days (iusta's house
   * derivation; local midnights). Single mode always carries `end: null`;
   * the start-only shape reports its single-day range `[start, start]`.
   */
  #emitSavedModel() {
    const { start, end } = this.internalRange();
    this.savedModelChange.emit({
      start: toDateTime(start),
      end: this.twoFields() ? toDateTime(end) : null,
    });
  }

  // -- Keyboard -------------------------------------------------------------------

  /**
   * The ancestor Tab-to-accept scope, or `null`. The control commits on
   * Tab/blur NATIVELY — the scope only takes over WHERE focus goes: an
   * edge Tab (leaving the control, not the internal start↔end move) walks
   * the scope's stops instead of the raw DOM order, so the landed field's
   * session can open (`advanceMode: 'edit'`). The settle itself still runs
   * through the normal focusout path once focus has moved.
   */
  #scope = inject(EDITABLE_SCOPE, { optional: true });

  protected handleInputKeydown(key: SideKey, event: KeyboardEvent) {
    switch (event.key) {
      case 'Tab': {
        const scope = this.#scope;
        if (!scope?.tabCommits()) return;

        const direction = event.shiftKey ? -1 : 1;
        const internalMove =
          this.twoFields() &&
          ((key === 'start' && direction === 1) || (key === 'end' && direction === -1));
        if (internalMove) return; // the native side-to-side Tab stays

        // `'stay'` refuses the Tab like Enter's parse gate would. Only the
        // Tab GESTURE — blur can never be refused, so it keeps the native
        // snap-back regardless of policy.
        if (scope.onBlocked() === 'stay' && this.#side(key).parsed() === undefined) {
          event.preventDefault();
          this.#side(key).saveAttempted.set(true);
          scope.announce('blocked');
          return;
        }

        // Own the Tab only when the walk can place it. At the scope's edge
        // the NATIVE Tab proceeds — blur settles and focus leaves the
        // region, exactly the `wrap: false` contract. Preventing first
        // would turn the last field into a Tab trap.
        if (scope.advanceFrom(event.target as HTMLElement, direction)) event.preventDefault();
        return;
      }
      case 'Enter': {
        event.preventDefault();
        const side = this.#side(key);
        if (side.parsed() === undefined) {
          // The parse gate: the user ASKED for a commit — block and say why.
          side.saveAttempted.set(true);
          return;
        }

        this.#settle(key, { keepOpen: true });
        this.overlayOpen.set(false);
        return;
      }
      case 'Escape': {
        event.preventDefault();
        event.stopPropagation();

        // Stage 1 — peel the summoned panel, draft INTACT. The house
        // convention (the text control's slash menu does the same): cancel
        // addresses the innermost thing the user summoned, one layer per
        // press. Typing or a pointer brings the panel straight back, so
        // nothing is lost by dismissing it.
        //
        // Skipped while the parse gate is up: a panel that is only there to
        // say WHY the commit was refused is feedback, not summoned chrome,
        // and it does not survive the revert anyway — spending a press on it
        // would make a broken draft cost two Escapes to clear.
        if (this.overlayOpen() && !this.parseGateVisible()) {
          this.overlayOpen.set(false);
          return;
        }

        // Stage 2 — revert the draft to the session baseline (flash + announce).
        this.#settle(key, { revert: true, keepOpen: true });
        this.overlayOpen.set(false);
        return;
      }
      case 'ArrowDown': {
        // The combobox-datepicker handoff: focus moves INTO the grid.
        if (event.altKey || event.defaultPrevented) return;
        if (!this.showCalendar() || this.effectiveReadonly() || this.effectiveDisabled()) return;

        event.preventDefault();
        this.overlayOpen.set(true);

        const grid = this.calendar();
        if (grid) grid.focusGrid();
        else afterNextRender(() => this.calendar()?.focusGrid(), { injector: this.#injector });
        return;
      }
    }
  }

  // -- Calendar ---------------------------------------------------------------------

  /**
   * A pick IS a commit of the focused side. Picking a range with the other
   * side still empty hands the session over (the seamless two-pick flow);
   * otherwise the popup closes. An inverted pair is sorted, iusta-style.
   */
  protected pickDate(day: IsoDate) {
    const key = this.focusTarget() ?? 'start';
    const side = this.#side(key);
    if (!side.open()) {
      side.baselineDay = side.committed();
      side.baselineRaw = this.#unresolvedRawOf(key);
      side.open.set(true);
    }

    // Sort BEFORE settling: the settlement must emit the sorted value and
    // re-baseline the side on its own (possibly swapped) day — else the
    // frozen draft still shows the pre-sort pick and the next blur would
    // commit it back, un-sorting the pair.
    this.#writeSideDay(key, day);
    this.#sortIfInverted();
    this.#settle(key, { resolve: side.committed(), keepOpen: true });

    const other: SideKey = key === 'start' ? 'end' : 'start';
    if (this.twoFields() && this.#side(other).committed() === null) {
      // Handing the session over — the panel STAYS for the completing pick.
      this.#chrome.focusSide(other);
    } else {
      this.#closePanelReturningFocus(key);
    }
  }

  #sortIfInverted() {
    const { start, end } = this.internalRange();
    if (start !== null && end !== null && start > end) {
      // ISO days compare lexicographically.
      this.internalRange.set({ start: end, end: start });
    }
  }

  /**
   * Commits BOTH sides in one settlement (drag, Ctrl+click): one value
   * write, both sides re-baselined, ONE `saved`.
   */
  #commitBothSides(startDay: IsoDate | null, endDay: IsoDate | null) {
    const before = this.value();
    this.internalRange.set({ start: startDay, end: endDay });

    for (const key of ['start', 'end'] as const) {
      const side = this.#side(key);
      side.baselineDay = side.committed();
      side.baselineRaw = this.#unresolvedRawOf(key);
      side.restore();
      side.dirty.set(false);
      side.saveAttempted.set(false);
    }

    const value = this.value();
    const changed = !dateValuesEqual(value, before);
    this.#selfTouched.set(true);
    this.touch.emit();
    if (changed) this.#emitSavedModel();
    this.saved.emit({ value, changed });
  }

  /** A drag painted [start, end] — commit the pair whole and close. */
  protected commitDraggedRange(range: { start: IsoDate; end: IsoDate }) {
    this.#commitBothSides(range.start, range.end);
    this.#closePanelReturningFocus(this.focusTarget() ?? 'start');
  }

  /**
   * Ctrl/Cmd+click: "restart the range HERE" — start = the day, end clears
   * (a committed half-open range), and the session hands to the end side so
   * the very next pick completes the pair.
   */
  protected ctrlPickDate(day: IsoDate) {
    if (!this.twoFields()) {
      this.pickDate(day);
      return;
    }

    this.#commitBothSides(day, null);
    this.#chrome.focusSide('end');
  }

  /**
   * Escape in the grid is the SAME peel as Escape in the input: leave the
   * calendar — close it and hand control back to the focused input, draft
   * intact. Collapsing the two into one layer keeps the stack exactly two
   * deep (calendar, then draft), so reverting from inside the grid never
   * costs three presses.
   */
  protected escapeCalendar() {
    this.#closePanelReturningFocus(this.focusTarget() ?? 'start');
  }

  /**
   * Closes the panel and puts focus back on a side's input — the one correct
   * way to do those two things together. Naive `set(false)` + `focusSide()`
   * does NOT work: when focus is inside the panel (the grid), returning it
   * fires `focusin`, and `handleFocusIn` re-opens the panel that was just
   * closed. Pointer paths never showed it because the grid cells
   * `preventDefault` their mousedown, so focus never left the input and the
   * focus call was a no-op — it only ever bit KEYBOARD picks.
   */
  #closePanelReturningFocus(key: SideKey) {
    const input = this.#inputOf(key);
    // Only claim the suppression when a `focusin` is actually coming — an
    // unconsumed flag would swallow the NEXT session's panel.
    const movingFocus = input !== undefined && this.#document.activeElement !== input;

    this.#suppressPanelOnFocus = movingFocus;
    this.overlayOpen.set(false);
    if (movingFocus) this.#chrome.focusSide(key);
  }

  /**
   * Toggles the panel like the 📅 icon: opens the session when idle,
   * closes an open popup, reopens a closed one. PUBLIC — the
   * container-click affordance a hosting container (the mat-form-field
   * adapter) delegates to.
   */
  togglePanel() {
    if (this.effectiveDisabled() || this.effectiveReadonly()) return;

    if (this.overlayOpen()) {
      this.overlayOpen.set(false);
      return;
    }

    if (this.focusTarget() === null) this.#chrome.focusSide('start');
    this.overlayOpen.set(true);
  }

  /** The 📅 trigger. */
  protected toggleCalendar(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.togglePanel();
  }

  /** Clicking free space in the panel must not blur the inputs. */
  protected handlePanelMousedown(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('input, button') === null) event.preventDefault();
  }

  #inputOf(key: SideKey): HTMLInputElement | undefined {
    return (key === 'start' ? this.startInput() : this.endInput())?.nativeElement;
  }

  // -- Clear affordance (idle hover bubble; per-side for a range) ----------------

  #clearVisibility = makeClearBubbleVisibility({
    required: this.required,
    disabled: this.effectiveDisabled,
    readonly: this.effectiveReadonly,
    editing: this.editing,
    // The RAW range: an unresolved injected value still offers its clear.
    range: this.#rawRange,
  });

  protected clearCanShowSingle = this.#clearVisibility.single;
  protected clearCanShowStart = this.#clearVisibility.start;
  protected clearCanShowEnd = this.#clearVisibility.end;

  /**
   * Consumer clear affordance — REPLACES the stock button in EVERY bubble
   * this control stamps (both sides of a range, or the single field). See
   * {@link EditableClearTemplate}: the context's callback is what makes a
   * confirm-before-clear possible, since clearing IS the commit.
   */
  clearTemplate = input<TemplateRef<EditableClearContext> | undefined>(undefined);

  private contentClear = contentChild(EditableClearTemplate);

  protected clearTpl = computed(() => this.clearTemplate() ?? this.contentClear()?.templateRef);

  #clearContexts = makeClearContexts({
    clear: (key) => this.clearBubble(key),
    focus: (key) => this.#inputOf(key)?.focus(),
    label: (side) => this.intl.clearLabel(side, this.intl.dateLabel().toLowerCase()),
  });

  protected clearContextSingle = this.#clearContexts.single;
  protected clearContextStart = this.#clearContexts.start;
  protected clearContextEnd = this.#clearContexts.end;

  /**
   * Clears one side from the idle hover bubble — a commit AND an interaction
   * (mat-faithful): it writes `null` into that side (the OTHER side is never
   * nuked, shape-echoed), re-baselines both sides so a later focus can't
   * re-commit a stale draft, marks the field touched, and settles once. In the
   * single shape `key` is `'start'` and the whole value clears.
   */
  protected clearBubble(key: SideKey) {
    // Idle-only: the bubble is hidden while editing; guard anyway so a stray
    // clear can't strand a frozen draft mid-session.
    if (this.editing()) return;

    const before = this.value();
    this.#writeSideDay(key, null);

    for (const side of [this.#startSide, this.#endSide]) {
      side.baselineDay = side.committed();
      side.baselineRaw = this.#unresolvedRawOf(side.key);
      side.restore();
      side.dirty.set(false);
      side.saveAttempted.set(false);
    }

    this.#selfTouched.set(true);
    this.touch.emit();

    const value = this.value();
    const changed = !dateValuesEqual(value, before);
    if (changed) this.#emitSavedModel();
    this.saved.emit({ value, changed });
  }

  // -- Form Value Contract ------------------------------------------------------------

  focus(options?: FocusOptions) {
    this.#inputOf('start')?.focus(options);
  }

  /**
   * Presentation-only rollback (the MatInput precedent): an open draft is
   * discarded back to the baseline with no `touch`, no `saved`, no focus
   * stealing.
   */
  reset() {
    for (const key of ['start', 'end'] as const) {
      const side = this.#side(key);
      if (!side.open()) continue;

      if (side.baselineDay === null && side.baselineRaw !== null) {
        this.#writeSideRaw(key, side.baselineRaw);
      } else {
        this.#writeSideDay(key, side.baselineDay);
      }
      side.baselineDay = side.committed();
      side.baselineRaw = this.#unresolvedRawOf(key);
      side.restore();
      side.saveAttempted.set(false);
    }

    this.overlayOpen.set(false);
  }
}
