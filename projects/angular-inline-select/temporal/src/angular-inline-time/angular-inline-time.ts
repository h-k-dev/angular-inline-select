import {
  Component,
  ElementRef,
  computed,
  contentChild,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  viewChild,
  type Signal,
  type TemplateRef,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import { FormValueControl, type ValidationError } from '@angular/forms/signals';

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
  parseTime,
  parseTimeDraft,
  formatWallClock,
  inferTimeShape,
  toInternalTimeRange,
  echoTimeShape,
  timeValuesEqual,
  type InlineTimeValue,
  type TimeDraft,
  type TimeSavedDetails,
  type TimeValueShape,
  type InternalTimeRange,
} from './time-codec';
import { INLINE_TIME_DAY_OFFSET } from './day-offset';
import { INLINE_TEMPORAL_BUBBLE_SIDE, INLINE_TEMPORAL_LEAF_STATE } from '../leaf-state';
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
import {
  addLocalDays,
  composeDbEntry,
  diffDbEntrySeconds,
  localDayDiff,
  localDayOf,
  localTimeOf,
  parseDbEntryDraft,
  rollDbEntryForward,
  toDateTime,
  todayIn,
  type DbDateTime,
} from '../datetime/db-entry';
import { INLINE_TEMPORAL_ZONE } from '../datetime/zone';

/** Payload of the `saved` output: one emission per settled edit session. */
export interface InlineTimeSaved {
  /** The value the session settled on, in the consumer's bound shape. */
  value: InlineTimeValue;
  /** Whether the settled value differs from the session baseline. */
  changed: boolean;
  /**
   * The day over-count the user TYPED via overflow hours (`'24:30'` → 1,
   * `'240:30'` → 10) — already applied to `value`, surfaced so a range
   * group can anchor it on the start's day instead of this field's own.
   */
  dayOverflow: number;
  /**
   * The commit CARRIED ITS OWN DAY (a pasted full ISO datetime — the
   * decomposition gesture): a range group must take the instant as-is and
   * never re-anchor it onto the start's day.
   */
  explicitDay: boolean;
  /**
   * WHICH side's session settled — always `'start'` in single mode. A
   * range group's `rangeTimes` role dispatches on it (the pair replaces
   * two single leaves, but propagation stays per-endpoint).
   */
  side: SideKey;
}

export type { SideKey };

/**
 * The time side: the shared session core (see `SideCore`) plus what a TIME
 * session must snapshot. A session opens on focusin — capturing the
 * baseline and FREEZING the anchor day — and settles on Enter, Escape, or
 * focus leaving.
 */
interface TimeSide extends SideCore<DbDateTime> {
  /**
   * The WHOLE value at session start — Escape and snap-back restore it.
   * Whole on purpose: a side's settlement can move the PARTNER too (the
   * overnight roll), so a per-side baseline could not undo a session.
   */
  baselineValue: InlineTimeValue;
  /**
   * The day a typed wall-clock composes onto, FROZEN at session start —
   * live writes move the instant's own day (overflow hours), and a
   * drifting anchor would double-apply them.
   */
  anchorDay: string;
  /**
   * The draft's codec reading, CACHED per side (`null` empty, `undefined`
   * unreadable) — the one parse per keystroke every consumer (live channel,
   * parse gate, settlement) reads.
   */
  readonly parsed: Signal<TimeDraft | null | undefined>;
  /** A pasted FULL ISO datetime (the decomposition gesture), cached per side. */
  readonly explicit: Signal<DbDateTime | undefined>;
}

/**
 * Inline time on NATIVE INPUTS — the input rehost (see ROADMAP-DATETIME).
 * A `FormValueControl` for times and time RANGES. Canonical value: **UTC
 * ISO DB entries** (`'2026-07-21T19:00:00.000Z'` — iusta's `toDBEntry`),
 * SHAPE-ECHOED like the date control — a string binds ONE field, an object
 * binds the start–end pair (`{ start }` is a HALF-OPEN range). The DISPLAY
 * is the local wall-clock reading, localized via `Intl`. Each value carries
 * its own date: typed `'HH:mm'` drafts set the local time-of-day on a
 * frozen ANCHOR day (the value's existing day, or `now`'s when empty).
 *
 * Ranged, the pair keeps the range-group's house rules INSIDE the control:
 * a typed END is wall-clock intent — it anchors on the START's day and an
 * end at-or-before the start rolls forward by whole days on settlement
 * (overnight lands as `+1`, worn by the badge on the end field). A pasted
 * FULL ISO datetime is explicit and never re-anchored or rolled.
 *
 * Session semantics are GESTURE-TIERED (the family rule): Enter commits
 * (an unreadable draft BLOCKS with the error), Escape reverts to the
 * baseline, Tab/blur commits a readable draft and SNAPS an unreadable one
 * back — never traps, never persists a draft error.
 *
 * - Drafts are TYPED (`'9'` → 09:00, `'930'`, `'21:05'`); overflow hours
 *   declare the day over-count by hand (`'24:30'` → next day 00:30).
 * - **The picker is the OS's own, opt-in via `native`**: a side's own
 *   click drives a visually-hidden `<input type="time">` — `showPicker()`
 *   where the platform supports it, falling back to focusing the input
 *   (mobile opens its wheels on focus). There is NO trigger button; typing
 *   is the primary road everywhere. While a session is open, a pick
 *   replaces the draft; idle, it commits immediately.
 */
@Component({
  selector: 'angular-inline-time',
  imports: [
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    NgTemplateOutlet,
    BubbleMenu,
    EditableClearButton,
  ],
  templateUrl: './angular-inline-time.html',
  styleUrl: './angular-inline-time.scss',
  host: {
    '[style.display]': 'hidden() ? "none" : null',
  },
})
export class AngularInlineTime implements FormValueControl<InlineTimeValue> {
  #document = inject(DOCUMENT);

  /**
   * The committed value channel — polymorphic UTC ISO DB entries: a single
   * string binds a single time, `{ start, end? }` binds a range, and the
   * control ECHOES whichever shape it received.
   */
  value = model<InlineTimeValue>(null);

  /**
   * Cold-start shape default: which shape a `null`-bound field emits before
   * any non-null value has declared one. Ignored once a shape has been seen.
   */
  ranged = input(false);

  /** Reference clock — anchors the day of a time typed into an EMPTY field. */
  now = input<() => Date>(() => new Date());

  /**
   * Wall-clock format: `'HH:mm:ss'` displays, parses and composes SECONDS —
   * rendered as the RAW format string (24 h, meridiem-free), because the
   * format's own display must parse back and the codec keeps seconds and
   * day-periods apart. The default `'HH:mm'` keeps the Intl-localized
   * display.
   */
  format = input<'HH:mm' | 'HH:mm:ss'>('HH:mm');

  /** Form Value Contract. */
  errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  disabled = input(false);
  readonly = input(false);
  required = input(false);
  touched = input(false);
  invalid = input(false);
  hidden = input(false);

  placeholder = input<string>('time');
  /**
   * End-field placeholder override. Unset, a FULLY EMPTY range shows the
   * placeholder on both sides; once a start exists the end side switches
   * to the half-open display (`'21:00 – …'`).
   */
  endPlaceholder = input<string | undefined>(undefined);

  protected effectiveEndPlaceholder = computed(() => {
    const explicit = this.endPlaceholder();
    if (explicit !== undefined) return explicit;
    return this.internalRange().start === null ? this.placeholder() : '…';
  });

  /**
   * The UNIFORM adapter surface (every temporal control exposes it): the
   * resolved placeholder text, so hosting containers never branch on the
   * concrete control.
   */
  readonly placeholderText = computed(() => this.placeholder());

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

  /** Locale for the idle display (`Intl`); browser default when omitted. */
  locale = input<string | string[] | undefined>(undefined);

  /**
   * T6 — the DISPLAY ZONE (IANA id): which zone's wall clock the field
   * speaks. Falls back to the app-wide `INLINE_TEMPORAL_ZONE` provider,
   * then the machine zone. Values stay UTC DB entries.
   */
  zone = input<string | undefined>(undefined);

  #zoneDefault = inject(INLINE_TEMPORAL_ZONE, { optional: true });

  readonly effectiveZone = computed(() => this.zone() ?? this.#zoneDefault?.());

  /** Granularity of the native picker, in seconds (forwarded to its `step`). */
  step = input<number>(60);

  /**
   * T3 — native picker bounds, forwarded to the OS input's `min`/`max`
   * (`'HH:mm'`). Named picker* because signal forms reserves `min`/`max`
   * beside `[formField]` — and they bound the PICKER, not the codec.
   */
  pickerMin = input<string | undefined>(undefined);
  pickerMax = input<string | undefined>(undefined);

  /**
   * NATIVE mode — the one picker affordance: a click on a side's input
   * opens the OS time picker for THAT side (the date control's
   * calendar-on-edit convention). Typing stays fully available; the picker
   * is an assist, never the only road. T3's support matrix: `showPicker()`
   * feature-detected, focus fallback (mobile opens its wheels on focus).
   */
  native = input(false);

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
   * Day-overflow badge feed — provided on this element by the range
   * group's `rangeEnd` role directive; absent (0) everywhere else.
   */
  #groupDayOffset = inject(INLINE_TIME_DAY_OFFSET, { optional: true, self: true });

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

  /**
   * Days the end overflows past the start's calendar day (the `+n` badge).
   * Ranged, it is INTRINSIC — the local day difference of the pair's own
   * instants; single, it is the group-fed offset (the leaf role's token).
   */
  readonly dayOffset = computed(() => {
    if (this.twoFields()) {
      const { start, end } = this.internalRange();
      if (start === null || end === null) return 0;

      return Math.max(0, localDayDiff(start, end, this.effectiveZone()) ?? 0);
    }

    return this.#groupDayOffset?.() ?? 0;
  });

  protected dayBadgeAria = computed(() =>
    this.dayOffset() === 1 ? 'plus one day' : `plus ${this.dayOffset()} days`,
  );

  /** Form Value Contract: touch — emitted whenever a session settles. */
  touch = output<void>();

  /**
   * THE consumer commit event — the family DNA: fires once per changed
   * settlement (accept-timed, change-gated) with the time MODEL as Luxon
   * details (`TimeSavedDetails`). App code binds this; the raw bound value
   * still flows through `value`.
   */
  savedModelChange = output<TimeSavedDetails>();

  /**
   * The MACHINERY channel: exactly one emission per settled session (commit,
   * snap-back, Escape, clear — changed or not), carrying the session's
   * commit intent (`side`, `dayOverflow`, `explicitDay`). Range groups and
   * hosting adapters bind this; app consumers should bind
   * `savedModelChange`.
   */
  saved = output<InlineTimeSaved>();

  /** Whether an edit session is open (= focus is within). Two-way bindable. */
  editing = model(false);

  #shapeMemory = makeShapeMemory<InlineTimeValue, TimeValueShape>({
    value: this.value,
    infer: inferTimeShape,
    ranged: this.ranged,
    singleShape: 'single',
    rangeShape: 'range',
  });

  /** The effective shape: last seen, or the `ranged` cold-start default. */
  readonly shape = this.#shapeMemory.shape;

  /** Object shapes render the start–end input pair; a string renders one field. */
  protected twoFields = this.#shapeMemory.twoFields;

  /**
   * One canonical internal model, always: per-side DB-entry instants.
   *
   * A WRITABLE view (22.1 `linkedSignal`, custom `set`) — the date control's
   * pattern: reads derive from `value`, and writing a side routes
   * SYNCHRONOUSLY back through the shape echo into `value`. Every commit
   * path updates the side it owns and the echo + dedupe live in exactly one
   * place — no positional (start, end) pairs threaded through call sites.
   */
  readonly internalRange = linkedSignal<InlineTimeValue, InternalTimeRange>({
    source: this.value,
    computation: (value) => toInternalTimeRange(value),
    set: (range) => {
      const echoed = echoTimeShape(range, this.shape());
      if (!timeValuesEqual(echoed, this.value())) this.value.set(echoed);
    },
  });

  /**
   * A side's wall-clock display. The default format is Intl-localized;
   * `'HH:mm:ss'` renders the RAW format string (meridiem-free — the
   * format's own display must parse back).
   */
  #wallClockOf(instant: DbDateTime | null): string {
    if (this.format() === 'HH:mm:ss') {
      const dateTime = toDateTime(instant, this.effectiveZone());
      return dateTime === null ? '' : dateTime.toFormat(this.format());
    }

    return formatWallClock(localTimeOf(instant, this.effectiveZone()), this.locale());
  }

  // -- The two sides -----------------------------------------------------------

  readonly #startSide = this.#makeSide('start');
  readonly #endSide = this.#makeSide('end');

  #side(key: SideKey): TimeSide {
    return key === 'start' ? this.#startSide : this.#endSide;
  }

  #makeSide(key: SideKey): TimeSide {
    const committed = computed(() => this.internalRange()[key]);
    const display = computed(() => this.#wallClockOf(committed()));
    // The live channel rides the draft setter: every USER write resolves and
    // flows a readable instant into the value — typed input and the OS
    // picker share it, no write site can forget the resolve half.
    const core = makeSideCore(key, committed, display, () => {
      const resolved = this.#resolveDraft(key);
      if (resolved === undefined) return;

      this.internalRange.update((range) => ({ ...range, [key]: resolved.instant }));
    });

    return {
      ...core,
      baselineValue: null,
      anchorDay: '',
      parsed: computed(() => parseTimeDraft(core.draft(), this.locale())),
      explicit: computed(() => parseDbEntryDraft(core.draft(), this.effectiveZone())),
    };
  }

  protected startDraft = computed(() => this.#startSide.draft());
  protected endDraft = computed(() => this.#endSide.draft());

  /** Localizable chrome strings — here, the side words on a ranged label. */
  #intl = inject(TemporalIntl);

  /** The shared session chrome: focus target, snap-back flash, focus timers. */
  #chrome = makeSideSessionChrome((key) => this.#inputOf(key));

  protected focusTarget = this.#chrome.focusTarget;

  /**
   * The day anchoring a side's typed wall clock: the START's day (a typed
   * END is intent relative to it; the start side is its own), then the
   * partner's, then `now`'s — the same chain for both sides. Falls THROUGH
   * `localDayOf`, so an unreadable bound value (an empty-string DB default)
   * drops to the next anchor instead of poisoning the compose with `null`.
   */
  #anchorDay(): string {
    const zone = this.effectiveZone();
    const { start, end } = this.internalRange();
    return localDayOf(start, zone) ?? localDayOf(end, zone) ?? todayIn(this.now()(), zone);
  }

  /**
   * The current draft's canonical reading (`null` empty, `undefined`
   * unreadable) — a SELECTION over the sides' cached parses, so a focus
   * flip never re-parses an unchanged draft.
   */
  readonly parsedDraft = computed(() => this.#side(this.focusTarget() ?? 'start').parsed());

  /** A pasted FULL ISO datetime — the decomposition gesture carries its own day. */
  readonly explicitDraft = computed(() => this.#side(this.focusTarget() ?? 'start').explicit());

  /** The parse gate: whether the focused draft fails the codec. Public for consumers. */
  readonly parseFailed = computed(
    () => this.parsedDraft() === undefined && this.explicitDraft() === undefined,
  );

  #selfTouched = signal(false);

  protected isInvalid = computed(
    () =>
      this.effectiveInvalid() ||
      this.errors().length > 0 ||
      (this.#leafState?.errors().length ?? 0) > 0,
  );

  /**
   * The mat split: the consumer decides what errors say, the field when they
   * show. Public — the field's presentational verdict, the thing a hosting
   * container (a mat-form-field adapter) needs to mirror.
   */
  readonly errorsVisible = computed(
    () => this.isInvalid() && (this.effectiveTouched() || this.#selfTouched()),
  );

  /** Public: whether the field holds no value at all (both sides empty). */
  readonly isEmpty = computed(() => {
    const { start, end } = this.internalRange();
    return start === null && end === null;
  });

  /** Enter/Escape hide the panel until the next keystroke or session. */
  #panelDismissed = signal(false);

  /** The parse-gate reveal: Enter was attempted on an unreadable draft. */
  protected parseGateVisible = computed(() => {
    const key = this.focusTarget();
    return key !== null && this.#side(key).saveAttempted() && this.parseFailed();
  });

  protected errorSlotVisible = computed(() => this.errorsVisible() || this.parseGateVisible());

  /** The panel appears only to carry an error — there is no live preview. */
  protected panelOpen = computed(
    () => this.editing() && !this.#panelDismissed() && this.errorSlotVisible(),
  );

  /** Public: whether the panel is showing (hosting containers coordinate on it). */
  readonly panelVisible = computed(() => this.panelOpen());

  /** An outside click dismisses the panel — the session survives (focusout settles). */
  protected dismissPanel() {
    this.#panelDismissed.set(true);
  }

  protected overlayPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];

  protected revertFlash = this.#chrome.revertFlash;
  protected revertNotice = this.#chrome.revertNotice;

  protected startInput = viewChild<ElementRef<HTMLInputElement>>('startInput');
  protected endInput = viewChild<ElementRef<HTMLInputElement>>('endInput');
  protected nativeInput = viewChild.required<ElementRef<HTMLInputElement>>('nativeInput');
  protected panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    wireEditingBridge({
      editing: this.editing,
      focusTarget: this.focusTarget,
      focusSide: (key) => this.#chrome.focusSide(key),
      deactivate: (focused) => {
        this.#settle(focused);
        this.focusTarget.set(null);
        this.#inputOf(focused)?.blur();
      },
    });
  }

  // -- Sizing (no layout shift: content-sized, placeholder-floored) -------------

  protected sizeOf(key: SideKey): number {
    const placeholder = key === 'end' ? this.effectiveEndPlaceholder() : this.placeholder();
    return sideSize(this.#side(key).draft(), placeholder);
  }

  protected ariaLabelOf(key: SideKey): string {
    return this.#intl.fieldLabel(this.ariaLabel() ?? this.#intl.timeLabel(), key, this.twoFields());
  }

  protected ariaInvalidOf(key: SideKey): boolean {
    const side = this.#side(key);
    return this.errorsVisible() || (side.open() && side.saveAttempted() && this.parseFailed());
  }

  // -- The live channel -----------------------------------------------------------

  #openSession(key: SideKey) {
    const side = this.#side(key);
    if (side.open()) return;

    side.baselineValue = this.value();
    side.anchorDay = this.#anchorDay();
    side.dirty.set(false);
    side.saveAttempted.set(false);
    this.#panelDismissed.set(false);
    side.open.set(true);
  }

  /**
   * A side's CURRENT draft as an instant: explicit ISO paste, else
   * wall-clock on the frozen anchor. Reads the side's cached parses — call
   * after `draft.set(...)`, never with a raw string of its own.
   */
  #resolveDraft(
    key: SideKey,
  ): { instant: DbDateTime | null; days: number; explicit: boolean } | undefined {
    const side = this.#side(key);

    const explicit = side.explicit();
    if (explicit !== undefined) return { instant: explicit, days: 0, explicit: true };

    const draft = side.parsed();
    if (draft === undefined) return undefined;
    if (draft === null) return { instant: null, days: 0, explicit: false };

    const day = draft.days === 0 ? side.anchorDay : addLocalDays(side.anchorDay, draft.days);
    return {
      instant: composeDbEntry(day, draft.time, this.effectiveZone()),
      days: draft.days,
      explicit: false,
    };
  }

  /** Every keystroke: readable drafts flow into the model live (no roll — that is settlement's). */
  protected handleInput(key: SideKey, raw: string) {
    this.#openSession(key);
    const side = this.#side(key);
    side.draft.set(raw); // the setter marks dirty AND runs the live resolve
    side.saveAttempted.set(false);
    this.#panelDismissed.set(false);
  }

  // -- Focus flow -------------------------------------------------------------------

  protected handleFocusIn(key: SideKey) {
    // Tab-advance: focus landing HERE ends the partner's session. It settles
    // NOW — before this session snapshots its baseline/anchor — so Escape and
    // snap-back restore the reconciled (rolled) pair, never the un-rolled
    // mid-session state the deferred focusout timer would still be holding.
    const partner = this.#side(key === 'start' ? 'end' : 'start');
    if (partner.open()) this.#settle(partner.key);

    this.#openSession(key);
    this.focusTarget.set(key);
    this.editing.set(true);
  }

  /**
   * Focusout settles ASYNCHRONOUSLY: where focus LANDS decides what happens
   * (the other input = Tab-advance, the native picker or panel = same
   * session, outside = settle), and that is only knowable a tick later.
   */
  protected handleFocusOut() {
    this.#chrome.scheduleFocusSettle(() => this.#onFocusSettled());
  }

  #onFocusSettled() {
    const active = this.#document.activeElement;
    const inStart = active !== null && active === this.startInput()?.nativeElement;
    const inEnd = active !== null && active === this.endInput()?.nativeElement;
    const inNative = active !== null && active === this.nativeInput().nativeElement;
    const inPanel = (active !== null && this.panelRef()?.nativeElement.contains(active)) ?? false;

    // A side that lost focus to anywhere outside the session settles NOW:
    // commit-if-readable, snap-back if not. Never trap, never block.
    if (!inNative && !inPanel) {
      if (this.#startSide.open() && !inStart) this.#settle('start');
      if (this.#endSide.open() && !inEnd) this.#settle('end');
    }

    if (!inStart && !inEnd && !inNative && !inPanel) {
      this.focusTarget.set(null);
      this.editing.set(false);
    } else if (inStart) {
      this.focusTarget.set('start');
    } else if (inEnd) {
      this.focusTarget.set('end');
    }
  }

  // -- Settlement (ONE per session — commit, snap-back, Escape, clear) --------------

  /**
   * The settled side lands and the pair reconciles — the range house rule
   * (`rollDbEntryForward`, shared with the range group): an end at-or-before
   * the start rolls forward by whole LOCAL days (a typed end is wall-clock
   * intent; overnight lands as +1, DST never drifts the reading). An
   * EXPLICIT end (a pasted full instant) is taken as-is — the decomposition
   * law: never re-anchor, never roll.
   */
  #reconcile(key: SideKey, instant: DbDateTime | null, explicit: boolean) {
    const current = this.internalRange();
    const start = key === 'start' ? instant : current.start;
    let end = key === 'end' ? instant : current.end;

    const skipRoll = explicit && key === 'end';
    if (this.twoFields() && !skipRoll && start !== null && end !== null) {
      end = rollDbEntryForward(start, end, this.effectiveZone());
    }

    this.internalRange.set({ start, end });
  }

  #settle(key: SideKey, options: { revert?: boolean; keepOpen?: boolean } = {}) {
    const side = this.#side(key);
    if (!side.open()) return;

    // An untouched session settles where the value stands (see TimeSide.dirty).
    const untouched = !options.revert && !side.dirty();

    let dayOverflow = 0;
    let explicitDay = false;
    let snappedBack = false;

    if (untouched) {
      // Nothing to derive — the value stands.
    } else if (options.revert) {
      if (!timeValuesEqual(side.baselineValue, this.value())) this.value.set(side.baselineValue);
    } else {
      const resolved = this.#resolveDraft(key);
      if (resolved === undefined) {
        // Snap-back: an unreadable draft reverts to the session baseline.
        snappedBack = true;
        if (!timeValuesEqual(side.baselineValue, this.value())) this.value.set(side.baselineValue);
      } else {
        dayOverflow = resolved.days;
        explicitDay = resolved.explicit;
        this.#reconcile(key, resolved.instant, resolved.explicit);
      }
    }

    const changed = !untouched && !timeValuesEqual(this.value(), side.baselineValue);
    side.dirty.set(false);

    if (options.keepOpen) {
      side.baselineValue = this.value();
      side.anchorDay = this.#anchorDay();
      side.restore();
      side.saveAttempted.set(false);
    } else {
      side.open.set(false);
      side.saveAttempted.set(false);
    }

    if (snappedBack) this.#chrome.announceRevert(key, this.#side(key).display());

    this.#selfTouched.set(true);
    this.touch.emit();

    const value = this.value();
    if (changed) this.#emitSavedModel();
    this.saved.emit({ value, changed, dayOverflow, explicitDay, side: key });
  }

  /** The commit payload — Luxon instants + the settled duration (iusta's house derivation). */
  #emitSavedModel() {
    const { start, end } = this.internalRange();
    const diff = start !== null && end !== null ? (diffDbEntrySeconds(start, end) ?? 0) : 0;
    this.savedModelChange.emit({
      start: toDateTime(start),
      end: toDateTime(end),
      duration: Math.max(0, diff),
    });
  }

  // -- Keyboard -----------------------------------------------------------------------

  /**
   * The ancestor Tab-to-accept scope, or `null` — see the date control: the
   * commit already rides the native focusout; only the EDGE Tab's landing
   * spot is the scope's business.
   */
  #scope = inject(EDITABLE_SCOPE, { optional: true });

  protected handleKeydown(key: SideKey, event: KeyboardEvent) {
    switch (event.key) {
      case 'Tab': {
        const scope = this.#scope;
        if (!scope?.tabCommits()) return;

        const direction = event.shiftKey ? -1 : 1;
        const internalMove =
          this.twoFields() &&
          ((key === 'start' && direction === 1) || (key === 'end' && direction === -1));
        if (internalMove) return; // the native side-to-side Tab stays

        // `'stay'` refuses the Tab like Enter's parse gate (Tab gesture
        // only — blur keeps the native snap-back regardless of policy).
        if (scope.onBlocked() === 'stay' && this.parseFailed()) {
          event.preventDefault();
          this.#side(key).saveAttempted.set(true);
          scope.announce('blocked');
          return;
        }

        // Own the Tab only when the walk can place it — at the scope's edge
        // the native Tab proceeds (blur settles, focus leaves the region).
        if (scope.advanceFrom(event.target as HTMLElement, direction)) event.preventDefault();
        return;
      }
      case 'Enter': {
        event.preventDefault();
        if (this.parseFailed()) {
          // The parse gate: the user ASKED for a commit — block and say why.
          this.#side(key).saveAttempted.set(true);
          return;
        }

        this.#settle(key, { keepOpen: true });
        this.#panelDismissed.set(true);
        return;
      }
      case 'Escape': {
        event.preventDefault();
        event.stopPropagation();
        this.#settle(key, { revert: true, keepOpen: true });
        this.#panelDismissed.set(true);
        return;
      }
    }
  }

  /**
   * Toggles the error panel. PUBLIC — the container-click affordance a
   * hosting container (the mat-form-field adapter) delegates to. (With no
   * error to show the panel stays empty-quiet — there is no live preview.)
   */
  togglePanel() {
    if (this.effectiveDisabled() || this.effectiveReadonly()) return;
    this.#panelDismissed.update((dismissed) => !dismissed);
  }

  // -- The OS picker ---------------------------------------------------------------------

  /**
   * Native mode: a side's own click is the picker affordance. The click has
   * already focused that side (its session is open), so a pick lands as a
   * draft replacement — the calendar-on-edit convention.
   */
  protected handleFieldClick(key: SideKey) {
    if (!this.native() || this.effectiveDisabled() || this.effectiveReadonly()) return;
    this.#showOsPicker(key);
  }

  /**
   * The side the shared native input is currently serving — recorded at
   * open time, because the pick's `change` event may fire AFTER focus has
   * already strayed to the other side (`focusTarget` is live, the picker
   * is not).
   */
  #pickerSide: SideKey | null = null;

  /**
   * Opens the OS time picker seeded with a side's committed wall clock.
   * T3's support matrix: `showPicker()` where the platform ships it
   * (feature-DETECTED — Safari desktop lacks the method entirely) and may
   * still throw without a user gesture — both roads fall back to focusing
   * the input (iOS opens its wheels on focus).
   */
  #showOsPicker(key: SideKey) {
    this.#pickerSide = key;
    const native = this.nativeInput().nativeElement;
    native.value = localTimeOf(this.#side(key).committed(), this.effectiveZone()) ?? '';

    if (typeof native.showPicker !== 'function') {
      native.focus();
      return;
    }

    try {
      native.showPicker();
    } catch {
      native.focus();
    }
  }

  /**
   * A pick from the OS picker: replaces the focused side's draft while a
   * session is open, commits immediately while idle (the flag-picker
   * convention).
   */
  protected handleNativePick(raw: string) {
    const time = parseTime(raw);
    if (time === undefined) return;

    // The pick belongs to the side the picker was OPENED for — focus may
    // have strayed since (the change fires on close/scrub, not on gesture).
    const key = this.#pickerSide ?? this.focusTarget() ?? 'start';
    const side = this.#side(key);

    if (side.open()) {
      side.draft.set(raw); // the setter marks dirty AND runs the live resolve
      this.#panelDismissed.set(false);
      return;
    }

    // Idle: one whole commit — anchor like an idle session would.
    const instant =
      time === null ? null : composeDbEntry(this.#anchorDay(), time, this.effectiveZone());
    const before = this.value();
    this.#reconcile(key, instant, false);
    if (!timeValuesEqual(this.value(), before)) {
      this.#emitSavedModel();
      this.saved.emit({
        value: this.value(),
        changed: true,
        dayOverflow: 0,
        explicitDay: false,
        side: key,
      });
    }
  }

  // -- Clear affordance (idle hover bubble; per-side for a range) --------------

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
    label: (side) => this.#intl.clearLabel(side, this.#intl.timeLabel().toLowerCase()),
  });

  protected clearContextSingle = this.#clearContexts.single;
  protected clearContextStart = this.#clearContexts.start;
  protected clearContextEnd = this.#clearContexts.end;

  /**
   * Clears one side from the idle hover bubble — a commit AND an interaction
   * (mat-faithful): writes `null` into that side (the OTHER side is never
   * nuked, shape-echoed — half-open ranges are real states), re-baselines
   * both sides so a later focus can't re-commit a stale draft, marks the
   * field touched, and settles once. In the single shape `key` is `'start'`
   * and the whole value clears.
   */
  protected clearBubble(key: SideKey) {
    // Idle-only: the bubble is hidden while editing; guard anyway so a stray
    // clear can't strand a frozen draft mid-session.
    if (this.editing()) return;

    const before = this.value();
    this.internalRange.update((range) => ({ ...range, [key]: null }));

    for (const side of [this.#startSide, this.#endSide]) {
      side.baselineValue = this.value();
      side.restore();
      side.dirty.set(false);
      side.saveAttempted.set(false);
    }

    this.#selfTouched.set(true);
    this.touch.emit();

    const value = this.value();
    const changed = !timeValuesEqual(value, before);
    if (changed) this.#emitSavedModel();
    this.saved.emit({ value, changed, dayOverflow: 0, explicitDay: false, side: key });
  }

  #inputOf(key: SideKey): HTMLInputElement | undefined {
    return (key === 'start' ? this.startInput() : this.endInput())?.nativeElement;
  }

  // -- Form Value Contract ------------------------------------------------------------------

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

      if (!timeValuesEqual(side.baselineValue, this.value())) this.value.set(side.baselineValue);
      side.baselineValue = this.value();
      side.restore();
      side.dirty.set(false);
      side.saveAttempted.set(false);
    }

    this.#panelDismissed.set(true);
  }
}
