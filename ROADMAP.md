# ROADMAP — angular-inline-text

Goal: an inline edit component that emits the changed value on save (`savedModelChange`), auto-reverts non-accepted values, and notifies the parent via a `reverted` output. Angular 22, zoneless, signal-based, standalone. Styled with `--mat-sys-*` tokens (with fallbacks), built primarily on `@angular/aria` / CDK, Material only where unavoidable.

Contract decisions (agreed):
- Live value propagation stays (dual mode with injected `FormField` is kept).
- New `reverted` output fires whenever a draft is discarded (Escape, decline, outside-click decline, detach revert).
- Pre-1.0: breaking API changes are allowed.

---

## What is already good (preserve)

- Pure signal architecture: `computed`, `linkedSignal`, `model`, host bindings — no zone reliance, no RxJS in the hot path.
- `FormValueControl<string>` + signal-forms integration; standalone fallback via local `form()`.
- CDK `cdkConnectedOverlay` with paired top/bottom positions, `cdkTrapFocus`, appearance variants (`fill`/`outline`).
- Theming via `--mat-sys-*` tokens with fallbacks; `prefers-reduced-motion` handled; `field-sizing: content` with graceful fallback.
- `RestrictCharacters` strategy pattern: IME-safe (`compositionstart/end`), delegates `beforeinput`/`paste`/`keydown` — good extension point.
- `OverlayWidthSyncDirective`: ResizeObserver + rAF-throttled reposition, context-over-input resolution.

---

## Phase 0 — Bug fixes (no visual change)

- [ ] **Blur guard selector mismatch**: `EditableOverlayControl.onBlur` checks `closest('.editable-panel')`, but the panel renders `.editable-panel__inner` / `.iusta-editable-panel`. The guard never matches → overlay can close while focus moves into it. Fix selector (or better: compare against the overlay element ref instead of a class string).
- [ ] **Dead code**: `provideAutosize()` is never called; `scrollStrategy` computed in `OverlayWidthSyncDirective` is never used; `copyValue` signal is never written; `warningMessage` linkedSignal always computes the same constant. Remove or wire up.
- [ ] **Duplicate autosize effect**: `resize` effect and `provideAutosize()` are copies. Keep exactly one code path (see Phase 2 — likely neither).
- [ ] **`accepted` mutable boolean + `autoResetAccepted` effect**: ordering-fragile (accept → detach race). Replace with a signal or reset it synchronously where state transitions happen; delete the effect.
- [ ] **`errorMessage`** in wrapper returns static `'Invalid input'` while the template already renders real error messages — deduplicate (panelMessage vs. template `@for` over errors render competing messages).

## Phase 1 — Contract: FormValueControl + save / revert semantics

First-class signal-forms citizenship — the component must behave identically in all three modes: bound via `[formField]` (signal forms), plain `[(value)]` model binding, and fully standalone.

- [ ] **Implement the FormValueControl contract natively** instead of injecting `FormField` and mirroring its state: declare `disabled = input(false)`, `readonly = input(false)`, `required = input(false)`, `errors = input<readonly ValidationError[]>([])` — the form binds these automatically. Remove the `inject(FormField)` workaround.
- [ ] **Accept must write the value model**: today `accept()` only emits `savedModelChange`; `value.set(normalized)` is the actual channel signal forms and `[(value)]` consumers listen to. Order: `value.set()` → `savedModelChange.emit()` → close.
- [ ] **Add `touched = model(false)`**: set on first edit-session end (blur/close) so the form's touched state is real.
- [ ] **Drop the nested mirror `form()`** whose `validate()` replays parent errors (double validation). Keep a local `form()` only for the *draft* (draft-local validation like restrict/normalize checks); bound-field errors come in via the `errors` input.
- [ ] Live propagation stays: keystrokes update `value` while editing; revert sets `value` back to `previous` and emits `reverted`.
- [ ] Add `reverted = output<string>()` (payload: the discarded draft value). Emit on: Escape decline, Discard button, outside-click decline, detach-revert in `handleDetach`.
- [ ] Single choke point for "discard": today revert logic is spread across `(declined)="localForm().reset(previous)"` in the template, `handleDetach`, and wrapper decline handling. Route all paths through one `revert()` method in `AngularInlineText`.
- [ ] Enter accepts on single-line input (currently only Ctrl+Enter). Keep Ctrl+Enter for textarea.
- [ ] `previous` linkedSignal reads `dirty()` inside its computation — document or refactor; latching behavior is correct today but non-obvious and easy to break. Consider explicit `previous = signal()` set at edit-session start (`showForm` → true) instead.
- [ ] Review `handleOutsideClick` half-viewport Euclidean distance gate: replace magic threshold with an input (`declineDistance`) or a simpler rule (click on another `.iusta-editable-wrapper` → decline; otherwise refocus). Document whichever stays.
- [ ] Tests (vitest): accept sets `value` and emits once with normalized value; decline/detach reverts and emits `reverted`; invalid blocks accept; `normalizeValue` trims before compare (no false-dirty); all three binding modes covered (signal form / `[(value)]` / standalone); `touched`/`disabled`/`readonly` round-trip with a real `form()`.

## Phase 2 — Performance

- [ ] **Autosize** *(superseded by Phase 4 contenteditable — height becomes text flow; skip if Phase 4 lands first)*: per keystroke today = input-handler resize + effect rAF resize, each doing `height='auto'` + `scrollHeight` read → multiple forced reflows. Interim: `field-sizing: content` primary, `TextareaAutosize` as `@supports not` fallback, delete the component-level effects; reposition overlay via `afterRenderEffect`.
- [ ] **ResizeObserver lifecycle**: observer runs from `ngAfterViewInit` forever, on every instance (a page of 50 inline fields = 50 live observers). Interim fix: observe only while the overlay is open. Superseded by Phase 4's view/edit split, which deletes the observer entirely — if Phase 4 lands first, skip this.
- [ ] **Template object identity**: `[mEditableOverlayControl]="{ showSignal: showForm }"` allocates a fresh object every template execution. Bind the signal directly (split into two inputs) or build the object once in the component.
- [ ] **Overlay config churn**: `overlayConfig` recomputes on every width change while open. Verify CdkConnectedOverlay diffing; if it rebuilds, pass width via `cdkConnectedOverlayWidth` only.
- [ ] Measure before/after: Chrome performance trace of typing in a multiline field; assert single layout pass per keystroke.

## Phase 3 — Accessibility (@angular/aria first)

- [ ] `@angular/aria` is a dependency but unused — adopt it for the combobox-like pattern (input + owned panel) where it fits; fall back to CDK a11y, Material last.
- [ ] Wire input ↔ panel: `aria-expanded`, `aria-controls`, panel `role` (likely `dialog` for the confirm card), `aria-describedby` for error/warning messages.
- [ ] Error/warning messages in a live region (`aria-live="polite"`), so screen readers hear validation without focus moves.
- [ ] Replace hand-rolled `handleTab` querySelector-focusable-walk with CDK `FocusTrap.focusFirstTabbableElement()` / `InteractivityChecker` — the panel already has `cdkTrapFocus`.
- [ ] Panel `<div tabindex="0">` review: focusable container without a role is noise; give it a role or drop the tabindex.
- [ ] Clear button: confirm hover-reveal doesn't hide it from keyboard/AT (it's `visibility: hidden` until `:focus-within` — verify tab order reaches it and add `aria-label` audit).
- [ ] Keyboard spec written down: Enter (single-line save), Ctrl+Enter (textarea save), Escape (revert), Tab-while-dirty (into panel).

## Phase 4 — Appearance & motion (Framer-grade)

### Non-negotiables (agreed)

1. **Per-line dashed underline in multiline** — the underline hugs each text line and stops where the text stops (never covers empty input space).
2. Opening/edit transition must feel smooth and designed, not a restyle-snap.
3. Action/clear buttons float — they reserve **no** layout space (must also work inside `mat-dialog`).
4. Spring-based, interruptible motion (Cheng Lou / react-motion philosophy: no fixed-duration feel, velocity-preserving).

### Editing surface: contenteditable (the structural fix — decided)

A textarea is a rectangular box — no border, `::after`, or background can ever hug wrapped text lines, and it can never wrap inline within a paragraph. The ResizeObserver + width-sync + autosize machinery exists only to fight these symptoms. The Notion answer: the rendered text IS the editor.

- [ ] **Single surface**: the inline span carries `contenteditable="plaintext-only"`. Same element at rest and while editing — true inline flow in paragraphs in both states, wraps mid-line, never pushes surrounding text, zero layout shift on click, native caret-at-click-point.
- [ ] **Underline**: `text-decoration: underline dashed` + `text-underline-offset` (native text paint — most performant). Fallback to `repeating-linear-gradient` + `box-decoration-break: clone` only if dash geometry needs exact control. Per-line, text-hugging, in view *and* edit state.
- [ ] **Delete the machinery**: `TextareaAutosize`, `field-sizing` juggling, `OverlayWidthSyncDirective` ResizeObserver, span↔textarea metric parity — all removed. Height/width are just text flow.
- [ ] **Value sync**: `textContent` ↔ draft signal on `input` events; `FormValueControl` contract (Phase 1) is untouched — it lives on the component, not the element.
- [ ] **plaintext-only support**: requires Firefox 136+ (2025). Fallback path: plain `contenteditable` + `beforeinput` filtering of `insertFromPaste`/formatting — `RestrictCharacters` already hooks exactly these events; extend it to double as the fallback sanitizer.
- [ ] **Single-line variant**: block `insertParagraph`/`insertLineBreak` in `beforeinput` (Enter = accept instead); `white-space: nowrap` + fade-out mask at overflow.
- [ ] **A11y wiring (moves from nice-to-have to required)**: `role="textbox"`, `aria-multiline`, `aria-invalid`, `aria-readonly`; label association; verify SR announcement of edit mode. IME test matrix (CJK composition on contenteditable).
- [ ] **Disabled/readonly**: `contenteditable=false` + cursor/appearance states; ensure copy still works.
- [ ] **Floating actions**: clear button (and future affordances) in an absolutely positioned rail pinned to the wrapper edge — zero layout shift, fade+scale entrance. Verify inside `mat-dialog` (stacking context, overflow clipping); CDK overlay panel already escapes the dialog.

### Motion system

- [ ] **Spring easings, web-native**: CSS `linear()` easings generated from spring curves for enters/exits (no JS, no lib); a tiny WAAPI spring helper only where mid-flight interruption matters (expansion morph). Duration tokens become spring presets (`--iusta-spring-snappy`, `--iusta-spring-gentle`).
- [ ] **Overlay exit animation**: only `animate.enter` exists — the panel pops out. Add `animate.leave` (fade + 4px translate + slight scale-down, accelerate). Exit never blocks interaction.
- [ ] **Panel internal height choreography**: error/warning/action rows cause hard jumps. `interpolate-size: allow-keywords` + height transition, grid-rows `0fr → 1fr` fallback; messages fade/slide staggered ~30ms after the container settles.
- [ ] **Micro-interactions**: Save morphs to checkmark on success (~300ms, then close); invalid accept = ±3px x-shake (200ms); pressed-state scale 0.97 with spring-back; floating buttons fade+scale rather than visibility-flip.
- [ ] **Performance budget**: compositor-only (`transform`/`opacity`) except the sanctioned height choreography. 60fps trace while typing with panel open.
- [ ] **Reduced motion parity**: every animation gets a `prefers-reduced-motion` branch (opacity-only or none).

## Phase 5 — Theming & styles (preserve the look)

- [ ] Replace hard-coded `#428bca` default with token chain: `var(--iusta-editable-color, var(--mat-sys-primary, #428bca))`.
- [ ] Overlay pixel offsets (`VISUAL_Y_OFFSET = 7.5` "eyeballed at 13px font") break at other root font sizes. Derive from the same CSS custom properties the SCSS uses (read once per attach via `getComputedStyle`) or express insets in rem on both sides.
- [ ] Remove inline styles from templates (`style="margin-left: 8px"`, `[style.marginLeft]="'-1rem'"`) → SCSS classes.
- [ ] Document the public CSS API: every `--iusta-*` variable, in the README, with defaults.
- [ ] Visual regression: before/after screenshots of fill/outline × empty/filled × idle/editing/invalid, light + dark.

## Phase 6 — API & DX (pre-1.0 cleanup)

- [ ] Consistent selector prefix: `angular-inline-text` vs `m-editable-wrapper` vs `mEditableOverlayControl` vs `iusta-*` CSS. Pick one prefix (suggest `iusta`) for selectors, directives, and CSS.
- [ ] Trim public API: `public-api.ts` exports everything, including internals (`OverlayWidthSyncDirective` context plumbing). Export only what consumers compose.
- [ ] Package naming: library is `angular-inline-select` but ships an inline *text* component — align name before publishing, or document the select roadmap.
- [ ] `EditableOverlayControl.state()` throws inside a `computed` when no form is provided — fail at construction time with a clear message instead.
- [ ] README: usage with signal forms, standalone usage, normalization behavior, keyboard map, theming variables.

---

## House style (apply to all new/touched code)

Conventions distilled from the existing codebase — every phase's code follows these.

**Imports** — grouped with banner comments, in fixed order: Angular core (with a `// Signal` sub-group for signal primitives), Material & CDK, third-party, core infrastructure (services/models/enums/pipes), shared UI components, domain-specific components. The `@Component.imports` array gets the same grouping comments (`// Material`, `// Pipes`, `// Components`).

**Dependency injection** — `inject()` only, never constructor injection. Injected services are native private fields: `#document = inject(Document)`.

**Signals first** — `input()` / `model()` / `output()` / `computed()` / `signal()` / `linkedSignal()` / `viewChild()`; no decorators. Derive, don't store: state that can be computed from other signals is a `computed()` (e.g. selections derived from view children), never a synced copy. Compose small named computeds into larger ones (clause → and → where pattern) instead of one monolithic computation.

**Host over template wrappers** — bindings and listeners in `host` metadata (`'[attr.id]': '_id()'`, `'[class.x]': 'cond()'`), not `@HostBinding`/`@HostListener`, not wrapper divs.

**Class body organization** — section separators (`/// Getters`, `/// Lifecycle`, or `// ---` banners) grouping: DI, inputs/models, derived signals, handlers, lifecycle. JSDoc on every public API member (inputs, models, outputs, public methods) explaining intent, not mechanics.

**Control flow** — guard clauses and early returns over nesting. Action dispatch via discriminated unions + `switch` (`DocumentTableRowAction` pattern) rather than boolean flag parameters.

**Lazy boundaries** — heavy or rarely-used UI (dialogs) loaded via dynamic `import().then(({ X }) => dialog.open(X, ...))` at the call site; keeps the eager bundle lean.

**Async hygiene** — cancellable requests take an `AbortSignal`; resolvers receive the signal explicitly.

**Naming** — verb-first handlers (`handleX`, `openX`, `clearX`), `bulkX` for multi-row operations, `isX`/`hasX` for boolean signals and helpers, `X = model(...)` / `X = input(...)` names describe the datum not the mechanism.

---

## Verification (every phase)

1. `ng test` (vitest) green; new behavior covered in Phase 1/2 specs.
2. `ng build` library + app, zoneless app boots without change-detection warnings.
3. Manual pass in the demo app: single-line, multiline, outline, required, restricted-input fields — look must be pixel-identical except where a phase says otherwise.
