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
  EditablePrefix,
  EditableSuffix,
  BubbleMenu,
  EditableClearButton,
  type BubbleMenuSide,
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
  type IsoDate,
  type InlineDateValue,
  type DateValueShape,
  type InternalDateRange,
} from './date-codec';
import { INLINE_TEMPORAL_BUBBLE_SIDE, INLINE_TEMPORAL_LEAF_STATE } from '../leaf-state';
import { dayToDbEntry, dayEndToDbEntry, localDayOf } from '../datetime/db-entry';
import { INLINE_TEMPORAL_ZONE } from '../datetime/zone';
import {
  makeSideSessionChrome,
  makeClearBubbleVisibility,
  makeShapeMemory,
  makeSideCore,
  sideAriaLabel,
  sideSize,
  wireEditingBridge,
  type SideCore,
  type SideKey,
} from '../side-session';
import { Calendar } from './calendar/calendar';

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
 * - Escape = explicit revert to the session baseline.
 * - Tab / blur = navigation, never a validity checkpoint: a readable draft
 *   COMMITS and focus moves on; an unreadable draft SNAPS BACK to the
 *   baseline and focus moves anyway. Never trap, never persist a draft
 *   error — the idle solid underline is reserved for SCHEMA errors.
 *
 * The calendar opens on focus WITHOUT stealing it (the grid mirrors the
 * typed draft per keystroke); ArrowDown hands focus to the grid; a pick
 * COMMITS the focused side — and hands the session to the empty other side
 * when picking a range.
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
   * pattern (`'dd.mm.yyyy'` German, `'mm/dd/yyyy'` en-US) — fixed size per
   * locale, so the placeholder-floored width never shifts.
   */
  placeholder = input<string | undefined>(undefined);
  /**
   * End-field placeholder override. Unset, a FULLY EMPTY range shows the
   * locale pattern on both sides; once a start exists the end side switches
   * to the half-open display (`'Jul 21 – …'`).
   */
  endPlaceholder = input<string | undefined>(undefined);

  /** Public: the resolved placeholder verdict (adapters render from this, not the input). */
  readonly effectivePlaceholder = computed(
    () => this.placeholder() ?? localeDatePlaceholder(this.locale()),
  );
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

  /** Hard commit event: fires once per changed settlement, in the bound shape. */
  savedModelChange = output<InlineDateValue>();

  /** Emitted exactly once per settled session (commit, snap-back, Escape, clear). */
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
   */
  readonly internalRange = computed<InternalDateRange>(() => {
    const zone = this.effectiveZone();
    const { start, end } = toInternalRange(this.value());
    return {
      start: start === null ? null : localDayOf(start, zone),
      end: end === null ? null : localDayOf(end, zone),
    };
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

  // -- The two sides -----------------------------------------------------------

  readonly #startSide = this.#makeSide('start');
  readonly #endSide = this.#makeSide('end');

  #side(key: SideKey): DateSide {
    return key === 'start' ? this.#startSide : this.#endSide;
  }

  #makeSide(key: SideKey): DateSide {
    const committed = computed(() => this.internalRange()[key]);
    const display = computed(() => formatIsoDate(committed(), this.locale()));
    const core = makeSideCore(key, committed, display);

    return {
      ...core,
      baselineDay: null,
      parsed: computed(() =>
        parseDateInput(core.draft(), this.now()(), this.locale(), this.effectiveZone()),
      ),
    };
  }

  protected startDraft = computed(() => this.#startSide.draft());
  protected endDraft = computed(() => this.#endSide.draft());

  /** The shared session chrome: focus target, snap-back flash, focus timers. */
  #chrome = makeSideSessionChrome((key) => this.#inputOf(key));

  protected focusTarget = this.#chrome.focusTarget;

  protected overlayOpen = signal(false);

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

  /** Public: whether the field holds no value at all (both sides empty). */
  readonly isEmpty = computed(() => {
    const { start, end } = this.internalRange();
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
    return sideAriaLabel(this.ariaLabel() ?? 'Date', key, this.twoFields());
  }

  protected ariaInvalidOf(key: SideKey): boolean {
    const side = this.#side(key);
    return this.errorsVisible() || (side.open() && side.saveAttempted() && this.parseFailed());
  }

  // -- The live channel ---------------------------------------------------------

  /** Every keystroke: readable drafts flow into the model live, in the bound shape. */
  protected handleInput(key: SideKey, raw: string) {
    const side = this.#side(key);
    // A settled-but-still-focused field (Enter, outside click) restarts its
    // session on the next keystroke.
    if (!side.open()) {
      side.baselineDay = side.committed();
      side.open.set(true);
    }

    side.draft.set(raw);
    side.dirty = true;
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

    const echoed = this.#daysToDbShape(next, this.shape());
    if (!dateValuesEqual(echoed, this.value())) this.value.set(echoed);
  }

  // -- Focus flow ----------------------------------------------------------------

  protected handleFocusIn(key: SideKey) {
    const side = this.#side(key);
    if (!side.open()) {
      side.baselineDay = side.committed();
      side.dirty = false;
      side.saveAttempted.set(false);
      side.open.set(true);
    }

    this.focusTarget.set(key);
    if (!this.effectiveReadonly() && !this.effectiveDisabled()) this.overlayOpen.set(true);
    this.editing.set(true);
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
    const untouched = !options.revert && options.resolve === undefined && !side.dirty;

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

    if (!untouched) {
      this.#writeSideDay(key, day);

      // A typed commit sorts like a calendar pick (iusta-style): a date
      // pair never lands inverted — days carry no overnight reading (that
      // is the TIME control's roll), so end-before-start is only ever
      // backwards. Restorations (Escape, snap-back) stay literal.
      if (!options.revert && !snappedBack) {
        this.#sortIfInverted();
        day = side.committed();
      }
    }
    const changed = !untouched && day !== side.baselineDay;
    side.dirty = false;

    if (options.keepOpen) {
      // Enter / pick settle in place: the session continues on the new baseline.
      side.baselineDay = day;
      side.draft.set(formatIsoDate(day, this.locale()));
      side.saveAttempted.set(false);
    } else {
      side.open.set(false);
      side.saveAttempted.set(false);
    }

    if (snappedBack) this.#chrome.announceRevert(key, formatIsoDate(day, this.locale()));

    this.#selfTouched.set(true);
    this.touch.emit();

    const value = this.value();
    if (changed) this.savedModelChange.emit(value);
    this.saved.emit({ value, changed });
  }

  // -- Keyboard -------------------------------------------------------------------

  protected handleInputKeydown(key: SideKey, event: KeyboardEvent) {
    switch (event.key) {
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
      this.#chrome.focusSide(other);
    } else {
      this.overlayOpen.set(false);
      this.#chrome.focusSide(key);
    }
  }

  #sortIfInverted() {
    const { start, end } = this.internalRange();
    if (start !== null && end !== null && start > end) {
      // ISO days compare lexicographically.
      this.value.set(this.#daysToDbShape({ start: end, end: start }, this.shape()));
    }
  }

  /**
   * Commits BOTH sides in one settlement (drag, Ctrl+click): one value
   * write, both sides re-baselined, ONE `saved`.
   */
  #commitBothSides(startDay: IsoDate | null, endDay: IsoDate | null) {
    const before = this.value();
    const echoed = this.#daysToDbShape({ start: startDay, end: endDay }, this.shape());
    if (!dateValuesEqual(echoed, before)) this.value.set(echoed);

    for (const key of ['start', 'end'] as const) {
      const side = this.#side(key);
      side.baselineDay = side.committed();
      side.draft.set(side.display());
      side.dirty = false;
      side.saveAttempted.set(false);
    }

    const value = this.value();
    const changed = !dateValuesEqual(value, before);
    this.#selfTouched.set(true);
    this.touch.emit();
    if (changed) this.savedModelChange.emit(value);
    this.saved.emit({ value, changed });
  }

  /** A drag painted [start, end] — commit the pair whole and close. */
  protected commitDraggedRange(range: { start: IsoDate; end: IsoDate }) {
    this.#commitBothSides(range.start, range.end);
    this.overlayOpen.set(false);
    this.#chrome.focusSide(this.focusTarget() ?? 'start');
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

  /** Escape in the grid hands control back to the focused input (session continues). */
  protected escapeCalendar() {
    this.#chrome.focusSide(this.focusTarget() ?? 'start');
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

  /**
   * An outside click DISMISSES the panel — and only that. Settling belongs
   * to the focusout path: when the click also moves focus away, the blur
   * settle runs anyway; when it does NOT (a hosting container's prevented
   * chrome click), the session must survive the dismissal.
   */
  protected handleOutsideClick() {
    this.overlayOpen.set(false);
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
    range: this.internalRange,
  });

  protected clearCanShowSingle = this.#clearVisibility.single;
  protected clearCanShowStart = this.#clearVisibility.start;
  protected clearCanShowEnd = this.#clearVisibility.end;

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
      side.draft.set(side.display());
      side.dirty = false;
      side.saveAttempted.set(false);
    }

    this.#selfTouched.set(true);
    this.touch.emit();

    const value = this.value();
    const changed = !dateValuesEqual(value, before);
    if (changed) this.savedModelChange.emit(value);
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

      this.#writeSideDay(key, side.baselineDay);
      side.baselineDay = side.committed();
      side.draft.set(side.display());
      side.saveAttempted.set(false);
    }

    this.overlayOpen.set(false);
  }
}
