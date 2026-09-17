# Roadmap — angular-inline-text

## North star

**The field dictates, the component renders.** `angular-inline-text` is a
`FormValueControl` — it should own no state the `FormUiControl` contract has a
word for. Its only private state is the _session_ concepts signal forms does
not model: the draft (living in the `value` channel), the session baseline,
the open panel, and `saveAttempted`.

Our one honest deviation from a normal form: there is one field and no form
tag, therefore no `submit`. `accept()` is a per-field submit, and
`#saveAttempted` is our stand-in for the `form.submitted` half of mat's
`ErrorStateMatcher`. Everything else defers to the bound field.

Mat-form-field split, applied throughout: the **consumer decides what errors
say** (projected `[editable-error]`, the `mat-error` analogue), the **field
decides when they show** (`invalid && (touched || saveAttempted)`).

Guiding precedent: `MatInput`. It implements `MatFormFieldControl` with _no_
value ownership — value restoration is the form's job; the control only keeps
its presentation state honest. Signal forms improves on its `ngDoCheck`
error-state polling by delivering `touched`/`invalid` as inputs.

**Guardrail — the ProseMirror line.** `angular-inline-text` is a _value_
editor (flat string), never a _document_ editor, and stays that way:

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
- **`localForm` and `localModel` removed.** The draft _is_ the `value`
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
- **Idle-gesture completeness.** Every common edit gesture on the idle
  display elevates in ONE action: type, delete, paste, and now **cut** (a
  `(cut)` handler writes the clipboard and elevates with the selection
  removed — previously `deleteByCut` fell through `replayEdit` and elevated
  unchanged, so cut took two gestures). Similarly, a `/` typed on the idle
  display opens the slash menu on elevation (detection runs in
  `handlePanelAttach`, not just on `input`). Known remaining fall-through:
  word-delete (`deleteWordBackward`) still elevates unchanged — rare, no
  clipboard stake; revisit if it bites.
- **Editable scope — Tab-to-accept (opt-in).** `[editableScope]` +
  `EDITABLE_SCOPE` (pull-based, the temporal leaf-state pattern): inside a
  scope, Tab/Shift+Tab in the elevated panel SETTLES the session and
  advances to the next/previous field — the temporal Tab-is-navigation tier
  ported to the panel family. Invalid drafts follow the scope's `onBlocked`
  (`'revert'` default: snap back + advance; `'stay'`: reveal + refuse);
  `advanceMode` `'edit'` (default — the landed field's session opens, so
  settle-and-keep-typing needs no second gesture; JSON registers so its
  dialog chains too) or `'focus'`; DOM-order walk with registered fields
  collapsing their chrome to one stop. The temporal controls hand their
  EDGE Tab to the walk (internal start↔end stays native), so date → JSON
  chains like text → text. Scopeless fields keep the focus trap exactly. A11y: settle outcomes announced via CDK `LiveAnnouncer` (saved
  polite; reverted/blocked assertive — silent data loss is the real Tab
  hazard) and a visually-hidden Tab instruction woven into the panel's
  `aria-describedby`; all strings are scope inputs for i18n. Demo:
  `/patterns/form-grid`; consumer/integration doc:
  `GUIDELINE-EDITABLE-SCOPE.md` (includes the phase-2 LLM-suggestion
  contract sketch — `suggestion` ghost text + two-stage Tab).
- **Custom-setter adoption (22.1 `linkedSignal` `set`).** Write-path
  invariants moved from call-site discipline into the signals themselves,
  synchronously and effect-free: TIME's `internalRange` became a writable
  view (echo + dedupe in the setter; the positional `#writeInstants` pairs
  deleted — per-side writes are `update(r => ({...r, [key]: x}))`); the
  RANGE GROUP writes leaves through their writable internals (`writeDayLeaf`
  — fixes a REAL bug: bare-string day-leaf writes silently flipped a
  `{ start }`-bound leaf's shape via shape memory; spec-pinned); NUMBER and
  PHONE `innerValue` setters absorb the parse half (phone's country-menu
  dial-code seed no longer bypasses the codec); the SIDE-SESSION draft
  setter marks `dirty` unforgeably with `restore()` as the one non-user
  write (duration mirrors privately). All 404 pre-existing specs passed
  unchanged + 4 new (`side-session.spec.ts` clamp trio, group shape
  preservation). Core porting map: `GUIDELINE-SETTER-ABSORPTION.md`,
  audited against core dev @ `2b517ffe` — the gate is one `npm ci`
  (package.json AND lockfile are at 22.1; only node_modules lags at 21.2,
  whose `linkedSignal` typings lack `set`).
- **Custom-setter round 2 — live channels ARE the setters.**
  `makeSideCore` gained an `onUserWrite` hook the draft setter invokes in
  the same synchronous push as marking dirty (restore/source resets fire
  neither; 3 specs). DATE and TIME moved their per-side live resolve into
  it — typed input and the OS picker now share one unforgeable path — and
  DURATION's live parse moved into its own draft setter. Date rides along:
  the move-whole slot law extracted to one `#sideSlots` shared by the day
  view and the raw-restore path (which stays outside `internalRange` on
  purpose — the day-typed view would swallow the unresolved raw). All 410
  pre-existing behavioral specs passed unchanged.
- **Custom-setter round 3 — per-session state is LINKED, not reset.**
  `#sessionTouched` (the pre-valuation session touch) became a
  `linkedSignal` sourced on `editing` with computation `() => false`: every
  session flip — `elevate()`, an external `editing.set(true)`, any close —
  recomputes it in the same synchronous pull; the pointer and the refused
  save write `true` in between. The `emitTouchOnClose` effect lost its
  opening branch and `reset()` its explicit clear. What stays an effect,
  and why: the closing edge emits `touch` (an event, not state) and can
  arrive through the two-way `editing` binding, which no setter observes;
  `#selfTouched` records that TRANSITION and a linked derivation only
  sees an edge when read on both sides of it — `errorsVisible` never reads
  that branch while a session is open, so it would miss every close on a
  valid field. One new spec pins the external-open reset; all 460
  pre-existing specs passed unchanged.

Verified against `@angular/forms/signals` 22.0: `touched`/`invalid`/`hidden`
are auto-bound custom-control inputs; `touch` → `markAsTouched()`;
`FieldState.reset(value?)` writes the model only if a value is passed (it
arrives via the `value` binding) and then invokes the control's `reset()` —
so an open session's rollback-to-baseline deliberately wins over a mid-session
reset value, per design.

## Remaining

### ~~Complete Phase 3 — remove the legacy outputs~~ — REVERSED (2026-07-09)

**USER DECISION: `savedModelChange` is PERMANENT — the DNA of the
library.** It is part of every editable, here and in iusta, and will never
be deprecated. `saved` (the session payload `{value, changed, …}`)
coexists as the richer sibling, not the successor. The two emit together
on every settled change; consumers pick the shape they want. (`reverted`'s
fate stays open — it is the only carrier of the discarded draft text;
decide separately if it ever matters.)

Open convergence note: iusta's temporal `savedModelChange` payloads are
richer _details_ objects (Luxon `DateSavedDetails`/`TimeSavedDetails`)
while the sandbox emits the raw value — same DNA, different plumage.
Whether the details shape upstreams into the sandbox (Luxon is already
contained in `/temporal`) is an open Phase-6 question.

## Next up — editable-number & multi-page demo

**Design rule (no OOP):** new controls never inherit from `AngularInlineText`.
Sharing happens at exactly two seams:

1. **The contract.** Every control is its own `FormValueControl<T>`; the
   `FormField` directive treats them identically.
2. **Composition.** A control that is "text plus a value translation"
   _contains_ an `<angular-inline-text>` in its template and translates at
   the boundary. It forwards the contract in, retypes the events out.

If a future control needs the session machinery _without_ being text-shaped
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
- ~~Intl codec preset (locale grouping/decimal comma) shipped as an opt-in
  `parse`/`format` pair.~~ **Shipped** as `utils/locale-number`
  (`formatLocaleNumber`/`parseLocaleNumber`/`makeLocaleNumberCodec`, standalone
  and exported) plus the control's own `locale` + `numberFormatOptions`
  inputs; `decimalSeparator` is superseded while `locale` is set. Grouping
  must look like grouping (`1.5` under `de` is a parse error, not fifteen),
  precision defaults to the widest so a display never rewrites the model.

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
   `reason`/`warning` tier (see below) — the UI renders _what the engine
   understood_, live.
3. **Metadata injection into the adapter.** `libphonenumber-js/core` exports
   metadata-free functions; the metadata is an argument. Our adapter is a
   factory:
   ```ts
   createLibphonenumberCodec(metadata); // consumer picks the payload
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
  _visibility_ with zero caret rewriting: the draft is never touched, the
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
  shows the _detected_ country (falling back to `defaultCountry`), updating
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
slash menu is a keyboard _insert_ gesture (great for fresh entry); changing
the country of an _existing_ number is a _transform_ and needs the
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
  `IS_POSSIBLE_LOCAL_ONLY`, …) surfaced as _warnings_, never commit
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

## Shipped — `angular-inline-date` & `angular-inline-duration` (sandbox prep)

Prepared for sandboxing the future `m-editable-date-v2` / duration
migrations. The surprise finding: neither needed a new approach — both are
**codec compositions over the text core**, exactly like number and phone.
"Fundamentally different" applied to the OLD widget-based implementations
(mat-datepicker/segmented inputs), not to this architecture. Same styling
for free (they render through the same panel/display chrome).

**`angular-inline-duration`** — the number control's sibling:

- Canonical value: **SECONDS** (`number | null`, matching the existing
  `m-editable-time-duration`); empty commits `null`.
- Codec: colon notation positional by `durationFormat`
  (`h:mm`/`h:mm:ss`/`mm:ss` — `'1:30'` means 1 h 30 min or 1 min 30 s
  accordingly), unit tokens (`'1h 30m'`, `'1.5h'`, `'90s'`), bare numbers
  (minutes under hour formats). Sexagesimal overflow (`1:75`) hits the
  parse gate.
- `step` input snaps commits (e.g. 60 = whole minutes, the old
  `intervalStep`); live preview reads the draft (`✓ 2 h 15 min`).

**`angular-inline-date`** — the phone pattern applied to calendars:

- Canonical value: **ISO `'yyyy-MM-dd'` (`| null`)** — the E.164 of dates:
  serializable, locale- and timezone-free. Luxon/Date live at consumer
  boundaries (the iusta date-v2 currently emits Luxon `DateTime` — the
  migration will convert at the wrapper).
- Typed drafts (`'24.12.'` auto-completes the year, `'12.5.26'`,
  ISO); impossible calendar dates (`31.2.`) hit the parse gate; the live
  preview reads the full date back (`✓ Thursday, December 24, 2026`).
- **Slash menu as the quick-pick**: `/today`, `/tomorrow`, `/yesterday` +
  the next seven weekdays — labels localized via `Intl.RelativeTimeFormat`
  / `DateTimeFormat` (zero bundled translations, the phone lesson), always
  matching the English names too. Picking inserts the ISO date; the preview
  interprets it.
- `now` is an injectable input (`() => Date`) so specs are deterministic.

Demo: `/temporal` page (Date & Duration) with locale/format toggles and the
typed event console. 93/93 sandbox tests.

**Also shipped: `angular-inline-time`** — typed drafts (`'930'`, `'9'`,
`'21:05'`), canonical `'HH:mm'`, `Intl`-localized display/preview, and the
**native OS time picker** behind a 🕐 suffix affix (visually-hidden
`<input type="time">` + `showPicker()` with a focus fallback; idle picks
commit immediately, in-session picks replace the draft).

**Upstream re-sync batch 2 (2026-07-10, suite at 210):** the range group
gained the **`rangeTimes` role** mirrored back from iusta — ONE ranged time
control carrying both endpoints (`<angular-inline-time [ranged]="true"
rangeTimes />`), replacing the two single `rangeStart`/`rangeEnd` leaves;
propagation stays per-endpoint (dispatches on `saved.side`; the pair's own
roll is idempotent under the group's — what `dayOverflow`/`explicitDay` are
carried for). Trio spec block ported. And the **time seconds story**: the
codec's optional `:ss` parse tail (meridiem-free — seconds and day-periods
stay apart) + a `format` input (`'HH:mm' | 'HH:mm:ss'`) — the seconds
format displays the RAW format string (24 h; its own display must parse
back), the default keeps the Intl-localized display; `composeDbEntry`
already composed seconds. Still open with iusta: the details-payload
`savedModelChange` convergence question.

**THE savedModelChange STANDARD (user decisions 2026-07-10, sandbox
reference implementation shipped same day — 210 lib + 2 app specs, both
builds clean, Luxon still lazy-chunk-only):** `savedModelChange` is the
consumer DNA — it emits THE MODEL as an OBJECT, accept-timed and
change-gated, on EVERY changed settlement (the sandbox cadence won:
half-open range states are real commits; iusta's only-when-complete
date cadence was a per-control accident, migrated at its next sweep).
Scalar controls emit `{ value: T }` (text `{value: string}`, number
`{value: number|null}`, phone `{value: E.164|null}`); temporal controls
emit the iusta details models VERBATIM — `TimeSavedDetails`
`{start, end, duration}` and `DateSavedDetails` `{start, end}` (Luxon,
sides nullable — widened for the cadence), `DurationSavedDetails`
(`.duration` + clock decomposition, empty IS zero) — types live beside
their codecs, derived in `#emitSavedModel()` per control. The value
channel stays plain strings (form-serializable); the event is the Luxon
rendering. **`saved` is the MACHINERY channel** — one emission per
settled session, changed or not, carrying commit intent
(`side`/`dayOverflow`/`explicitDay`); range groups and hosting adapters
bind it, app consumers bind `savedModelChange`. NEXT (iusta): the
consumer migration — ~98 scalar sites `$event` → `$event.value`
(compiler-guided), temporal `#emitLegacyDetails` unmarks into the shared
implementation, date-v2 adopts the every-changed-settlement cadence
(manual audit of the few ranged consumers — `updateAttribute(…, any)`
hides null-hazards from the compiler).

**THE HEADLESS GROUP SHIPPED (2026-07-10, suite at 214):**
`createTemporalRangeGroup()` — the range-group laws as a PLAIN FACTORY
(closures over signals; no directive, no OOP), living wherever the caller
puts it (typically ROW DATA). `DateTimeRangeGroup` is now a THIN SHELL:
it builds the core with its `value` model/zone/bound-ness and forwards
`onChanges` deltas to its outputs — the laws exist ONCE. The role
attributes went DUAL-MODE: bare = DI to the ancestor directive (exactly
as before, synchronous attach so the mixed-mode guard still throws);
BOUND = a headless group by reference (`[rangeDay]="row.group"`,
`[rangeTimes]="row.group"` …) — which makes `matColumnDef`'s DI scoping
irrelevant, THE mat-table case. Traps paid for: (1) leaf-state/day-offset
providers must NOT inject the role directive (control constructs → token
→ role → control = NG0200) — they read a per-element `RANGE_ROLE_CORE`
holder signal the role's wiring fills; (2) by-reference attach happens an
effect-flush AFTER the factory's first inbound push, so the inbound
effect depends on the attachment signals (late leaf receives the current
value) and the OUTBOUND mirror is gated on `anyAttached` (an empty
composed reading must not clobber a seeded value). Factory requires an
injection context (or `options.injector`). Playground: mat-table card
(3 shifts incl. overnight) with per-row headless groups — iusta's
time-entry-table constraint, live. 4 headless specs (per-row isolation,
end→duration, duration→end, day shift). NEXT: mirror to iusta, then its
table rows adopt row-data groups and `prepareTimeData`'s hand
propagation dissolves.

**The temporal program's upstream design record was ROADMAP-DATETIME.md
(retired — recover via `git show 8063fb6:ROADMAP-DATETIME.md`); the LIVE
absorption log is iusta's `EDITABLES-ABSORPTION-ROADMAP.md`. That record
covered:**
calendar overlay picker on `@angular/aria` Grid + `DateAdapter` (required),
mat-form-field hosting for all three controls (via iusta's
`MatFormFieldAdapterContract` pattern), the two-field date range with
drag/Ctrl+click gestures and the linked `DateTimeRangeGroup`
(day/start/end/duration speaking to each other), and datetime+timezones.

### THE PHANTOM-SCROLL TRAP (fixed + guarded 2026-07-10)

A visually-hidden `position: absolute` element with NO offsets keeps its
STATIC position and contributes scrollable overflow to its CONTAINING
BLOCK — which can resolve far up the tree (nothing in a table cell is
positioned). Hundreds of rows of the temporal controls' 1px aria-live
`__sr` spans inflated a host app's scroller by thousands of px. Every
visually-hidden absolute box now carries `top: 0; left: 0` (documented in
each scss rule), and each temporal control's spec GUARDS it via
`getComputedStyle(sr).top === '0px'` — the guard verifiably fails without
the fix. Apply the same pin to any future visually-hidden element.

### Manual QA — Safari / iOS pass

The `plaintext-only` probe falls back to `contenteditable="true"` + manual
paste sanitization on WebKit builds that misreport support. Needs a hands-on
pass on iOS Safari: paste interception, IME composition elevate, caret
replay, and the Selection-based paste fallback.

## Shipped — the clear seam (`editableClear`) — 2026-08-26

**The ask (iusta core).** Two things, in one breath: _inject a custom clear
button into every inline variant_, and _open a mat dialog when it is
clicked_. The library had the first half only as styling
(`[editableClear]`, the bare behavior directive) with no way to get the
button INTO a control, and nothing at all for the second: every control
hard-coded `<button editableClearButton>` inside its own `<bubble-menu>`,
and `clearValue`/`clearBubble` were `protected` and committed
synchronously.

**Why one seam answers both.** Clearing is a COMMIT, not a request: it
writes the empty value, marks the field touched and emits `saved` in one
synchronous go. A consumer cannot intercept a commit that already happened,
so "confirm, then clear" through an output + veto would mean
clear → persist → undo — a real backend write for a cancelled gesture. The
control hands the commit over instead: the template context carries the
clear CALLBACK, and the consumer calls it when their dialog resolves. No
two-way protocol, no cancelable-event contract, no premature `saved`.

**The shape** — the established slot idiom (`prefixTemplate` /
`suffixTemplate` / `hintTemplate` / `menuTemplate`), dual-channel:

```html
<angular-inline-text [(value)]="notes">
  <ng-template editableClear let-clear let-label="label">
    <button editableClear [attr.aria-label]="label" (clear)="confirm(clear)">✕</button>
  </ng-template>
</angular-inline-text>
```

- `clearTemplate` INPUT + `ng-template[editableClear]` content, on
  `angular-inline-text`, `-number`, `-phone`, `-json`, `-date`, `-time`,
  `-duration`. The wrappers (number, phone) re-declare the slot and forward
  a `TemplateRef` — content queries don't pierce re-projection.
- Context `EditableClearContext`:
  `{ $implicit: clear, clear, side, label, focus }`. `side` is
  `'start' | 'end'` on a range pair (the range controls stamp the template
  once per side, each callback side-bound) and `null` on a single-value
  field. `label` is the stock accessible name — the SAME string the default
  button speaks, so the two can never drift. `focus` puts the keyboard back
  on the field (the cleared SIDE, on a range pair) without the consumer
  holding a reference to the control — which is what lets ONE button
  component serve a whole page of mixed fields.
- The control keeps everything it already owned: when the bubble may show
  (not required/disabled/readonly/empty, not editing), where it anchors,
  which side it grows from, and what clearing does.

**Mat stays out.** The dialog is the consumer's — `MatDialog`, the house
`EditableDialog`, a `confirm()`, anything. Same containment as
`temporal-mat`: nothing mat-shaped entered the library.

**Traps the seam documents** (all in `EditableClearTemplate`'s TSDoc):

- Clear is an IDLE-only affordance — the bubble is hidden while editing —
  so opening a modal never disturbs a live session, and the callback stays
  valid however long the dialog takes.
- The bubble is a HOVER overlay: by the time a dialog closes, the pointer
  has left and the consumer's button is gone with it, so a modal's
  restore-focus has nowhere to land. Call the context's `focus()` when the
  dialog settles — on cancel as well as on clear. With MatDialog, also pass
  `restoreFocus: false`: mat's own restoration runs AFTER `afterClosed`, so
  left on it it simply undoes the `focus()` and drops the keyboard on the
  body (verified in the browser).
- `required` hides the bubble entirely (a guaranteed-doomed clear stays
  unavailable) — a confirm-on-clear flow never appears on a required field.
  Unchanged by this work; a decision if core ever wants one there.

**Localized labels, incidentally.** `TemporalIntl.clearLabel(side)` grew an
optional `noun` (defaulted to the date noun for existing callers) and a
`durationLabel` signal, so time and duration stopped hard-coding English
clear labels in their templates and a consumer's own button gets a
localized name from the context for free. Same English output as before.

**Demo — one button, sixteen fields.** `/patterns/form-grid` is the proof:
a single `ConfirmClearButton` (mat icon button in `--mat-sys-error` — the M3
equivalent of the library's own error color — opening a MatDialog) bound
through ONE `<ng-template #confirmClear>` that every control in the grid
passes as `[clearTemplate]`. Text, number, phone, date, time, duration and
JSON all stamp the same button; the ranged date and time stamp it once per
side and it labels itself from the context ("Clear end date"). Nothing in it
knows which field it is clearing. Browser-verified end to end: cancel keeps
the value and returns focus; confirm clears one side of a range
(`{start, end: null}`) and returns focus to THAT side.

**Tests** (+13, suite 384 → 397): the stock button still renders and clears;
the template takes the slot over entirely; the consumer's click alone
changes NOTHING (value, touched, `saved` all untouched — the point of the
seam); the captured callback still clears after the bubble is torn down
(the dialog case); per-side stamping with side-bound callbacks and per-side
labels (date, time); `side: null` on single fields; and forwarding through
the wrappers, where the confirmed clear settles as the wrapper's own empty
(`null`, never the inner control's `''`) — number, phone, json, duration;
plus focus restoration, including back to the cleared side of a range.

**iusta mirror (absorption model — copy-paste, rename, then edit).**
`editable-inline/bubble-menu/editable-clear.ts` first (it carries the
context type and the directive), then the seven call-sites:
`editable-inline`, `editable-number-v2`, `editable-telephone-number`,
`editable-date-v2`, `editable-time`, `editable-time-duration`, and the JSON
control if/when it lands. Watch for iusta's own `TemporalIntl` copy — the
`clearLabel` signature moved.

## Shipped — the interactive unit + the hover scope — 2026-09-16

**The ask.** The clear bubble was hard to reach: it armed on `mouseenter`
of the field's own box, and that box was the value's INK — "AUR-01" is a
target one line tall and six characters wide, under the accessibility
minimum for target size before any UX argument. The first idea was a
configurable hover padding; the settled design is bigger and simpler.

**The practice it follows.** Gmail rows, Drive, Slack messages, Notion
property rows, Linear lists, Figma's properties panel: the CONTAINER is the
interactive unit, and its hover is PAINTED — YouTube's `yt-touch-feedback-
shape` (a sibling layer behind the card with a negative margin), M3's state
layer (a pseudo-element on a button). Nobody detects hover on the action's
anchor and enlarges it. The nearest precedent of all is a native input: its
box is the hit area, hovering it lights it up, a press in its padding lands
the caret on the nearest character, focus wraps the box. Moving editing
onto the ink of a contenteditable had quietly lost all of that.

**Round 1 (superseded the same day):** padding + negative margin as the
halo, the tint as the field's own background. It worked and it looked like
a disabled text input — grey box, dashed underline inside it, the clear
button floating outside it. The lesson: the surface must be a layer BEHIND
the content, larger than it, and it must cover the actions too.

**What shipped — the field level, on `.editable-text__field`:**

- **The shape.** A `::after` pseudo-element behind the content (`z-index:
-1` inside the field's own `isolation: isolate`), reaching past the box by
  `--editable-text-shape-inset` (0.375rem), `--editable-text-shape-radius`
  corners, `--editable-text-shape-color` tint (on-surface at 5%), faded and
  settled in on hover and while the display is `:focus-visible`
  (contenteditable counts as keyboard-focusable, so a press keeps it up as
  long as the field holds focus — the unit wraps the focus; the solid
  underline stays the a11y signal). HIT-TESTABLE AS PART OF THE ELEMENT: the
  shape IS the halo, the field's box never changes, no padding, no margin
  tricks. It covers the INLINE only — a first cut reached under the bubble
  so text and actions read as one surface, and the user cut it: the bubble
  is its own unit with its own transparent hover pad (the bridge), so the
  two hit areas MEET and never overlap; in the grid the row's shape simply
  happens to contain the bubble. Rests while editing (the panel is the
  surface).
- **Two paint modes, one behaviour.** An absolutely positioned pseudo inside
  an inline box that WRAPS gets a nonsense containing block (first
  fragment's start → last fragment's end). So no-wrap fields (the default
  single-line: grid cells, tables, titles) become an `inline-flex` unit — a
  real box, baseline-aligned like the panel line, the display shrinks first
  (`min-width: 0` → its own ellipsis), affixes never — and wrapping fields
  (prose, multi-line) keep the box inline and paint the same tint as cloned
  per-line padding cancelled by margin (layout-free: vertical padding on an
  inline box never enters the line box).
- **Press**: `handleFieldMouseDown` — a press in the unit OUTSIDE the text
  (shape, unit suffix, the space past a short value) focuses the display
  with the caret on the nearest character of the nearest line via
  `caretOffsetNearPoint` (clamp the point INTO the nearest line box, ask
  `caretPositionFromPoint`/`caretRangeFromPoint`, fall back to the nearest
  edge without layout). Presses ON the text keep native placement; chrome
  inside the unit (the phone flag button) keeps its own handling;
  shift-presses extend natively; locked fields and open sessions are left
  alone. FOCUS ONLY — the session still opens on the first keystroke, so
  selecting text to copy it never throws a panel up.

**What shipped — the container level, `editableHoverScope`
(`utils/editable-hover-scope/`):**

- **The row owns the box — it never reports it.** Handing a rect to the
  field would mean measuring, a ResizeObserver, scroll invalidation, and a
  field shape sitting OVER the label that eats its clicks. The scope's shape
  is the scope's own `::after` (`--editable-hover-scope-inset` 0.5rem,
  medium radius, same tint), behind its content, hit-testable — the reach
  into the gap between rows counts as the row. `.editable-hover-scope--active`
  while HOVERED ONLY (the first cut painted on focus-within too, and the
  core pilot showed the cost at once: click into one row, move to the next
  — two painted rows, their shapes stacking to a darker band in the shared
  gap; a focused row keeps the field's solid underline as its signal —
  Notion paints the hovered property row, never the focused one);
  focus-within still ARMS the actions through the field's own listeners.
  Table rows paint through the class (tr pseudo-elements are unreliable
  across engines).
- **The field finds the scope by DOM and listens itself.** `closest()` for
  the marker after first render — NEVER injection: a cell inside a mat-table
  column definition cannot inject its row's directive, the mat-table trap
  paid for in iusta — then the control binds the scope element's
  mouseenter/mouseleave/focusin/focusout the way the bubble binds the field.
  The scope's hover arms the bubble through the bubble's new `armed` input,
  grace-timed on the same open/close machine so the pointer can leave the
  scope onto the bubble (outside the scope's DOM) without a flicker. Host
  class `editable-text--scoped`: the field's own shape rests inside a scope
  (`--editable-text-shape-in-scope: 1` keeps it as the inner, Figma-style
  level). A scope holding several fields arms ALL of them — if that is loud,
  the scope is the cell, not the row.
- **`pressToFocus`, default ON.** A press on the scope's own SPACE (not the
  field, not chrome, not TEXT) hands its point to the ONE field inside over
  a DOM CustomEvent (`editableScopePress`) and the field lands the caret
  nearest — so the row's shape is also the row's press target and the next
  keystroke elevates (the Airtable cell feel). The first cut shipped it OFF
  to protect labels (a press on a label is a rename gesture in users' heads
  — Notion) and the user hit the gap immediately: a press in the empty
  value space at the row's end focused nothing, and a double-click there
  selected the next row's label. The rule that reconciles both: an element
  that carries its own text keeps its press and its selection; only SPACE
  forwards. Only when the scope holds exactly one field;
  `[pressToFocus]="false"` opts out.
- **The grid fixture:** every `.field-grid__row` carries the marker. The rows
  were `display: contents` — a boxless row can neither be hovered across the
  column gap nor painted — so they became SUBGRID rows (label track alignment
  kept, a real box gained).

Number, phone and JSON render through the same surfaces and inherit the
field level. Specs: 4 helper + 5 unit + 8 scope.

**The temporal family (same day).** The input-hosted controls got the unit
too — the user's first question after the grid: "click on the halo area is
not yet doing what inline does" for date. Their `inline-flex` wrapper
(`.inline-date` / `.inline-time` / `.inline-duration`) is the unit: the
`unit` mixin in `temporal/src/_inline-unit.scss` is the text control's
shape on that wrapper (same tokens, same `::after`, `&--scoped` rests it
inside a scope — `:is()` lifts the scoped rule to the focus rule's
specificity so it wins both), and `inline-unit.ts` holds the press half:
`isUnitSpacePress` (plain left press, not on an input, not on chrome) +
`focusInputNearPoint` (the NEAREST enabled input by box distance, caret at
the nearest edge or proportional inside — inputs have no caret hit-testing
API, digits are near-monospace; `setSelectionRange` guarded for
`type="time"`). Focus then does what focus already does in this family:
the session opens, the date calendar shows. Every unit wrapper wears the
shared `editable-unit` class (the text field too) — the scope directive
counts and forwards presses to `.editable-unit`, not to a per-family
selector — and the three controls watch the scope through the new shared
`observeHoverScope` (`utils/editable-hover-scope`; the text control uses it
too now), arming all their bubbles through `armed`. TRAP, found by the user on
first touch ("the picker flashes open then immediately close"): a press
on the row's space is forwarded, the panel opens on focus DURING the
mousedown, and the CLICK that completes the press lands on the row —
outside the overlay's ORIGIN — so CDK's `overlayOutsideClick` dismissed
it. Invisible to a scripted click (pointerdown→click in one task, before
CD attached the overlay); reproduced with a 120ms-spaced synthetic
sequence. Fix: the three controls' `handleOutsideClick` is SCOPE-AWARE —
a click inside the hover scope never dismisses (the row is the unit: a
click on it is a click on us); another row or anywhere else still does.
Specs: 6 helper + 6 date + 1 time + 1 duration.

**Next (the actions program):** the `primary-actions` slot beside clear with
PER-SLOT visibility gates (`canShow` is a CLEAR rule — a required or readonly
link field still wants its open button); then the link control drops its
open anchor into that slot; temporal bubbles onto the scope.

## Next up — `angular-inline-link` (design settled 2026-09-16, not started)

**Baseline in the grid:** the "Website" row — a URL in a plain
`angular-inline-text` with `inputMode="url"`, the way every website field
ships today. Nothing detects it, nothing opens it, copy-paste is the only
road to the page. The link control replaces that row.

**The precedent, and the one rule it agrees on.** Notion (URL property:
click edits, ↗ opens), Airtable (click selects, open icon on hover /
selection), Google Docs/Sheets (click → bubble with the URL + open + copy,
Cmd/Ctrl+click opens), editors (Cmd/Ctrl+click follows, tooltip says so):
**in an editable field a plain click never navigates.** Jira's real-anchor
idle field is the outlier — users edit and navigate by accident. Our idle
click already places a caret without opening a session, so the rule costs
nothing.

**Shape — a typed control, not text with detection.** Composed over
`angular-inline-text` like number and phone; owns a codec and nothing else:

- Parse: trim; a bare domain gets `https://`; anything that does not parse
  as a URL or uses a scheme outside the allowlist (http, https, mailto,
  tel) is a `url` error. THE SECURITY LINE: an `href` exists only when the
  parser produced it — never `javascript:`, never the raw value.
- Display: the prettified rendering (scheme and `www.` stripped,
  ellipsized); the editor opens on the raw URL via `draftText` — the
  locale-number seam, reused.
- A public `href` signal for whoever renders the affordance.

**The open affordance is a SEAM, not a button** (the `editableClear`
lesson: ask two will be "internal links go through the router", ask three
"confirm before leaving"): a template slot with a stock default rendered
OUTSIDE the contenteditable (suffix / bubble position). The stock default
is a REAL anchor (`target=_blank rel="noopener noreferrer"`), not a button
calling `window.open` — middle-click, copy-link, drag, status-bar URL, no
popup blocker. Visible whenever the value is a valid link, muted at rest
and strong on hover (hover-only affordances do not exist on touch); in
the tab order right after the field (the Tab scope already handles it).

**Power gesture:** Cmd/Ctrl+click on the idle display opens the same
`href`; the panel hint (the phone's "what the engine understood" slot)
says so and previews "will open https://…" per keystroke.

**Email and phone get it for free:** `mailto:` and `tel:` are codecs
producing an `href`; phone already has E.164.

**Deliberately NOT: linkify inside free text.** Anchors inside the
contenteditable display cross the ProseMirror line (characters only;
adornments outside) — caret math, replay and filtering assume one flat
text node. Airtable made the same call (only the URL field links). A
read-only rendered overlay would be a separate conversation.

**Shipped ahead (2026-09-16): `utils/link-detection` — `detectLink(value)`.**
Absolute http(s) URLs as they are; BARE DOMAINS (`reddit.com`, user ask)
given `https://`, guarded by a TLD check (two letters, or a generic-TLD
list) so `file.pdf` / `index.html` stay text; whitespace and `@` are out.
The grid's Website row and iusta's text-v2 stock action both use it; the
link control's codec starts from it.

**Build order:** codec + specs → control with `draftText` → the open seam
→ Cmd/Ctrl+click + hint → core `m-editable-link` (house anchor styling;
first consumers: the two settings pages hand-writing `mailto:`).

### The clear opt-out (`showClear`) — 2026-09-16

**The ask (iusta core).** The custom-field house rule: emptying a value is
a DELIBERATE act — open the editor, delete, save — never a one-click
hover shortcut. So every control with a clear bubble (text, number, phone,
JSON, date, time, duration) gained `showClear = input(true)`: `false`
never offers the bubble, stock button or `clearTemplate` alike; the
bubble's own policy (never on required / disabled / readonly / empty /
editing) still applies on top of `true`. Number and phone forward it to
the inner text control; date and time hand it to
`makeClearBubbleVisibility` as its new optional `enabled` term (declared
ABOVE that field — TS2729 otherwise), duration folds it into its own
`clearCanShow`. The grid playground has a "Clear: on/off" toggle wired to
all 22 editables. Docs: `SHOW_CLEAR_INPUT` beside `clearTemplate` on every
variant. Specs: text (bubble gone, template or not; back on re-enable) +
date (neither side).

### The primary-actions slot (`editableActions`) — 2026-09-16

**The ask (iusta core).** Buttons that act ON the value — open the link,
call the number through the house's own dialer, and "they can have many".
So the bubble grew a second SLOT beside clear, and the split is what makes
it work: clear is a destructive house-rule affordance (`showClear`);
actions are value-typed and consumer-owned.

- **The control renders nothing.** `ng-template[editableActions]` content
  (or the `actionsTemplate` input for composition) is stamped BEFORE clear,
  in its own `.editable-bubble__group` (no separator — user decision: the
  order carries the meaning), with an
  `EditableActionsContext<T>` — `{ $implicit: data, data, side, focus }`.
  The DATA is typed per control: text `{ value }`; number
  `InlineNumberActions { value }`; phone `InlinePhoneActions { value, e164,
tel, country, national, international }` (a ready `tel:` href, or the
  number for a dialer service); date `InlineDateActions { value: IsoDate,
side }` and time `{ value: DbDateTime, side }` — one stamp per side, each
  with its own day/instant; duration `{ value }`. Wrappers (number, phone)
  forward the template plus their payload through the text control's
  `actionsData` input.
- **Gates are per slot.** Clear keeps its policy plus `showClear`. Actions
  show whenever a template exists and the value is non-empty and not
  mid-edit — and IGNORE required / disabled / readonly on purpose: a
  readonly phone still calls, a required link still opens. The bubble
  shows when either slot has something. Temporal: `makeClearBubbleVisibility`
  reused with `ACTIONS_GUARDS` (constant-false house guards);
  `makeActionsContexts` mirrors `makeClearContexts`.
- **`editableAction` directive** on each consumer button: the mousedown
  guard (focus never leaves the field, a hover scope's press forwarding
  never fires); clicks and anchor navigation untouched.
- **No stock default** for text/number/phone/temporal — without a template
  there is nothing sensible to offer. The link control (next) is the one
  exception: it ships a stock real anchor.
- **Grid:** Website (open_in_new, href from the raw text until the link
  control), Email (`mailto:`), Telephone (`tel:` from `data.tel`) — three
  `mat-icon-button` anchors, `.field-grid__action` sized to the pill row.
  Docs: `ACTIONS_TEMPLATE_INPUT` on every variant. Specs: 5 text (payload +
  order, readonly keeps actions, showClear false keeps actions, empty offers
  nothing, press keeps focus) + 1 date (per side, readonly).
- **THE FLASH TRAP (user-found, first hover of a real mouse on a grid
  button):** the bubble had ONE hover flag with ONE grace timer, shared by
  the origin, the bubble itself and the scope's `armed`. A real pointer
  leaving the row onto the bubble fires the bubble's mouseenter FIRST
  (synchronous → open), then change detection runs the `armed` effect,
  which scheduled a close on the same flag → 150ms later the bubble
  vanished under the pointer, the row beneath re-armed it, the next pixel
  replayed it — a constant flash. Invisible to the tool's synthetic hover
  (no boundary events fire). Fix: THREE INDEPENDENT hover terms
  (`hoverTerm()` — origin, self, scope), each with its own grace timer; a
  leave only ever clears its own. Two bubble specs pin the exact sequence.
- **The focus hold (same day).** A fourth bubble term: the origin HOLDING
  FOCUS keeps the bubble up — a field with the caret in it shows its
  actions with no pointer at all. Why: touch has no hover (the tap that
  placed the caret is what reveals the call button), and Tab lands on
  visible actions for keyboard users. Released when focus leaves the
  origin for anywhere but the bubble itself (a `viewChild` on the bubble
  element — a template ref can't reach out of the overlay's embedded
  view); no grace, focus is discrete. Editing still hides everything (the
  panel is the surface), so temporal fields — whose focus opens the
  session — show nothing on focus alone. Expect: after a save the text
  control refocuses the display, so the bubble appears right after a
  commit. Spec pins hold, keep-on-move-into-bubble, release.
- **Open:** keyboard reach into the bubble (an "actions" key on the focused
  field) — already true for clear, matters more now; JSON has no actions
  slot yet. Also: the actions gate is "template PRESENT", not "template
  RENDERED something" — a consumer template whose `@if` yields nothing
  still opens the bubble (an empty group beside clear, or an empty bubble
  when clear is off). Core's custom-field hands the template over only
  when it has something to show (`linkOf(value) ? openLink : undefined`);
  the grid's Website row leans on clear being there. A library-side gate
  (an empty embedded view counts as absent) would remove the rule.

### The pushed-panel trap (date) — 2026-09-17

**Found by the user in iusta's isolate popup (1000×600):** the calendar
flashed open-and-shut on every click, fixed by making the window a few
pixels taller. The panel opens on the PRESS; in a short viewport it fits
neither below nor above the field, so CDK's `push` slides it into the
viewport OVER the field. Not focus (the trace showed no focusout, window
focused, session still open, only `overlayOpen` flipping ~60ms after
pointerdown), not the popup (a same-size tab reproduces it).

THE MECHANISM: the press RELEASES on the pushed panel, and the browser
targets the completing CLICK at the common ancestor of press-down (the
input) and release (the pane) — the body — which CDK reports as an OUTSIDE
click; `handleOutsideClick` closed on it. THE FIX, reduced to the minimum
at the user's request (a first cut also made the panel `pointer-events:
none` during the press — unnecessary, the retargeted click never reaches
the chip under the release): the opening press (`handleInputPointerdown`
/ the unit press / the scope press) arms a one-shot `#openingClickPending`
latch that `handleOutsideClick` consumes; the next click (bubble phase,
after CDK's capture dispatch) or the next press clears it. Keyboard opens
arm nothing. Two specs. Mirrored to core's date-v2; user-confirmed in the
popup.

**The CDK approach is the house select's (user decision, same day):**
`editable-select-v2` is the best-tested overlay in iusta and it CLOSES on
scroll — CDK `close()`, which hears every scroll container through the
capture-phase dispatcher. A first cut used `block()` (pins the document
only — pinned nothing in the main shell, "the scroll owner is wrong"),
then a scroll-owner-finding block strategy; both dropped for the simpler,
consistent behaviour: `close()` + `disableClose` (this control owns its
open state; CDK's own Escape/backdrop detach stays out) +
`disposeOnNavigation` + `(detach)` → `overlayOpen.set(false)` so a
CDK-initiated detach is mirrored. Deliberate difference: no `usePopover:
'inline'` (it inserts the popup INSIDE the origin subtree — the select's
combobox primitive needs that, the calendar's hover-scope containment
would not survive it). One spec.
Follow-up: the OVERLAP itself (flexible dimensions + a max-height so the
panel fits instead of covering the field).

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

- A `field.reset('new value')` issued _while a session is open_ loses the
  reset value: the control's draft rollback runs after the field's value
  write and restores the session baseline. Intentional — an open session's
  draft protection wins; reset a closed field to apply a value.
- Rolling the draft back during a mid-session `reset()` re-marks the field
  dirty (the rollback flows through `controlValue.set`). Cosmetic; revisit if
  it ever matters.
