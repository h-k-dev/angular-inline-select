# ROADMAP — the Temporal family (date · time · duration · datetime-range)

The program for `angular-inline-date`, `angular-inline-time`,
`angular-inline-duration` and the coordinated range group — sandboxed here,
migrating to iusta's `m-editable-date-v2` / `m-editable-time` /
`m-editable-time-duration` / `m-editable-date-time` afterwards. Extends the
main [ROADMAP.md](ROADMAP.md); all its guardrails apply (codec composition
over the text core, no draft reformatting, adornments outside the editable,
the ProseMirror line).

## DECIDED (fast-track)

1. **Signal-forms first.** These controls are `FormValueControl`s exactly
   like text/number/phone; mat-form-field hosting is an ADAPTATION applied
   afterwards (T4), and ONLY the three temporal controls get it — the
   existing editables never need the adapter.
2. **Own tree-shakable home.** Date, time and duration (and the future
   range group) move to a secondary entry point —
   `angular-inline-select/temporal` — the same mechanism as `/phone`
   (own `ng-package.json`, never exported from the core barrel). New T0.
3. **`value` only — `start`/`end` inputs are dead.** No separate range
   inputs (iusta date-v2's `start`/`end` do not migrate). Range-ness lives
   in the VALUE SHAPE.

## The polymorphic date value (the "hard" one, solved by shape-echo)

```ts
type InlineDateValue =
  | string                                  // 'yyyy-MM-dd' → SINGLE date field
  | { start: string | null; end?: string | null }  // → RANGED (two fields)
  | null;
```

**One canonical internal model, always:** `{ start, end }`. The external
shape is inferred on the way in and ECHOED on the way out — a codec, like
everything else here:

| bound value | internal | UI mode | emits |
| --- | --- | --- | --- |
| `'2026-05-12'` | `{start: s, end: s}` | single field | `string` |
| `{ start }` | `{start, end: start}` | ranged | `{ start }` |
| `{ start, end }` | as-is | ranged | `{ start, end }` |
| `null` | `{null, null}` | **last seen shape** | last seen shape |

Rules that make it deterministic:
- The consumer's binding shape IS the mode declaration. The control echoes
  the shape it received and NEVER invents another one (a string-bound field
  stays a single date picker; drag/Ctrl+click range gestures exist only in
  object shapes).
- `{ start }` means the single-day range `[start, start]` ("end is also
  start"). Emitting preserves the one-key shape until the consumer's data
  actually has a distinct end.
- `null` is the only shape-ambiguous case: a `#lastShape` signal remembers
  the previous non-null shape; a `ranged = input(false)` provides the
  cold-start default before any value has been seen.
- Same principle later for datetime/time ranges (T5/T6).

## Canonical primitives

| Control | Value | Notes |
| --- | --- | --- |
| date | `InlineDateValue` (above) | days are `'yyyy-MM-dd'` |
| time | `'HH:mm'` (`':ss'` opt) `\| null` | 24 h wall-clock string |
| duration | seconds `number \| null` | matches iusta time-duration |
| datetime | ISO 8601 `\| null` | T6 — timezone story TBD |

Luxon `DateTime` (what iusta's date-v2 emits today) and `Date` objects live
at consumer boundaries — the iusta wrappers convert, the controls never do.

## T0 — `angular-inline-select/temporal` entry point — SHIPPED

Moved `angular-inline-date`/`-time`/`-duration` out of the core `src/lib`
into the `temporal/` secondary entry point (the `/phone` recipe: own
`ng-package.json`, tsconfig path, spec include globs in `angular.json` +
`tsconfig.spec/lib.json`, core barrel temporal-free; controls import the
text core via the package name). Prod-build verified: all temporal markers
live exclusively in the lazy temporal-playground chunk.

**Shape-echo shipped, value codec only.** `InlineDateValue` +
`inferDateShape`/`toInternalRange`/`echoDateShape` in the date codec;
the control carries `#lastShape` (a `linkedSignal` over `value`), the
`ranged` cold-start input, and echoes every commit in the bound shape.
The UI stays a SINGLE field until T5: a distinct-end range displays via
`Intl.DateTimeFormat.formatRange`, and the interim edit rule is —
single-day ranges move whole with the typed day, a distinct `end`
survives a start edit, clearing empties both sides. No validity munging
(`start <= end` stays T5's job). The two-field ranged UI + calendar
gestures remain in T5.

---

## T1 — `angular-inline-time` — SHIPPED (MVP)

The third codec sibling. Typed drafts (`'9'` → 09:00, `'930'`, `'9:30'`,
`'21:05'`), sexagesimal gate, live preview via `Intl` (`✓ 9:30 AM` under
`en`, `✓ 09:30` under `de`). **Native OS picker as the affordance**: a 🕐
suffix affix drives a visually-hidden `<input type="time">` — `showPicker()`
where supported (Chrome/Edge/Android), falling back to focusing the input
(iOS opens its wheels on focus). While editing, a pick replaces the draft;
idle, it commits immediately (the flag-picker decision). `step` forwards to
the native input's granularity.

## T2 — Calendar overlay picker (required, not optional)

The typed draft stays primary; the calendar is the pointer affordance —
trigger = 📅 suffix affix opening a CDK overlay (the phone flag-picker
pattern; `pickDate(iso)` = the `pickCountry` analogue).

**Open-on-edit + typed-draft sync (decided).** The calendar opens when the
editing session starts (elevation/focus), not only via the affix click —
but it must NOT steal focus: the caret stays in the field and the user just
keeps typing (this is precisely the combobox-datepicker shape of Google's
reference example — popup open, focus in the input, ArrowDown enters the
grid). While the popup is open, the grid is a live *mirror of the draft*:
a parseable draft moves the displayed month and marks that day as the
pending selection per keystroke (the calendar analogue of phone's live
interpretation preview); an unparseable draft leaves the last valid
selection standing. The draft is never rewritten by the sync — data flows
draft → grid only, until an actual pick flows back.

**Build the grid on `@angular/aria` Grid + Material's `DateAdapter`.**
Unlike the slash menu (where aria didn't fit because focus stays in the
editor), the calendar popup legitimately TAKES focus — ArrowDown moves from
the field into the grid — so `Grid`/`GridRow`/`GridCell`/`GridCellWidget`
(+ `Combobox` where it helps) are the right primitives, per Google's own
combobox-datepicker example. `DateAdapter` + `MAT_DATE_FORMATS` give
first-day-of-week, localized day/date names and parsing (sandbox:
`provideNativeDateAdapter()`; iusta: its Luxon adapter at the boundary).

**Budgeted shenanigans** (all present in Google's reference example — plan
for them, don't discover them):
- W3C APG boundary-crossing is manual anyway: Arrow keys across month
  edges, PageUp/PageDown ±1 month (±12 with Ctrl), Home/End to month
  bounds — the Grid pattern doesn't do calendar semantics for you.
- Month transitions destroy the focused cell: park focus on the grid
  container, RESET the pattern's internal state
  (`gridBehavior.focusBehavior.activeCell/activeCoords`), mark the target
  cell (`data-focus-target`), then restore focus post-render via a
  `viewChildren` + `effect` loop with a microtask cleanup to dodge circular
  signal writes.
- Escape must synchronously refocus the trigger BEFORE collapsing the
  popup, or focus drops to `<body>` and the overlay misbehaves.
- Selecting a date: refocus the field synchronously before closing.

## T3 — Native time picker polish

Refine T1's native input: `step`/min/max attributes, the
`showPicker()` support matrix (Safari desktop lacks it — verify the focus
fallback), and whether the mat-form-field mode (T4) should render the native
input directly instead of the inline panel.

## T4 — Mat-form-field hosting (all three controls)

Requirement: date, time and duration must be usable INSIDE
`<mat-form-field>` (dialogs, dense forms) — while staying inline-first
elsewhere.

**Adopt iusta's proven adapter pattern instead of inventing one.** iusta
already ships `MatFormFieldAdapterContract` (a signal contract: `isEmpty`,
`_focused`, `_disabled`, `_placeholder`, `isValid`, `shouldLabelFloat`,
`id`, `targetedControl`, `onContainerClick`, `controlType`) plus a
`MatFormFieldAdapter` directive that provides `MatFormFieldControl`,
bridges signals → the `stateChanges` Subject Material still wants, and
derives `errorState = (field invalid || local invalid) && touched`. Plan:
- The inline controls implement the contract (most members already exist
  under our names — `isEmpty`, `editing`≈focused, `parseFailed`≈!isValid).
- **Presentation mode switch**: inside a mat-form-field there is no idle
  display and no elevated panel — the control renders its editing surface
  in place (detect via `MAT_FORM_FIELD` injection, iusta's
  `isInMatFormField` precedent). This is the real work: the session
  machinery (draft/commit/revert) stays, the overlay chrome goes.
- Sandbox gets a minimal copy of the adapter to develop against; iusta
  keeps its own.

## T5 — Range & linked fields ("they speak to each other")

**Sandbox fixtures exist:** the temporal playground carries the UNLINKED
quartet — stay · start · end · length in one signal form, seeded with an
overnight stay (21:00 → 06:00, the +1-badge case) — as THE fixture the
group directive will be developed against. The sign-in dialog additionally
hosts an unlinked trio (date of birth / military time via the
`en-u-hc-h23` locale extension / duration) for the dialog-hosted form
angle. Both grow into the maximal date-range + time-range + duration
composition below. (The dialog is dynamically
imported: it carries the phone metadata AND the temporal entry point, so
a static import would drag both into main — it did, until it didn't.)

**The destination (decided): the maximal group is date range + time range
+ duration.** The trio is only the reduced form — the full composition a
consumer can wire up is start day | end day | start time | end time |
duration, all speaking to each other: one range of datetimes decomposed
into five inline fields. Everything below scales to that shape.

- **Day-overflow badge on the end time.** When the composed end datetime
  lands on a later calendar day than the start (22:00 → 06:00 = next
  day), the end-time field renders a `+1`-style badge — the airline
  arrival-time pattern (`+2`, `+n` for multi-day). It is an ADORNMENT:
  a suffix affix outside the contenteditable (caret-proof,
  parser-invisible, described via aria), DERIVED by the group from the
  date + time fields — never part of the draft and never encoded in the
  `'HH:mm'` value. When no date fields participate (a pure time range),
  the badge still applies with wall-clock semantics: an end at or before
  the start reads as next-day.
- The badge REFRAMES the ordering invariant: `end >= start` applies to
  the composed DATETIMES, not to the time fields in isolation — a
  wall-clock end earlier than the start is legal exactly when the day
  offset covers it, and the badge is what makes that legibly so.

The particular UX, verbatim requirements:
- **Two separate editing fields** for start and end — never one combined
  range input.
- **Tab advances start → end when the draft is valid**: typing a parseable
  date(time) into the start field and pressing Tab commits it and moves the
  session to the end field in one gesture (keyboard flow mirrors the
  natural fill order; Shift+Tab returns). An unparseable draft keeps the
  normal parse-gate behavior — Tab doesn't skip past an error. Combined
  with T2's open-on-edit, the whole range is enterable without leaving the
  keyboard: focus start → calendar mirrors typing → Tab → type end → Enter.
- **Press-hold-drag** on the calendar paints a range (port the pointer
  logic of iusta's `DateRangeDragAndRelease`, which does exactly this over
  MatCalendar, onto the T2 grid cells: mousedown anchors, mousemove paints
  `data-in-range`, mouseup commits).
- **Ctrl+click** sets start, then end.
- **Decomposition**: pasting a full ISO datetime into either field yields
  day + start time + end time + duration across the group.

**Architecture (revised by the value decision):** the ranged date control
is SELF-CONTAINED — when the value shape is an object, the ONE control
renders two editing fields (start | end) internally and carries the whole
range in its single `value`. No group needed for date-only ranges. The
`DateTimeRangeGroup` directive survives with a narrower job: linking
SEPARATE controls (a date control + time controls + a duration control)
when a consumer composes them — still via DI, still owning the invariants:
- `end >= start` over the COMPOSED datetimes (violations = errors on the
  offending field, mat split; a wall-clock-earlier end covered by the day
  badge is NOT a violation);
- the day-overflow badge on the end-time field (derived, see above);
- `duration = end − start`; editing duration moves `end`;
- day edits shift both sides preserving wall-clock times;
- a full ISO datetime pasted anywhere decomposes into the group;
- both calendar overlays render the SAME range state; drag/Ctrl+click
  write through the group.

Open decision: group as directive+DI (lean, fields stay reusable — the
lean choice) vs a composed `angular-inline-datetime-range` component
(easier to drop in, less flexible). Leaning directive+DI.

## T6 — Datetime + timezones

`m-editable-date-time` parity: ISO 8601 with offset, iusta's
`ServerSideDatetimeConfiguration` as the source of truth for display
timezone. Deliberately last — T5's group must exist first.

## Migration mapping (for the iusta phase, later)

| iusta | value today | sandbox control | conversion at wrapper |
| --- | --- | --- | --- |
| m-editable-time | `TimeValue<false>` = string | inline-time | direct |
| m-editable-time (ranged) | `TimeValue<true>` object | T5 group | to/from `LocalFormValue` |
| m-editable-time-duration | seconds | inline-duration | direct |
| m-editable-date-v2 | Luxon `{start, end}` | inline-date / T5 group | Luxon ↔ ISO |
| m-editable-date-time | Luxon + server tz config | T6 | TBD |

## Field notes for the next session — traps & tribal knowledge

Everything below bit us once already or is one step from doing so. Both
repos: sandbox (`~/Documents/private-repo/angular-inline-select`) and iusta
(`~/Documents/iusta-repo/iusta-core-frontend`).

**Environment**
- Default shell node is v14 — EVERY build/test needs
  `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"`. The preview
  `launch.json` is already pinned to the node 24 binary.
- iusta `npm install` requires `--legacy-peer-deps` (ng-bootstrap peer
  conflict).

**Repo divergence (the biggest trap)**
- The two repos deliberately DIFFER in structure now: the sandbox keeps
  layered `angular-inline-number/phone/...` components; iusta FLATTENED
  them — its vendored `core/editables/inline/` holds ONLY the text core +
  directives + phone codec/adapter, and `m-editable-number-v2` /
  `m-editable-telephone-number` ARE the full implementations. When
  migrating temporal, absorb into `m-` components the same way — do NOT
  recreate the wrapper layer.
- Re-syncing the iusta text core from the sandbox: copy, flatten import
  paths, run `eslint --fix` (prettier configs differ), and beware the iusta
  specs reach inner controls via `debugElement.children[i]` DEPTH — layer
  changes silently break those selectors.
- iusta's `phone-codec-loader` uses the `@Service()` decorator (exists in
  this Angular 22; compiles fine — don't "fix" it to `@Injectable`).

**Build/test mechanics**
- `ng test --include` takes SPEC-ONLY globs (`**/*.spec.ts`). A bare `**`
  matches `.html`/`.scss` and explodes as "No loader configured" — that
  error means bad glob, not broken code.
- Secondary entry-point specs need their own include in the test target
  (`"../phone/src/**/*.spec.ts"`-style, globbed from sourceRoot) — repeat
  for `temporal/` in T0, in BOTH repos' angular.json where applicable.
- THE BARREL RULE: never export a heavy adapter (libphonenumber-codec,
  future date adapters) from a barrel — it silently drags the engine into
  eager bundles. Verify after prod builds: engine markers (`TOO_SHORT`,
  `nonGeographic`) must appear only in chunks absent from `index.html`.
  Note markers can shift with minification — grep several.
- iusta's eslint `component-selector` prefix list contains `'['` which
  CRASHES the rule for any selector not matching an earlier prefix
  (pre-existing bug). Vendored dirs need the scoped rule-off override that
  `core/editables/inline/**` already has.

**Component-pattern invariants (violating these caused real bugs)**
- `linkedSignal` freeze pattern (`previous`, `innerValue`): freeze on
  `editing()`, NEVER on field `dirty` (sticky — never thaws); pin-read
  before elevating. New temporal controls must copy this exactly.
- The editing bridge must be a PUBLIC `editing = model(false)` on every
  composed control (private `innerEditing` broke `[(showForm)]` on number).
- `contentChild` cannot sit on an ES-private `#field` (NG1053) — use TS
  `private`.
- Content queries don't pierce re-projection: TemplateRef INPUTS are the
  composition channel, contentChild is only direct-use sugar.
- Session-open resets (`#saveAttempted`) must live in the editing-edge
  effect, not only in `elevate()` — external `editing.set(true)` paths
  (pickers seeding drafts) bypass `elevate()`.
- `strictTemplates` vs the polymorphic `InlineDateValue`: expect friction
  binding a union-typed `model()`; the precedent is number's
  `model<number | string | null>` — widen the model, keep outbound writes
  narrow.

**@angular/aria reality check**
- `ngCombobox` hard-checks `tagName === input|textarea` — dead on
  contenteditable. `ngListbox` keyboard only fires with host focus — dead
  for focus-stays-in-editor patterns. Both fine where the popup OWNS focus
  (the T2 calendar). The Grid month-transition workaround pokes
  `_pattern.gridBehavior` internals — re-verify on every @angular/aria
  version bump; keep the hand-rolled-grid fallback in mind.

**Testing/preview quirks**
- Overlay sessions close BETWEEN separate `preview_eval` calls — script
  multi-step browser flows inside ONE eval.
- After programmatic `editor.textContent = x`, the caret sits at offset 0 —
  slash-menu/caret-dependent tests must place the selection at the end
  manually (helper exists in the phone/date specs).
- `showPicker()` needs a user gesture + secure context; Safari desktop
  lacks it — the focus() fallback is the path there.

**Deferred debts (don't lose these)**
- iusta: config-flag-inputs still uses old `m-editable-number` (1 site;
  needs consumer schema refactor). P4 cleanup: legacy `.iusta-editable`
  sass block + EditableWrapper/OverlayControl/EditableCore orphan audit.
  Manual QA of dataset-overview/case/customer-details still pending.
- Sandbox: Safari/iOS manual pass (plaintext-only fallback, IME, caret).

## Open questions

1. `@angular/aria` Grid maturity — Google's own example pokes
   `_pattern.gridBehavior` internals for month transitions; if that API
   shifts, budget a hand-rolled roving-tabindex grid as fallback.
2. Range across months (drag near an edge → auto-advance month?) — decide
   during T5.
3. Time seconds precision (`'HH:mm:ss'`) — needed anywhere in iusta?
4. Should duration join the T5 group as a *field* (editable) or a *derived
   display* only? Leaning: both, consumer's choice.
