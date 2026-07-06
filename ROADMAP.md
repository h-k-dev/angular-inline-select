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

**Guardrail — the ProseMirror line.** `angular-inline-text` is a *value*
editor (flat string), never a *document* editor, and stays that way:

1. The editable contains characters only — every adornment (affixes, flag,
   preview, menu) renders OUTSIDE the contenteditable.
2. The draft is never transformed under the caret (as-you-type formatting is
   permanently rejected — position mapping through transforms is the start
   of hand-rolling a bad ProseMirror).
3. The moment a requirement needs a tree — marks (bold/links), atomic
   in-text tokens/pills/mentions, semantic blocks, semantic undo, collab —
   that feature does NOT grow here. It becomes a separate control behind
   the same `FormValueControl` contract, with ProseMirror (or similar)
   contained inside it by composition, exactly like libphonenumber is
   contained in the phone codec. PM owns its DOM and its state lives
   outside signals — bridging it is intl-tel-input flag-hell at 10×, a
   price paid only when the problem is genuinely documents.

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

## Next up — `angular-inline-phone`

### The core decision: own the UI, never the metadata

Phone handling is two problems with opposite build-vs-buy answers:

1. **The engine** (what is a valid number, how does it format): this is
   Google's libphonenumber metadata — ~250 regions, updated continuously as
   carriers change numbering plans. **Never hand-roll this.** Correctness is
   a moving target that Google chases for us.
2. **The UI** (input surface, country affordance, error presentation): we
   already own a better one than any widget ships. **Never import someone
   else's DOM/CSS again.**

`intl-tel-input` is rejected on architecture, not quality: it is a DOM+CSS
widget (the twice-broken CSS is structural — their markup IS their API), its
`utils.js` is a ~260 kB monolith you load whole, and every piece of UI it
offers (input, dropdown, flag sprite) is something our inline paradigm
replaces. What we actually want from that stack is the thing underneath it:
**`libphonenumber-js`** — the maintained, modular rewrite of Google's
library.

### Tree-shaking strategy (three independent seams)

1. **Secondary entry point.** The phone control and its adapter live in
   `angular-inline-select/phone` (ng-packagr secondary entry point, the same
   mechanism as `@angular/material/button`). Apps that never import it carry
   zero phone bytes — the core library stays engine-free.
2. **Codec injection, again.** Like number's `parse`/`format`, the control
   takes a `PhoneCodec` — a plain interface of functions (no OOP):
   ```ts
   interface PhoneCodec {
     parse(raw: string, defaultCountry?: string): PhoneParseResult;
     // e164 + country on success; a reason ('too-short' | 'too-long' |
     // 'invalid-country' | 'not-a-number') on failure
     format(e164: string, style: 'national' | 'international'): string;
     placeholderExample?(country: string): string;
   }
   ```
   The control never imports libphonenumber-js; it consumes the codec.
   `PhoneParseResult` carries the full interpretation, not just pass/fail:
   `{ e164, country, dialCode, formatted }` on success plus a
   `reason`/`warning` tier (see below) — the UI renders *what the engine
   understood*, live.
3. **Metadata injection into the adapter.** `libphonenumber-js/core` exports
   metadata-free functions; the metadata is an argument. Our adapter is a
   factory:
   ```ts
   createLibphonenumberCodec(metadata) // consumer picks the payload
   ```
   Consumers choose `libphonenumber-js/metadata.min.json` (~all countries,
   validation-grade), `.max` (stricter type detection), `mobile`, or a
   **custom subset built with the package's metadata generator CLI**
   (`--countries DE,AT,CH` → a few kB). `libphonenumber-js` becomes an
   optional peer dependency of the secondary entry point only.

The flag/country affordance uses **flag emoji** (two regional-indicator code
points from the ISO country code) — zero sprites, zero CSS dependency, the
entire class of intl-tel-input breakage is structurally impossible.

### Value contract

- `value = model<string | null>` holding **E.164** (`'+4917112345678'`) —
  canonical, serializable, locale-free; empty commits `null` (same decision
  as number). `saved`/`savedModelChange` always emit E.164 or `null`.
- Display formatting is presentation: `displayFormat` input
  (`'national' | 'international'`), rendered through the codec on commit —
  same round-trip principle as `'12.50'` → `12.5`.
- Detected country, national form, and parse reason are exposed as public
  computeds (like `parseFailed` on number) for consumer error content and
  UI, not stuffed into the value.

### Phases

**P1 — codec + adapter — shipped.** `PhoneCodec`/`PhoneParseResult` +
`countryFlagEmoji` in `angular-inline-select/phone` (secondary entry point;
`libphonenumber-js` is an optional peer dep). `createLibphonenumberCodec(
metadata, examples?)` over `libphonenumber-js/core`. Severity emerges from
parseability: readable-but-suspicious input parses with a `warning`
(committable), unreadable input fails with a `reason` (gated) — pinned
against the real engine (`'017'@DE` → E.164 `+49017` + `too-short` warning;
`'abc'` → `not-a-number`; national digits without country →
`invalid-country`). **Measured bundle cost:** the demo's `/phone` lazy chunk
— control + adapter + full min-metadata for every country — is ~173 kB raw /
**~36 kB transfer**, loaded only on that route; the number page's chunk stays
at ~3.8 kB (entry-point isolation proven). A custom country subset shrinks
it further.

**P2 — `angular-inline-phone` — shipped** (as specified below, plus the
`editableHint` slot and generic `inputMode` input on `angular-inline-text`;
number now sends `inputmode="decimal"`, phone `"tel"`). Browser-verified:
`… abc` blocked with the projected parse message, `⚠ +49 017` committed
(warn-don't-block), `+33…` flips the flag to 🇫🇷 live, commits log E.164.
One discovery: the unit-test builder globs from `sourceRoot`, so the
secondary entry's specs need `"include": ["**/*.spec.ts",
"../phone/src/**/*.spec.ts"]` in the test target.

**P2 — `angular-inline-phone` (composition MVP).** Same shape as number:
contains `angular-inline-text`, forwards the contract, retypes events to
E.164. `defaultCountry` input for national-format typing; `+CC` input
overrides it (parser detects).

- **The live interpretation preview is the centerpiece** (production
  lesson: "the user must SEE it — phone numbers are flimsy"). While the
  session is open, a hint line in the panel footer shows what the engine
  understood of the current draft, per keystroke: 🇩🇪 `+49` · "will save as
  +49 171 1234567" — or the parse reason. This delivers as-you-type
  *visibility* with zero caret rewriting: the draft is never touched, the
  interpretation renders next to it. (Needs a small generic `editableHint`
  slot on `angular-inline-text` — hint template rendered in the panel
  footer; also future home for maxLength counters.)
- **Two-tier severity, warn-don't-block** (production lesson: the old
  control shipped soft issues as warnings, never blocked them). Commit gate
  = structurally impossible input only (`not-a-number`, `invalid-country`);
  soft findings (`too-short`/`too-long`/`possible-local-only`) surface as a
  warning in the preview line and via a public signal, but commit stays
  allowed; business strictness (`isValid`, mobile-only) ships as
  signal-forms validators for the consumer's schema.
- **Flag emoji as detection feedback, not decoration**: the built-in prefix
  shows the *detected* country (falling back to `defaultCountry`), updating
  live — its job is deciphering `+49` vs `+21` at a glance, idle and while
  editing. No picker in the MVP.
- **Example-number placeholders**: `numberType` input
  (`'mobile' | 'fixed-or-mobile'`) feeds `codec.placeholderExample()` —
  the placeholder shows a real example for the default country.
- `inputmode="tel"` via the new generic attr input on the text control
  (pulled forward from N3).
- **No live reformatting of the draft** — validate live, preview live,
  format on commit (round-trip through the codec, like `'12.50'` → `12.5`).
  Confirmed by production: the old control ran `formatOnDisplay: false` for
  the same reason.

**P3 — as-you-type formatting: REJECTED, permanently.** Decided: rewriting
the draft under the caret is never acceptable, and the live interpretation
preview already delivers the visibility it promised. If anyone proposes
this again, the answer is the preview line.

**P4 — slash command menu — SHIPPED.** A typed, keyboard-first menu, the
seed of the future inline-select. Implemented exactly as designed below.

- **Core seam (`angular-inline-text`):** `menuTemplate` input +
  `ng-template[editableMenu]` content sugar, dormant unless provided. The
  control owns trigger detection (`detectSlashToken` — `/` at draft start or
  after whitespace, no mid-word slashes), DOM-based navigation over the
  consumer's `[role="option"]` elements, two-stage Escape, combobox ARIA
  (editor becomes `role=combobox` with mirrored `aria-activedescendant`),
  and the `apply(replacement, {replaceToken?})` callback (rewrites the draft
  via the caret machinery, whole-draft by default). Context gives the
  consumer `{ $implicit: query, activeId, apply }`.
- **`@angular/aria` finding (why we didn't use the directives):** `ngCombobox`
  hard-checks `tagName === input|textarea`, so on our contenteditable it
  degrades to a non-editable select; `ngListbox`/`ngOption` keyboard is
  host-focus-bound and never fires while focus stays in the editor, and
  `ngOption`'s `data-active` is driven by the listbox's own (never-active)
  navigation. Driving them would mean forwarding synthetic events into a
  focus-assuming widget — the intl-tel-input bridge trap at small scale. So
  we implement the raw ARIA **combobox pattern** (which is all the directive
  encodes) by hand, since we already own the editor keyboard. Consumers get
  plain `[role="option"]` divs; they may still layer aria typeahead if they
  want, our nav is DOM-based either way.
- **Phone country menu:** `AngularInlinePhone` provides the `editableMenu`
  template; consumer-owned `@for` + `countryOptions(query)` search, control
  owns nav. Selecting rewrites the draft to `'+49 '` → existing detection
  flips the flag and preview. **i18n via `Intl.DisplayNames`** (`menuLocale`
  input, browser default) — zero bundled country names, every locale. Search
  matches the localized name **and** the English name **and** ISO **and**
  dial code, so `/germany`, `/deutschland`, `/de`, `/49` all resolve to 🇩🇪
  in any menu locale. Browser-verified de↔en switching; secondary-entry-point
  production build confirms `libphonenumber` is referenced only in the phone
  bundle, never the core.
- **Later:** this menu is the core of `angular-inline-select` (filtered
  option list in the panel) — the `createEditSession()` extraction trigger.

**P4b — flag country picker (the primary / mobile gesture) — SHIPPED.** The
slash menu is a keyboard *insert* gesture (great for fresh entry); changing
the country of an *existing* number is a *transform* and needs the
established phone-input gesture: an interactive flag opening a searchable
list, preserving the national number. Both gestures share one option list.

- **Interactive flag:** phone renders the flag prefix as a `<button>` (tappable
  on mobile, Tab-reachable in the panel) that opens a **CDK overlay**
  (`@angular/cdk/overlay`) with its own search `<input>` — so the draft is
  never touched. `angular-inline-text` stays country-ignorant; it's all in
  the projected prefix + phone's overlay.
- **NSN preservation:** codec exposes `nationalNumber`; `pickCountry` rebuilds
  `+<newDial><nationalNumber>`. Verified: `+49 30 12345678` → pick AT →
  `+43 3012 345678`, digits intact, flag 🇩🇪→🇦🇹.
- **Three apply paths:** editing → rewrite the live draft; idle with a number
  → swap + commit immediately (emits `saved`, like the clear bubble); idle +
  empty → open the editor seeded with `+<dial> ` to type from.
- **Shared:** one `#countryRow` template + `countryOptions()` filter +
  `Intl.DisplayNames`/English-fallback search feed both the slash menu and
  the picker. The picker nav is index-based over the filtered array (its own
  search field owns focus); the slash nav stays the editor DOM-walk.
- Demo: `/phone` gained a **fresh-entry empty-field card** (both gestures
  from scratch) and a `menuLocale` toggle. 71 tests; production secondary-
  entry-point build still isolates `libphonenumber` to the phone bundle.

Original design notes:

- **Core seam (dormant unless fed):** `angular-inline-text` gets a
  `commands` input (`InlineCommand[]` or a `(query) => InlineCommand[]`
  source). Undefined → the feature doesn't render or listen; text and
  number stay untouched. Same philosophy as the affix/hint slots: the
  capability is core, activation is per-consumer. (A separate directive
  would be more byte-optional but requires exposing editor internals —
  extract one later only if the menu grows heavy.)
- **Mechanics:** menu renders INSIDE the panel between editor line and
  footer — no second overlay, no positioning math. Focus stays in the
  contenteditable; combobox pattern (`aria-activedescendant`) for virtual
  arrow-key navigation. Trigger: `/` at draft start or after whitespace;
  query = text from `/` to caret. Escape is two-stage (menu, then
  session); Enter/Tab selects; dismissed tokens don't re-trigger. On
  selection the control rewrites the draft itself (it owns the caret) and
  emits `(commandSelected)`.
- **Phone integration is detection, not state:** picking a country rewrites
  the draft to `'+49 '` — the existing parser detects DE, the flag flips,
  the preview updates. No override signal, no new plumbing. Country names
  come from `Intl.DisplayNames` (localized, zero bytes — replaces the
  i18n country bundles the old intl-tel-input setup shipped); commands
  match against localized name, English name, ISO code, and dial code, so
  `/german`, `/deutschland`, `/de` and `/49` all resolve to 🇩🇪.
- **Caveat:** `/` can collide with real content in generic text fields
  ("either/or") — start-of-token rule mitigates; commands stay strictly
  opt-in and never become a default.
- **Later:** the same menu machinery is the natural core of
  `angular-inline-select` (filtered option list in the panel) — the
  `createEditSession()` extraction trigger moves here.

**Demo:** `/phone` page — `defaultCountry="DE"` field, E.164 model display,
per-reason projected errors, event console, and a bundle-size note comparing
min vs custom metadata.

### Production lessons absorbed (from the previous intl-tel-input control)

- E.164 out on accept (`getNumber(0)`) — unchanged, already the contract.
- Numeric validation-error table (`TOO_SHORT`, `INVALID_COUNTRY_CODE`,
  `IS_POSSIBLE_LOCAL_ONLY`, …) surfaced as *warnings*, never commit
  blockers → the two-tier severity design above.
- `formatOnDisplay: false` in production → confirms MVP skips draft
  reformatting.
- `placeholderNumberType` driven by an `isMobilePhone` input → the
  `numberType` + example-placeholder feature.
- `dialCode` exposed as a model + data attribute → public
  `country`/`dialCode` computeds and the flag-as-feedback prefix.
- The flag-hell that disappears by being signal-native end-to-end: no
  `#isUpdatingFromControl`/`#isUpdatingFromInput` circular-update guards, no
  `#didInitialSync` + `queueMicrotask` + `requestAnimationFrame` double
  reset, no "parent must seed `previous`" workaround (the derived
  `previous` baseline covers it), no `afterRenderEffect` init/destroy
  lifecycle for a foreign widget. That entire class of code existed to
  bridge an imperative DOM library into signals; composing our own control
  makes it unrepresentable.

### Open questions (brainstorm)

1. **Extensions** (`x123`) — E.164 doesn't carry them; libphonenumber does
   (`ext` field). Support in v1 or explicitly out of scope? (Decides the
   value shape — breaking to change later.)
2. **Warning presentation**: does the warning tier stay phone-internal
   (rendered in its preview line) or does `angular-inline-text` grow a
   first-class warning slot next to errors? Leaning: keep it in the preview
   line until a second control needs warnings.
3. **Who owns the default codec instance** — DI token with
   `providePhoneCodec(...)` app-wide vs per-instance input? Proposal: input
   with DI fallback, like mat's ErrorStateMatcher.
4. **Idle flag**: show the flag prefix on the committed display too, or
   only while editing? Leaning: idle too — deciphering `+49` at a glance is
   exactly the idle use case.

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
