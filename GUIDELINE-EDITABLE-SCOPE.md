# Editable scope — Tab-to-accept & autocomplete (consumer guideline)

How to opt a group of inline fields into **Tab settles the session and moves
on** — and where the same scope takes LLM/autocomplete suggestion acceptance
next. Written for consumers of the library, in particular the iusta-core
custom-field surfaces (group, table, accordion).

Demo: `/patterns/form-grid` in the playground app — the grid is a live scope
with `Tab commits` and `Advance` toggles.

---

## 1. The one-liner

```html
<div editableScope>
  <angular-inline-text [formField]="form.project" … />
  <angular-inline-number [formField]="form.budget" … />
  <angular-inline-phone [formField]="form.telephone" [codec]="codec" … />
  <angular-inline-date [formField]="form.deadline" … />
</div>
```

That is the whole opt-in. Without an ancestor `editableScope`, nothing
changes anywhere: the elevated panel stays a `cdkTrapFocus` and Tab cycles
editor → Discard → Save, exactly as before. The directive is pull-based DI
(`EDITABLE_SCOPE` token, the temporal leaf-state pattern) — a standalone
control injects `null` and never knows scopes exist.

Import: `EditableScope` from the core entry point
(`angular-inline-select`).

## 2. What Tab means inside a scope

The scope ports the **house temporal session tiers** (already native to
date/time/duration — real inputs commit on Tab/blur) to the elevated-panel
family (text, number, phone):

| Gesture | Meaning |
| --- | --- |
| **Enter** / Ctrl+Enter / Save | Explicit commit — an invalid draft BLOCKS and reveals errors. Unchanged. |
| **Escape** / Discard / scrim | Explicit revert to the session baseline. Unchanged. |
| **Tab / Shift+Tab** (new) | NAVIGATION: settle the session, then advance to the next/previous field. |

"Settle" on Tab:

- Clean or unchanged draft → commits (`saved` fires once, as always).
- Invalid draft → the scope's `onBlocked` policy decides:
  - **`'revert'` (default)** — the temporal rule: snap back to the baseline,
    advance anyway. Never traps, never persists a draft error.
  - **`'stay'`** — mat submit semantics: reveal the errors, refuse the Tab.
    For scopes where losing a typed draft is worse than interrupting.
    Honored by the temporal family too (their parse gate refuses the Tab).
- Open slash menu → the first Tab only closes the menu (mirrors two-stage
  Escape); the next Tab settles.
- Tab off the scope's LAST field (no wrap): a text field settles and parks
  on its display (the panel lives in the overlay, so native fall-through
  has nowhere sane to go — the next Tab leaves natively); a temporal field
  lets the native Tab proceed directly (blur settles, focus leaves the
  region). Never a trap in either family.

`onBlocked: 'stay'` governs the TAB GESTURE only — by nature. Blur cannot
be refused (you cannot veto a click elsewhere), so click-away keeps the
family's native behavior everywhere: scrim-discard in the panel family,
snap-back in the temporal family.

## 3. Configuration

All inputs sit on the directive, all optional:

```html
<div
  editableScope
  [tabCommits]="true"      <!-- the lever; false restores the focus trap -->
  onBlocked="revert"       <!-- 'revert' (default) | 'stay' -->
  advanceMode="edit"       <!-- 'edit' (default) | 'focus' -->
  [wrap]="false"           <!-- Tab off the last field: park (default) or wrap -->

  <!-- assistive-tech strings (see §7) — English defaults, localize via i18n -->
  [tabHint]="'…' | translate"
  [savedAnnouncement]="'…' | translate"
  [revertedAnnouncement]="'…' | translate"
  [blockedAnnouncement]="'…' | translate"
>
```

- **`advanceMode: 'edit'` (default)** lands AND opens the session (caret at
  the end) — settle-and-keep-typing, no second gesture between fields. This
  matches the temporal family (whose panels already open on focus) and is
  the only way the JSON dialog can chain (see §4). Skimming still works:
  an untouched session settles as a silent non-event on the next Tab.
- **`advanceMode: 'focus'`** lands on the next field's display only. Editing
  starts on the next mutation ("only a mutation elevates" holds) — for
  text-family fields typing still works IMMEDIATELY (the display elevates on
  the first keystroke), so this is not "one extra press"; it is one less
  open panel. Visually quieter; preferred where screen-reader users are
  primary (§7).
- **`wrap: false`** — the scope is a region, not a modal: falling off the far
  edge parks focus on the settled field and the next native Tab continues
  into the page.

## 4. What participates in the walk

The advance is a DOM-order walk over the scope host's tabbables:

- **Registered fields** (text, and everything composed on it: number, phone)
  collapse to ONE stop each — chrome inside the field (a phone flag trigger,
  affix buttons) is skipped, focus lands on the display.
- **Temporal controls** commit on Tab natively (their design) and, inside a
  scope, hand their EDGE Tab to the scope's walk: the internal start↔end
  move of a ranged field stays native (two stops), but Tab out of the
  control lands on the scope's next stop and opens its session — so a
  date → JSON or duration → text chain flows exactly like text → text.
- **Other unregistered tabbables** (plain buttons/links inside the scope)
  participate as themselves.
- **JSON** registers with the scope, but only for the ADVANCE half: it is
  the one field where "just type" cannot start the session, so a Tab-advance
  landing on its preview opens the CodeMirror dialog directly (under
  `advanceMode: 'edit'`) — no Enter, no click. Tab INSIDE the dialog stays
  a text gesture: a modal is a deliberate stop, so leaving it is Save /
  Escape, not Tab.
- **Panel chrome** (Save/Discard, the clear bubble) renders in the CDK
  overlay container outside the scope host and is excluded by construction.
- **Popup-trigger chrome is click-only by default** — the phone flag and the
  date 📅 calendar trigger ship `tabindex="-1"` (the ARIA combobox
  convention for auxiliary popup buttons), scoped or not: Tab lands in the
  FIELD, one press per field. The keyboard paths to the same functions are
  first-class: the phone country changes via the slash menu (`/de`,
  searchable, caret never leaves) and the calendar opens on the input's own
  focus with ArrowDown entering the grid. Both triggers stay tappable and
  click-focusable — and the flag's `tabindex` is gated on
  `showCountryMenu`: with the slash menu disabled the trigger IS the
  keyboard path and rejoins the tab order.
- Disabled/readonly fields render `contenteditable="false"` and drop out of
  the walk automatically; `hidden` (and any `display: none` /
  `visibility: hidden` ancestor) fields are excluded by a style-based
  visibility gate — a conditional custom field never steals an advance or
  opens an invisible session.
- The walk is O(interactive elements) per keypress: candidates come from a
  focusable-elements selector (not `*`) and registered hosts resolve via a
  marker attribute + `closest` — sized for a large custom-field table.

## 5. Recipe: iusta-core custom-field surfaces

No core changes shipped yet — this is tomorrow's integration path.

1. **Absorb** `src/lib/utils/editable-scope/editable-scope.ts` into
   `content/partials/common/editables/editable-inline/` (or
   `core/editables/`), house-renamed per the absorption model
   (`EditableScope` → `MEditableScope`, selector `[mEditableScope]` if the
   prefix rule demands; BEM/comments as-shipped). Engine hookups to carry
   over: the `handleTabKey` block + two template bindings in
   `editable-inline` (~60 lines), the registration block in the JSON
   control, and the `case 'Tab'` edge handler in each absorbed temporal
   control (`m-editable-date-v2` / `-time` / `-time-duration`, ~15 lines
   each — identical shape, see upstream `handleInputKeydown`).
2. **Opt in per surface**, not globally:
   - `custom-field-table.html` — the directive goes on the `@for` container
     (the row markup already carries an unused `#tabElement` ref from an
     earlier attempt at exactly this; it can be dropped). Every
     `m-custom-field` inside inherits through DI — zero per-field wiring.
   - `custom-field-accordion` / group details — same: directive on the body
     container.
3. **Policy suggestion**: start with the defaults (`revert`, `edit`,
   no wrap) — `revert` matches the house temporal rule the users already
   have in the date/time cells, and `edit` keeps the chain gesture-free
   (type → Tab → type) across every field type, JSON included.
4. The v1 editables (non-absorbed `editable-text`, `editable-select`, …)
   don't register and don't drive the walk; they stay plain DOM stops. They
   pick up settle-on-Tab and edge-Tab semantics only when absorbed onto the
   inline engine.

## 6. Phase 2 — autocomplete / LLM suggestion acceptance

Not implemented yet; this is the contract the scope was shaped for. A
suggestion is **a draft the user didn't type** — exactly what the control
already models (the draft IS the `value` channel, `previous()` is the
baseline), so acceptance is a commit, not a new state machine.

Planned control-side contract (text engine first, composed controls free):

```ts
/** Ghost text offered beside the value — NEVER written into the draft. */
suggestion = input<string | undefined>(undefined);
/** The user took the suggestion (Tab first stage / click). */
suggestionAccepted = output<string>();
```

Rules that will hold, so plan consumers around them:

- **Ghost text is an adornment, not content**: rendered after the display
  (idle) and beside the caret (panel), styled via a
  `--editable-text-suggestion-color` token, `aria-hidden` with the offer
  announced via the panel hint. It never enters the contenteditable — the
  ProseMirror guardrail (no transforms under the caret) stays intact.
- **Tab becomes two-stage inside a scope**, mirroring the menu's two-stage
  Escape: pending suggestion → first Tab accepts it into the draft (emits
  `suggestionAccepted`, does NOT commit); no suggestion → Tab settles and
  advances as in §2. Escape first clears the suggestion, then reverts.
- **Accepting ≠ committing.** The accepted text lands in the draft; the user
  still settles the session (next Tab, Enter, Save). An LLM value therefore
  never reaches the model without a human gesture — audit-friendly by
  construction.
- Core wiring sketch: the extraction pipeline (the
  `preview-document-inbox-task` suggestion plumbing, `isAIExtractedData`)
  feeds per-field `suggestion` inputs; `suggestionAccepted` + `saved` give
  accept/override telemetry per field.

## 7. Accessibility

The baseline claim first: Tab-commit is CLOSER to native semantics than the
trap — every native `<input>` keeps its value when you Tab out of it; the
trapped panel was the exotic behavior. What a custom Tab genuinely breaks is
FEEDBACK, and the scope ships three mitigations for that:

- **Settle announcements** (CDK `LiveAnnouncer`). Every Tab-settle that does
  something is spoken: a changed commit announces politely ("Saved"), a
  snap-back announces assertively ("Not saved — previous value restored" —
  discarded data must not wait behind whatever the reader is mid-way
  through), a refused `'stay'` settle announces assertively ("Not saved —
  the value has errors"). An unchanged settle is a non-event and stays
  quiet. This is the WCAG 4.1.3 (Status Messages) half — without it the
  `'revert'` policy silently throws typed data away for a non-sighted user.
- **The Tab instruction** is discoverable: while the scope is live, a
  visually-hidden line ("Tab saves and moves to the next field, Shift+Tab
  to the previous one.") is woven into the panel's existing
  `aria-describedby` — announced when the editor gains focus, invisible to
  sighted users (who learn the same thing by the panel simply closing).
- **All strings are inputs on the scope** — `tabHint`, `savedAnnouncement`,
  `revertedAnnouncement`, `blockedAnnouncement` — so core wires them through
  the house `translate` pipe values; an empty string mutes that channel.

Judgement calls that remain with the consumer:

- `onBlocked: 'revert'` discards data on a navigation gesture. The
  announcement makes it perceivable, not harmless — for scopes holding
  long-form or hard-to-reconstruct values, prefer `'stay'` (WCAG 3.3.4
  error-prevention territory), or keep `'revert'` only where fields are
  short re-typeable facts (the custom-field case).
- `advanceMode: 'edit'` (the default) opens a panel as a consequence of
  focus landing — a context change on focus (WCAG 3.2.1 adjacent),
  softened by the fact that the temporal controls in the same grid already
  open their panels on focus. Where screen-reader users are primary, set
  `advanceMode="focus"`: elevation stays tied to the user's own input, and
  for text-family fields typing still starts the session immediately.
- `tabCommits` is a signal input — bind it to a user preference to give
  keyboard users the trap back on request.
- Unchanged: Enter/Ctrl+Enter/Escape, the panel's Save/Discard buttons, the
  clear bubble, `aria-invalid`/error wiring. The scope adds a gesture; it
  removes none.

## 8. Upstream surface (for reference)

```ts
// angular-inline-select (core entry point)
export {
  EditableScope,               // the [editableScope] directive
  EDITABLE_SCOPE,              // the DI token (ancestor-provided contract)
  type EditableScopeContract,  // tabCommits/onBlocked/advanceMode + register/advanceFrom
  type EditableScopeField,     // { host, entry, beginEdit }
  type EditableScopeBlockedPolicy, // 'revert' | 'stay'
  type EditableScopeAdvanceMode,   // 'focus' | 'edit'
};
```

Specs: `src/lib/utils/editable-scope/editable-scope.spec.ts` — commit +
advance, Shift+Tab, both blocked policies, park vs wrap, edit-advance,
opt-out.
