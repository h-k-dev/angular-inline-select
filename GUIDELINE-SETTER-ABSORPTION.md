# Custom-setter absorption (consumer guideline)

Porting the 22.1 `linkedSignal` custom-`set` refactor into iusta-core's
absorbed copies. AUDITED AGAINST core dev @ `2b517ffe` (2026-08-27) —
every line number below was verified on that checkout; re-grep before
editing, core moves.

Upstream record: the sandbox commits following `0a5cd1a`; the "why"
ledger lives in `ROADMAP.md` (Shipped → "Custom-setter adoption").
Companion doc: `GUIDELINE-EDITABLE-SCOPE.md` (the Tab-scope absorption —
independent of this one, either order works).

---

## 0. THE GATE — one `npm ci` away

`package.json` AND `package-lock.json` are both at `@angular/*@22.1.x` on
this dev — only the local `node_modules` is stale (21.2.12, whose
`linkedSignal` typings have no `set` option; `npm ls` reports the tree
`invalid`). So the gate is simply: **run `npm ci` first**, confirm
`node_modules/@angular/core/types/core.d.ts` shows the `set?` option on
`linkedSignal`, run core's suite once on the fresh install, then start.

## 1. Why bother (and what's urgent)

One item is a LIVE BUG in core, not a style port:

`core/editables/temporal/range-group.ts:360-361` (and `:375`, `:382` in
`syncDayLeaves`) write **bare strings** into the day leaves' `value`:

```ts
dayCtl()?.value.set(startValue === null ? null : dayToDbEntry(localDayOf(startValue, zone())!, zone()));
```

Shape memory re-infers the leaf's emission shape from every `value` write —
so a `{ start }`-bound day leaf gets silently re-declared string-shaped by
its own group on the first push-down. Upstream this is now spec-pinned
(`range-group.spec.ts` — "leaf shape preservation"; the assertion FAILS
against the old code). Whether a core consumer binds a day leaf with an
object shape today decides urgency, not whether the hazard exists.

Everything else converts write-path invariants from reviewer discipline
into structure: the conversion/parse/flag lives in the signal's own setter,
so no call site can forget it, and the derived write lands synchronously —
no `effect`, no tick lag, no injection-context/`untracked` ceremony.

## 2. Porting order

Dependencies force the order — the group port needs writable internals on
the leaves first:

1. `side-session.ts` — the draft/dirty clamp (self-contained).
2. `editable-date-v2.ts` — writable `internalRange`.
3. `editable-time.ts` — writable `internal`.
4. `editable-time-duration.ts` — private draft clamp.
5. `range-group.ts` — route writes through the leaves (fixes the bug).
6. `editable-number-v2.ts` + `editable-telephone-number.ts` — `innerValue`
   setter absorbs the parse half.

APPLY THE PATTERN, DON'T COPY FILES — every core copy has house features
the sandbox lacks (date-v2's filter mode/strictMode/LB3, the group's
empty-duration-is-0 law, side-session's `announceRevert`). The absorption
model's rule holds: core stays TRUE TO THE SANDBOX TO THE T, diverging
only where core genuinely must — Luxon/outside time manipulation, the LB3
filter emissions, house laws. Every other line should converge back to
upstream text, and §3.2's `:716` below is an example of core drift that
CONVERGES rather than getting an accommodation.

**The consumer restore path is the VALUE CHANNEL, and it needs no API.**
The pattern the whole family guarantees (now spec-pinned upstream — see
§4): a consumer that decides LATE that a committed value didn't stick
(backend eager validation, intertwined logic) simply writes the old value
back into `value`. The linked views re-derive, and when the control had
ALREADY restored it itself (snap-back), the equality dedupe at every
layer — model equality, echo dedupe, linked derivation — absorbs the
write as a silent no-op: no session, no settle events, no restore chain
re-running. `restore()` on the side core is only the INTERNAL
frozen-draft refresh; nothing upstream of the control ever calls it.

## 3. Per-file porting map (line numbers @ `2b517ffe`)

### 3.1 `core/editables/temporal/side-session.ts`

Upstream reference: `temporal/src/side-session.ts` (`makeSideCore`).

- `dirty: boolean` (`:57`, constructed `:70`) →
  `readonly dirty: WritableSignal<boolean>`.
- Give `draft` a custom `set`: `rawSet(value)` then, unless restoring,
  `dirty.set(true)`.
- Add `restore()` — a `restoring` boolean latch around
  `draft.set(display())`. No parameters: the one core site that LOOKED
  like it needed custom text turned out to be equivalent (§3.2, `:716`).
- `restore()` NEVER touches `dirty` — session boundaries keep their
  explicit `dirty.set(false)`.

### 3.2 `editable-date-v2.ts` — the EASIEST port on this dev

Good news from the re-audit: core has independently evolved TOWARD the
pattern. It already has the read-view + single-write-method pair —
`internalRange` computed (`:363`) + `#writeDays(days)` (`:383`, 4 call
sites: `:598`, `:884`, `:893`, `:922`) — which is exactly what collapses
into one writable linkedSignal:

- `internalRange` becomes `linkedSignal<…, InternalDateRange>` with the
  SAME computation and `set: (days) => <the current #writeDays body>`.
  Delete `#writeDays`; the 4 call sites become `internalRange.set(...)`.
- The filter-mode branch RIDES ALONG: the setter body already routes
  `mode() === 'filter'` writes to `filterRange` and everything else to
  `value` — one seam for both channels, LB3 serialization untouched.
- CAUTION — the `source`. Upstream sources on `this.value`; core's
  computation reads `mode()`/`filterRange()`/`value()`. Use the callback
  source form (`source: () => [this.mode(), this.filterRange(), this.value()]`
  — or keep the computation self-contained reading those signals directly,
  with a source that captures all three). The reset semantics must stay:
  an external `value`/`filterRange` write recomputes the view.
- Dirty sites: `= true` at `:581` (deleted — the setter marks it),
  `= false` at `:614`, `:712`, `:899`, `:927`, `:1078`, `:1106` →
  `.set(false)`, read at `:681` → call.
- Draft restores at `:898`, `:926`, `:1077`, `:1105`
  (`side.draft.set(side.display())`) → `side.restore()`.
- **`:716` converges to plain `side.restore()`**: the hand-formatted
  `side.draft.set(formatIsoDate(day, this.effectiveLocale()))` in the
  keepOpen settle is EQUIVALENT to `display()` — core's own side display
  is `formatIsoDate(committed(), effectiveLocale())` (`:420`), and at
  `:716` the committed day has already echoed through `#writeDays`, so
  `committed() === day`. This is core drift converging back to upstream
  text, not a case for a text-override API. (It also sits after the
  `dirty = false` at `:712` — under the clamp a raw `draft.set` there
  would wrongly re-mark the session dirty; `restore()` doesn't.)
- Typed site `:580` (`side.draft.set(raw)`) keeps working — the setter
  marks dirty; delete the adjacent `:581`.

### 3.3 `editable-time.ts`

Upstream reference: `angular-inline-time.ts`.

- `readonly internal = computed<…>` (`:297`) + `#writeInstants(start, end)`
  (`:306`) → one writable linkedSignal; the setter body is the current
  `#writeInstants` (echo + structural-equality dedupe + `value.set`).
- Call sites (the positional-pair shape the port exists to kill):
  - `:508-509`, `:763-764` → `this.internal.update((r) => ({ ...r, [key]:
    resolved.instant }))`
  - `:587` → `this.internal.set({ start, end })`
  - `:837-838` (clear) → `this.internal.update((r) => ({ ...r, [key]: null }))`
- Dirty sites: `= true` at `:501`, `:758`, `:773` (all deleted — each sits
  beside a `side.draft.set(raw)`), `= false` at `:468`, `:621`, `:843`,
  `:876`, read at `:595` → call.
- Draft restores at `:626`, `:842`, `:875` → `side.restore()`.

### 3.4 `editable-time-duration.ts`

Upstream reference: `angular-inline-duration.ts` — the private twin of
§3.1: `set` on `draft` (`:215`) marking `#dirty` (`:229`) unless
`#restoring`; add `#restoreDraft()`; delete the `= true` at `:317` (beside
the typed `draft.set`); `= false` at `:308`, `:378` stay; display-restores
become `#restoreDraft()`.

### 3.5 `core/editables/temporal/range-group.ts` — the bug fix

Upstream reference: `range-group.ts` (`writeStart`/`writeEnd`/
`writeDayLeaf`/`pushDown`/`syncDayLeaves`).

- `writeStart` (`:311`) / `writeEnd` (`:322`): replace
  `control.value.set(next)` + `times.value.set({...})` with
  `internal.update((r) => ({ ...r, start|end: next }))` on both the single
  leaves and the pair. Convention the upstream comment states: a single
  `rangeEnd` leaf holds its instant in the internal START slot. This also
  retires core's `?? ''` empty-side padding at `:318`/`:328` — the leaf's
  echo owns empty-side representation now.
- Add `writeDayLeaf(control, instant)`: derive the local day, write
  `control.internalRange.set({ start: day, end: day })` guarded on change —
  the day→DB conversion and its zone LEAVE the group entirely.
- `pushDown` (`:352-361`): leaves via internal writes; day leaves via
  `writeDayLeaf`. KEEP the house law in `writeLength` (`:332-336` — "the
  duration editable's empty IS 0", `next ?? 0`).
- `syncDayLeaves` (`:375`, `:382`): collapse both blocks to `writeDayLeaf`;
  the `Object.is` guards go — the setter's echo dedupe replaces them.
- Behavior note (upstream-verified): a range-shaped pair now receives
  `{ start: null, end: null }` instead of literal `null` on an empty
  push-down — this MATCHES what the leaf itself emits on clear, and every
  upstream group spec passed unchanged.

### 3.6 `editable-number-v2.ts` + `editable-telephone-number.ts`

Upstream references: `angular-inline-number.ts`, `angular-inline-phone.ts`.

- Move the parse half of `handleInnerValue` (`:291`/`:270`) into
  `innerValue`'s `set` (`:266`/`:183`) — `rawSet(raw)` first, then parse →
  conditional `value.set`; `handleInnerValue` shrinks to one line.
- The payoff site is REAL on this dev: `editable-telephone-number.ts:464`
  (`innerValue.set('+${option.dialCode} ')` in the country pick) bypasses
  the parse today, same as upstream did — the setter closes it for free.

## 4. Specs to carry over

- `temporal/src/side-session.spec.ts` — 3 clamp specs (setter marks dirty;
  restore doesn't; source-driven reset doesn't). Drop-in, no TestBed.
- `angular-inline-date.spec.ts` — "the consumer restore path (the value
  channel)": a LATE consumer restore after a backend-rejected commit is
  accepted silently, and an ALREADY-RESTORED value absorbs the consumer's
  restore as a no-op (no restore chain re-runs). These pin the contract
  core's eager-validation flows depend on — carry them.
- `range-group.spec.ts` — "leaf shape preservation" (a `{ start }`-bound
  day leaf keeping its shape through an explicit-ISO propagation). The
  regression test for §1; adapt selectors/`m-` prefixes.
- The strongest gate is free: core's EXISTING suites must pass unchanged.
  Upstream, all 404 pre-existing specs covering every commit path across
  date/time/duration/group/number/phone passed without a single edit —
  that is the behavioral-equivalence bar the port has to meet too.

## 5. What NOT to port

- `editing`-bridge effects (focus in/out on `editing` writes) stay effects:
  `set` exists only on `linkedSignal` (not `model()`/`signal()`), and DOM
  focus isn't a pure function of state anyway.
- `previous` (text/json engine) and the shape-memory `last` are never
  written — nothing to intercept.
- Any setter that writes back toward its own source MUST keep the
  structural-equality dedupe inside the setter — that guard is what makes
  the write-back loop-free; it is not optional and it lives in the setter,
  never at call sites.

## 6. The calendar seam is LIVE in core (it was "future" upstream)

Core's `inline-calendar.ts` already has `dayFilter` (`:119` — the
strictMode/holiday bound the sandbox lacks) next to the `active`
linkedSignal (`:233`) with four navigation write sites (`:301`, `:306`,
`:339`, `:346`). A custom `set` on `active` is the ONE place a
navigation clamp would live — but decide the UX first: most calendars let
focus TRAVERSE disabled days and refuse only the PICK (core already
refuses picks). Clamping navigation is a choice, not a correctness fix;
if chosen, it's four call sites collapsing into one setter.
