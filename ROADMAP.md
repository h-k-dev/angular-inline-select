# Roadmap — angular-inline-text

## North star

**The field dictates, the component renders.** `angular-inline-text` is a
`FormValueControl` — it should own no state the `FormUiControl` contract has a
word for. Its only private state is the *session* concepts signal forms does
not model: the draft (living in the `value` channel), the session baseline,
the open panel, and `saveAttempted`.

Our one honest deviation from a normal form: there is one field and no form
tag, therefore no `submit`. `accept()` is a per-field submit, and
`#saveAttempted` is our stand-in for the `form.submitted` half of mat's
`ErrorStateMatcher`. Everything else defers to the bound field.

Mat-form-field split, applied throughout: the **consumer decides what errors
say** (projected `[editable-error]`, the `mat-error` analogue), the **field
decides when they show** (`invalid && (touched || saveAttempted)`).

Guiding precedent: `MatInput`. It implements `MatFormFieldControl` with *no*
value ownership — value restoration is the form's job; the control only keeps
its presentation state honest. Signal forms improves on its `ngDoCheck`
error-state polling by delivering `touched`/`invalid` as inputs.

---

## Shipped on this branch

- **Error slot takeover.** The `[editable-error]` projection is gated by the
  field itself (`errorsVisible`) and takes over the slot entirely via
  `ng-content` fallback content; without projection the field renders
  message-carrying contract errors. Consumers only write `hasError(kind)`
  analogues — never `touched()` checks.
- **Contract adoption** (`touched`, `invalid`, `hidden` inputs + `reset()`).
  `errorsVisible = isInvalid && (touched() || #selfTouched() ||
  #saveAttempted())` — the field's touched verdict wins, `#selfTouched`
  covers the `[(value)]`/standalone modes. `isInvalid = invalid() ||
  errors().length > 0`. `hidden` collapses the host. `reset()` is
  presentation-only (MatInput precedent) plus the one draft-control extra:
  an open draft is discarded back to the baseline with no `touch`, no
  `saved`, no `reverted`, no focus stealing (`#wasOpen = false; accepted =
  true; editing.set(false)`).
- **`localForm` and `localModel` removed.** The draft *is* the `value`
  channel; component state collapsed to `value` + derived `previous` +
  reveal flags. `previous` is a `linkedSignal` frozen on `editing()` (never
  field `dirty` — sticky, would never thaw), pinned by a read in `elevate()`
  before the freeze.
- **`saved` event** — `{ value, changed }`, exactly once per settled session
  (Save, Discard, clear). Legacy `savedModelChange`/`reverted` are marked
  superseded; the demo's form example logs all three for comparison.
- **Idle error state.** Host gets `editable-text--invalid` while
  `errorsVisible` — solid `--mat-sys-error` underline on the display, the mat
  red-underline analogue. `aria-invalid` on the display is suppressed when
  merely empty-and-required (MatInput detail — overlaps `aria-required`).
- **Clear commits, mat-faithful.** Clear always commits `''` and marks
  touched (`touch.emit()` → field `markAsTouched()` → `touched` input →
  reveal); a schema that rejects `''` surfaces through the idle error state
  immediately. `required()` keeps hiding the bubble.
- **Demo/UI coverage.** "Mark touched" (reveal with zero interaction) and
  "Reset field" (silent draft discard) buttons; event console; browser-
  verified: blocked invalid save emits nothing, discard/commit/clear settle
  exactly once, reset emits nothing, `markAsTouched()` flips the idle error.
- **Normalization is edge-only.** `normalizeString` = `trim()`: interior
  spaces and line breaks are user content and always survive; single-line
  fields strip line breaks at the input level. Paragraph demo has a
  Normalize on/off toggle + example reset.
- **Hardening.** Bubble close timer cleared via `DestroyRef` (no post-destroy
  signal writes); panel ids from CDK `_IdGenerator` — DI-scoped, so the
  sequence is deterministic across an SSR render and its client hydration.

Verified against `@angular/forms/signals` 22.0: `touched`/`invalid`/`hidden`
are auto-bound custom-control inputs; `touch` → `markAsTouched()`;
`FieldState.reset(value?)` writes the model only if a value is passed (it
arrives via the `value` binding) and then invokes the control's `reset()` —
so an open session's rollback-to-baseline deliberately wins over a mid-session
reset value, per design.

## Remaining

### Complete Phase 3 — remove the legacy outputs

Delete `savedModelChange` and `reverted` (breaking; pre-1.0), migrate the
demo bindings to `(saved)` (`$event.value`), drop the comparison entries from
the event console. Do this once the `saved` payload has proven itself in use.
Note `reverted` is the only carrier of the *discarded draft text* — confirm
nothing needs it before deleting.

## Next up — editable-number & multi-page demo

**Design rule (no OOP):** new controls never inherit from `AngularInlineText`.
Sharing happens at exactly two seams:

1. **The contract.** Every control is its own `FormValueControl<T>`; the
   `FormField` directive treats them identically.
2. **Composition.** A control that is "text plus a value translation"
   *contains* an `<angular-inline-text>` in its template and translates at
   the boundary. It forwards the contract in, retypes the events out.

If a future control needs the session machinery *without* being text-shaped
(inline-select…), that is the trigger to extract headless primitives — a
`createEditSession()` factory of functions and signals, not a class
hierarchy. Not before.

### Phase N1 — demo shell & routing — **shipped**

Lazy `/text` (all previous sections) and `/number` pages; the app is a shell
(toolbar: editable title, `routerLink` nav with active state, theme, Sign
In + `<router-outlet/>`). Shared page scaffolding lives in
`pages/_demo.scss`; the anchor nav, layout-shift tester and table styles
moved into the text page.

### Phase N2 — `angular-inline-number` — **shipped**

A `FormValueControl` that **contains** an `<angular-inline-text>` (no
inheritance):

- **Model:** `value = model<number | string | null>` — strings/numbers
  coerce on the way in, every outbound write and event is `number | null`
  (empty commits `null`).
- **Codec:** `parse`/`format` inputs with dot-decimal defaults (`''` →
  `null`, unparseable → `undefined`); Intl/locale variants plug in with
  zero API change.
- **Parse gate is just an error:** an unparseable draft appends a synthetic
  message-less `{ kind: 'parse' }` to the forwarded errors — the inner
  accept guard blocks the save, the inner slot shows the consumer's
  projected message. `parseFailed` is public because the synthetic error
  never reaches the outer field (signal forms has no custom-control
  parse-error channel yet) — consumers gate their message on
  `#ref.parseFailed()`.
- **String channel** is a `linkedSignal` frozen while the inner session is
  open (same pattern as `previous`), so a reformat can never rewrite the
  text under the caret; commits round-trip the codec (`'12.50'` settles and
  displays as `12.5`).
- **Contract forwarding:** state inputs in; `touch` + `saved`/
  `savedModelChange` (retyped `number | null`) out; `focus()`/`reset()`
  delegate; `[editable-error]` re-projects via `ngProjectAs`. Always
  single-line, always edge-normalized.
- 11 specs; browser-verified on the `/number` page: parse gate blocks with
  its message, `min`/`max` messages switch live per kind, commits log real
  numbers, discard rolls the live number back.

### Affix templates (`editablePrefix`/`editableSuffix`) — **shipped**

The matPrefix/matSuffix analogue, generic on `angular-inline-text` and
forwarded by `angular-inline-number`:

- Declared on an **`ng-template`**, not an element — the affix renders TWICE
  (after the in-flow display, and beside the editor inside the panel),
  because the panel covers the surrounding copy and a unit written next to
  the field would vanish exactly while the user edits. Templates stamp into
  both spots; projected elements cannot.
- Never part of the draft: outside the contenteditable, caret-proof,
  parser-invisible, `user-select: none`. Rendered `aria-hidden` — units
  belong in `ariaLabel`.
- Composition channel: `prefixTemplate`/`suffixTemplate` inputs carry the
  `TemplateRef` through wrappers (content queries don't pierce
  re-projection); `contentChild` on the directives is the direct-use sugar.
- The in-flow field area (`.editable-text__field`) wraps affixes + display,
  dims as a whole while editing, and anchors the clear bubble (after the
  suffix, not the text).
- Demo: `/number` price card — `toFixed(2)` codec + euro icon suffix.
  Gotcha for consumers: `contentChild` requires non-ES-private fields
  (NG1053).

### Phase N3 — number polish (later)

- `inputmode="decimal"` / `enterkeyhint` on the editable surfaces (small
  generic attr input on editable-text) for mobile keyboards.
- Contract `min`/`max`/`step`-style inputs — meaningful for numbers (unlike
  text); auto-bound by the field, surfaced as hints.
- Intl codec preset (locale grouping/decimal comma) shipped as an opt-in
  `parse`/`format` pair.

### Manual QA — Safari / iOS pass

The `plaintext-only` probe falls back to `contenteditable="true"` + manual
paste sanitization on WebKit builds that misreport support. Needs a hands-on
pass on iOS Safari: paste interception, IME composition elevate, caret
replay, and the Selection-based paste fallback.

## Later (needs real behavior, not just a declared input)

- `pending` — block commit while async validation runs; "Validating…" hint in
  the panel footer. Accept-as-submit should not commit an unknown-validity
  draft.
- `minLength` / `maxLength` — enforce in `replayEdit`/editor input
  (contenteditable has no native `maxlength`); expose in panel hints.
- `disabledReasons` — render as a hint/tooltip on the disabled display.

## Deliberately not implemented

- `dirty` — field-dirty is sticky; our "Unsaved changes" hint and the
  `previous` baseline are session-scoped. Binding field-dirty would make the
  hint lie and permanently freeze the baseline.
- `name` — no native form element to carry it.
- `min` / `max` — meaningless for `TValue = string`.
- `pattern` (input) — nothing native to bind it to; validation already
  arrives via `errors`. Declaring inputs with no behavior is contract theater.

## Known deviations (owned, documented)

- A `field.reset('new value')` issued *while a session is open* loses the
  reset value: the control's draft rollback runs after the field's value
  write and restores the session baseline. Intentional — an open session's
  draft protection wins; reset a closed field to apply a value.
- Rolling the draft back during a mid-session `reset()` re-marks the field
  dirty (the rollback flows through `controlValue.set`). Cosmetic; revisit if
  it ever matters.
