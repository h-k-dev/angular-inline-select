import { Directive, ElementRef, InjectionToken, inject, input, type Signal } from '@angular/core';
import { InteractivityChecker, LiveAnnouncer } from '@angular/cdk/a11y';

/**
 * What a refused commit does to a Tab-advance:
 *
 * - `'revert'` (default) — the house temporal rule: Tab is NAVIGATION, never a
 *   validity checkpoint. The draft snaps back to the session baseline and
 *   focus moves on. Never traps, never persists a draft error.
 * - `'stay'` — mat submit semantics: the save attempt reveals the errors and
 *   Tab is refused. For scopes where silently losing a typed draft is worse
 *   than interrupting the flow.
 */
export type EditableScopeBlockedPolicy = 'revert' | 'stay';

/**
 * Where a Tab-advance lands:
 *
 * - `'edit'` (default) — focus lands AND the session opens (caret at the
 *   end). The settle-and-keep-typing flow: no second gesture between fields
 *   — and consistent with the temporal family, whose panels already open on
 *   focus. Skimming still works: an untouched session settles as a
 *   non-event on the next Tab.
 * - `'focus'` — lands on the next field's in-flow display only. Editing
 *   starts on the next mutation ("only a mutation elevates"): visually
 *   quieter, elevation stays tied to the user's own input — prefer it where
 *   screen-reader users are primary.
 */
export type EditableScopeAdvanceMode = 'focus' | 'edit';

/**
 * How a Tab-settle ended — what the scope announces to assistive tech. The
 * settle is otherwise SILENT for a screen-reader user: focus moves, but
 * nothing says whether the value was kept or thrown away.
 */
export type EditableScopeSettleOutcome = 'saved' | 'reverted' | 'blocked';

/**
 * One field's registration with its scope. Controls register themselves —
 * the scope never queries for components.
 */
export interface EditableScopeField {
  /**
   * The control's host element. Every tabbable INSIDE it (affix buttons, a
   * phone control's flag trigger) collapses into this single field stop, so
   * a Tab-advance lands on the field, not on its chrome.
   */
  host: HTMLElement;
  /** The in-flow element focus lands on when the walk reaches this field. */
  entry: HTMLElement;
  /** Opens an edit session — the `advanceMode: 'edit'` hook. */
  beginEdit(): void;
}

/**
 * The contract a scope provides DOWN to the inline controls beneath it.
 * Pull-based, like the temporal leaf-state token: a control without an
 * ancestor scope injects `null` and keeps today's behavior exactly — the
 * elevated panel stays a focus trap and Tab cycles its actions.
 */
export interface EditableScopeContract {
  /** The opt-in: while true, Tab inside an elevated panel settles + advances. */
  tabCommits: Signal<boolean>;
  /** What a refused (invalid-draft) commit does. */
  onBlocked: Signal<EditableScopeBlockedPolicy>;
  /** Whether an advance lands on the next field or also opens its session. */
  advanceMode: Signal<EditableScopeAdvanceMode>;

  /**
   * The screen-reader instruction the field weaves into its panel's
   * `aria-describedby` while the scope is live — how a non-sighted user
   * learns that Tab now saves.
   */
  tabHint: Signal<string>;

  /** Registers a field for the walk; returns the unregister function. */
  register(field: EditableScopeField): () => void;

  /**
   * Moves focus from `origin` (a field's in-flow entry element) to the
   * next/previous tab stop inside the scope. Returns whether focus moved.
   */
  advanceFrom(origin: HTMLElement, direction: 1 | -1): boolean;

  /**
   * Announces a settle outcome through the live-region channel. Controls
   * call this on every Tab-settle so committing and (especially) silently
   * restoring a baseline are never invisible to assistive tech.
   */
  announce(outcome: EditableScopeSettleOutcome): void;
}

export const EDITABLE_SCOPE = new InjectionToken<EditableScopeContract>('EDITABLE_SCOPE');

/** A resolved tab stop: a registered field, or a bare tabbable (native input, button). */
interface ScopeStop {
  element: HTMLElement;
  field?: EditableScopeField;
}

/** Marker stamped on registered hosts so the walk resolves fields via `closest`. */
const FIELD_HOST_ATTR = 'data-editable-scope-host';

/**
 * Everything that can possibly be a tab stop — much narrower than `*`, so
 * the per-keypress walk stays cheap on a large table. `[tabindex]` and
 * `[contenteditable]` cover the library's own entry surfaces.
 */
const CANDIDATE_SELECTOR =
  'input, button, select, textarea, a[href], audio[controls], video[controls], [tabindex], [contenteditable]';

/**
 * Tab-to-accept scope — OPT-IN Tab semantics for a group of inline fields
 * (a record grid, a table, a custom-field group).
 *
 * Without a scope, the elevated panel is a deliberate stop: `cdkTrapFocus`
 * holds Tab and cycles editor → Discard → Save. Inside a scope with
 * `tabCommits`, Tab becomes what it already is in the temporal family
 * (input-rehost controls commit on Tab/blur natively): SETTLE the open
 * session, then move to the next field. Shift+Tab mirrors it backwards.
 *
 * The walk is DOM-order over the scope host's tabbables, so unregistered
 * stops (a temporal control's native inputs, a JSON preview's button-role
 * display) participate naturally — a mixed grid keeps one gesture. Panel
 * chrome (Save/Discard, the clear bubble) lives in the CDK overlay container
 * outside the host and is excluded by construction.
 */
@Directive({
  selector: '[editableScope]',
  providers: [{ provide: EDITABLE_SCOPE, useExisting: EditableScope }],
})
export class EditableScope implements EditableScopeContract {
  #host = inject<ElementRef<HTMLElement>>(ElementRef);
  #checker = inject(InteractivityChecker);
  #announcer = inject(LiveAnnouncer);

  /** The opt-out lever for a scope that wants the trap back conditionally. */
  tabCommits = input(true);

  onBlocked = input<EditableScopeBlockedPolicy>('revert');

  advanceMode = input<EditableScopeAdvanceMode>('edit');

  /**
   * Whether Tab off the scope's last field wraps to the first. Off by
   * default: the scope is a region of the page, not a modal — falling out
   * the far edge parks focus on the settled field, and the next native Tab
   * continues into the page.
   */
  wrap = input(false);

  // ---------------------------------------------------------------------------
  // Assistive-tech strings — English defaults, override to localize. An empty
  // string mutes that channel.
  // ---------------------------------------------------------------------------

  /** Woven into the panel's `aria-describedby` while the scope is live. */
  tabHint = input('Tab saves and moves to the next field, Shift+Tab to the previous one.');

  /** Announced (politely) when a Tab-settle committed a changed value. */
  savedAnnouncement = input('Saved');

  /** Announced (assertively) when a Tab-settle restored the previous value. */
  revertedAnnouncement = input('Not saved — previous value restored');

  /** Announced (assertively) when a Tab-settle was refused (`onBlocked: 'stay'`). */
  blockedAnnouncement = input('Not saved — the value has errors');

  announce(outcome: EditableScopeSettleOutcome): void {
    const message =
      outcome === 'saved'
        ? this.savedAnnouncement()
        : outcome === 'reverted'
          ? this.revertedAnnouncement()
          : this.blockedAnnouncement();
    if (!message) return;

    // A discarded or refused draft is data the user may believe they saved —
    // that news must not wait behind whatever the reader is mid-way through.
    void this.#announcer.announce(message, outcome === 'saved' ? 'polite' : 'assertive');
  }

  #fields = new Map<HTMLElement, EditableScopeField>();

  register(field: EditableScopeField): () => void {
    this.#fields.set(field.host, field);
    // The marker makes the walk O(candidates): every element inside a
    // registered host resolves to its field via one native `closest`,
    // instead of a per-element scan over every registration.
    field.host.setAttribute(FIELD_HOST_ATTR, '');

    return () => {
      this.#fields.delete(field.host);
      field.host.removeAttribute(FIELD_HOST_ATTR);
    };
  }

  advanceFrom(origin: HTMLElement, direction: 1 | -1): boolean {
    const stops = this.#stops();
    if (stops.length === 0) return false;

    const index = stops.findIndex(
      (stop) => stop.element === origin || (stop.field?.host.contains(origin) ?? false),
    );

    // Origin unknown (registered after a DOM move, or outside the host):
    // enter the scope at the edge the direction implies.
    let next = index === -1 ? (direction === 1 ? 0 : stops.length - 1) : index + direction;

    if (next < 0 || next >= stops.length) {
      if (!this.wrap()) return false;
      next = (next + stops.length) % stops.length;
    }

    const stop = stops[next];
    stop.element.focus();
    if (stop.field && this.advanceMode() === 'edit') stop.field.beginEdit();
    return true;
  }

  /**
   * The scope's tab stops, resolved fresh per advance (fields appear and
   * disappear with `@for`/`@if` — caching would go stale for no measurable
   * win at grid scale). DOM order via `querySelectorAll`; every tabbable
   * inside a registered field's host collapses into that field's entry.
   */
  #stops(): ScopeStop[] {
    const stops: ScopeStop[] = [];
    const seen = new Set<EditableScopeField>();

    for (const el of this.#host.nativeElement.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)) {
      const fieldHost = el.closest<HTMLElement>(`[${FIELD_HOST_ATTR}]`);
      const field = fieldHost ? this.#fields.get(fieldHost) : undefined;

      if (field) {
        if (!seen.has(field)) {
          seen.add(field);
          if (this.#isTabbable(field.entry)) stops.push({ element: field.entry, field });
        }
        continue;
      }

      if (this.#isTabbable(el)) stops.push({ element: el });
    }

    return stops;
  }

  /**
   * `InteractivityChecker.isTabbable` plus the contenteditable case it does
   * not model: an enabled display/editor surface is tabbable with no
   * `tabindex` attribute (disabled/readonly fields render
   * `contenteditable="false"` and fall through to the checker's verdict).
   * Gated on visibility first — `isContentEditable` is attribute-derived,
   * so a `hidden` field's display would otherwise stay in the walk (and
   * `advanceMode: 'edit'` would open an invisible session).
   */
  #isTabbable(el: HTMLElement): boolean {
    if (!this.#isVisible(el)) return false;
    return el.isContentEditable || this.#checker.isTabbable(el);
  }

  /**
   * Style-based visibility (NOT the checker's geometry-based `isVisible`,
   * which reads 0×0 for every box in unit-test DOMs). `display: none` does
   * not cascade into descendants' computed styles, so the walk climbs;
   * `visibility` inherits, so the element's own value suffices for it.
   */
  #isVisible(el: HTMLElement): boolean {
    if (getComputedStyle(el).visibility === 'hidden') return false;

    for (let node: HTMLElement | null = el; node !== null; node = node.parentElement) {
      if (getComputedStyle(node).display === 'none') return false;
      if (node === this.#host.nativeElement) break;
    }
    return true;
  }
}
