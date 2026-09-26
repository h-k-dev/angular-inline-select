// Angular
import {
  // Signals
  computed,
  effect,
  linkedSignal,
  signal,
  type Signal,
  untracked,
} from '@angular/core';

// Forms
import type { ValidationError } from '@angular/forms/signals';

/** The text control's error state — see `makeTextErrorState`. */
export interface TextErrorState {
  /** The field's verdict: the bound `invalid`, or any `errors` (standalone / `[(value)]` modes). */
  readonly isInvalid: Signal<boolean>;
  /** Whether the errors SHOW right now (the mat split: what vs when). */
  readonly errorsVisible: Signal<boolean>;
  /** Fallback rendering without projected `[editable-error]`: the errors that carry a message. */
  readonly errorMessages: Signal<readonly ValidationError.WithOptionalFieldTree[]>;
  /** A pointer inside the panel, or a refused save: the SESSION was touched. */
  markSessionTouched(): void;
  /** The FIELD was touched (a refused save, a clear) — the idle display keeps the errors. */
  markTouched(): void;
  /** `reset()`: back to pristine presentation, and the session closing next emits no touch. */
  reset(): void;
}

/**
 * Mat-form-field error state, split by surface. Errors exist as soon as
 * validation fails; WHEN they show depends on where the user is:
 *
 * - Inside a session: once the SESSION was touched (a pointer went down in the
 *   panel, or a save was attempted). Typing alone never reveals, and opening
 *   the editor from a red idle field is quiet until then. Linked to `editing`,
 *   so every open and close starts it fresh — structure, not a reset someone
 *   has to remember at each open site.
 * - Idle: once the FIELD was touched (a session closed, `markAsTouched`) or
 *   the value arrived invalid: an OCCUPIED invalid value the control never
 *   accepted was injected (a backend `'name.example'` email), so the idle
 *   display wears the error on arrival — presentation only, `touched` is never
 *   forged. Empty stays silent: a pristine `required` field is no mistake.
 *
 * The closing edge of a session calls `onSessionClosed` (the blur analogue —
 * the control emits `touch`). That edge can arrive through the two-way
 * `editing` binding, which no setter sees, so an eager observer is the only
 * hook. Call in an injection context.
 */
export function makeTextErrorState(options: {
  invalid: Signal<boolean>;
  errors: Signal<readonly ValidationError.WithOptionalFieldTree[]>;
  touched: Signal<boolean>;
  editing: Signal<boolean>;
  empty: Signal<boolean>;
  onSessionClosed: () => void;
}): TextErrorState {
  const isInvalid = computed(() => options.invalid() || options.errors().length > 0);
  const injectedInvalid = computed(() => !options.editing() && !options.empty() && isInvalid());

  // A TRANSITION (a session closed): a plain signal written by the one eager
  // observer of that edge below — a linked derivation only sees an edge when
  // it is read on both sides of it.
  const selfTouched = signal(false);
  const sessionTouched = linkedSignal({ source: options.editing, computation: () => false });

  let wasOpen = false;
  effect(() => {
    const open = options.editing();
    if (wasOpen && !open) {
      untracked(() => {
        selfTouched.set(true);
        options.onSessionClosed();
      });
    }
    wasOpen = open;
  });

  return {
    isInvalid,
    errorsVisible: computed(
      () =>
        isInvalid() &&
        (options.editing()
          ? sessionTouched()
          : options.touched() || selfTouched() || injectedInvalid()),
    ),
    errorMessages: computed(() => options.errors().filter((error) => !!error.message)),
    markSessionTouched: () => sessionTouched.set(true),
    markTouched: () => selfTouched.set(true),
    reset: () => {
      selfTouched.set(false);
      wasOpen = false; // a programmatic reset is no interaction: no touch on its close
    },
  };
}
