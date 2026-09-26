import {
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  untracked,
  type OnDestroy,
} from '@angular/core';
import { Subject } from 'rxjs';
import { _IdGenerator } from '@angular/cdk/a11y';
import { MAT_FORM_FIELD, MatFormFieldControl } from '@angular/material/form-field';

import { INLINE_TEMPORAL_MAT_CONTROL } from 'angular-inline-select/temporal';

/**
 * Hosts an inline temporal control inside `<mat-form-field>`. It finds the
 * control through `INLINE_TEMPORAL_MAT_CONTROL` (which every temporal
 * control provides on itself), so it mounts either as an attribute —
 *
 * ```html
 * <mat-form-field>
 *   <mat-label>Deadline</mat-label>
 *   <angular-inline-date inlineMatFormField [formField]="form.due" />
 * </mat-form-field>
 * ```
 *
 * — or as a HOST DIRECTIVE of the control, so consumer templates change
 * nothing. Outside a mat-form-field it is inert.
 *
 * Provides `MatFormFieldControl`, derives every member from the control's
 * public signals (label float = focused || !empty, `errorState` = the
 * field's own verdict, `ngControl` = null — signal forms), and bridges one
 * equality-guarded snapshot into the `stateChanges` Subject Material still
 * wants. The control's own chrome rests via the generic BARE-CHROME host
 * classes.
 */
@Directive({
  selector: '[inlineMatFormField]',
  providers: [{ provide: MatFormFieldControl, useExisting: InlineMatFormField }],
  host: {
    // BARE CHROME only where a container actually draws the chrome — as a
    // host directive it is MOUNTED EVERYWHERE, so outside a mat-form-field
    // the control must keep its own dashed underline.
    '[class.inline-field-bare]': 'inMatFormField',
    '[class.inline-field-bare--hide-placeholder]': 'inMatFormField && !labelIsFloating',
    '[attr.id]': 'inMatFormField ? id : null',
  },
})
export class InlineMatFormField implements MatFormFieldControl<unknown>, OnDestroy {
  readonly #control = inject(INLINE_TEMPORAL_MAT_CONTROL, { self: true });
  readonly #element = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The hosting mat-form-field, if any — the adapter is inert everywhere else. */
  readonly #formField = inject(MAT_FORM_FIELD, { optional: true });

  /** Whether a mat-form-field actually hosts us — inert everywhere else. */
  protected readonly inMatFormField = this.#formField !== null;

  /** Signals → the Subject Material still wants (it runs its own CD off this). */
  readonly stateChanges = new Subject<void>();

  readonly id = inject(_IdGenerator).getId('inline-mat-field-');

  /** Signal forms, not Reactive Forms — Material reads `errorState` instead. */
  readonly ngControl = null;

  /** `mat-mdc-form-field-type-inline-temporal` lands on the form-field root. */
  readonly controlType = 'inline-temporal';

  /** The host is a wrapper, not a native input — no `label[for]` wiring. */
  readonly disableAutomaticLabeling = true;

  #describedBy: string[] = [];

  /**
   * Panel state SNAPSHOTTED at the chrome mousedown: by the time the
   * click's `onContainerClick` runs, the CDK outside-click dispatcher
   * (document capture) has ALREADY dismissed an open panel — reading live
   * state there would re-open it (the close-reopen flicker).
   */
  #panelWasOpen = false;

  #placeholder(): string {
    return this.#control.placeholderText();
  }

  constructor() {
    // Container CHROME must not steal focus: a mousedown on the box's
    // padding/label/outline would blur the input, settle the session and
    // close the panel. Preventing it keeps the session alive, so the click
    // below can be an honest TOGGLE. The control's own surfaces (inside
    // our host) keep their native behavior.
    // The form field renders the errors (`mat-error`): a control with its own
    // error overlay keeps it closed.
    if (this.#formField !== null) this.#control.externalErrors?.set(true);

    const injector = inject(Injector);
    const destroyRef = inject(DestroyRef);
    afterNextRender(
      () => {
        // Anchor a panel-floating control's overlay (the date editable's
        // calendar) to the form field's text-field box (what mat-select/
        // -datepicker use) — so the panel drops below the underline instead
        // of at the input's text baseline. The control never learns what mat
        // is; it only receives a CDK-generic ElementRef through its OPTIONAL
        // `overlayOrigin` contract seam.
        if (this.#formField !== null) {
          this.#control.overlayOrigin?.set(this.#formField.getConnectedOverlayOrigin());
        }

        const host = this.#element.nativeElement;
        const container = host.closest('mat-form-field');
        if (container === null) return;

        const guard = (event: Event) => {
          if (host.contains(event.target as Node)) return;
          this.#panelWasOpen = this.#control.panelVisible();
          event.preventDefault();
        };
        container.addEventListener('mousedown', guard);
        destroyRef.onDestroy(() => container.removeEventListener('mousedown', guard));
      },
      { injector },
    );

    // One equality-guarded snapshot of everything Material renders from;
    // any change pokes stateChanges exactly once.
    const snapshot = computed(() => ({
      value: this.#control.value(),
      focused: this.#control.editing(),
      empty: this.#control.isEmpty(),
      required: this.#control.required(),
      disabled: this.#control.effectiveDisabled(),
      errorState: this.#control.errorsVisible(),
      placeholder: this.#placeholder(),
    }));

    effect(() => {
      snapshot();
      untracked(() => this.stateChanges.next());
    });
  }

  get value(): unknown {
    return this.#control.value();
  }

  get placeholder(): string {
    return this.#control.placeholderText();
  }

  get focused(): boolean {
    return this.#control.editing();
  }

  get empty(): boolean {
    return this.#control.isEmpty();
  }

  get shouldLabelFloat(): boolean {
    return this.focused || !this.empty;
  }

  /**
   * Whether the label ACTUALLY floats — mirroring the form field's own
   * decision, which floats on `shouldLabelFloat` OR `floatLabel="always"`.
   * The placeholder-hiding class keys off this, not `shouldLabelFloat`
   * alone: with `floatLabel="always"` Material keeps the label floated and
   * leaves room for the placeholder even while empty and unfocused, so we
   * must NOT hide it there.
   */
  get labelIsFloating(): boolean {
    return this.shouldLabelFloat || this.#formField?.floatLabel === 'always';
  }

  get required(): boolean {
    return this.#control.required();
  }

  get disabled(): boolean {
    return this.#control.effectiveDisabled();
  }

  get errorState(): boolean {
    return this.#control.errorsVisible();
  }

  get describedByIds(): string[] {
    return [...this.#describedBy];
  }

  /** Hint/error ids land on the input surfaces (the host is a wrapper). */
  setDescribedByIds(ids: string[]): void {
    this.#describedBy = ids;
    const inputs =
      this.#element.nativeElement.querySelectorAll<HTMLInputElement>('input[type="text"]');
    for (const input of inputs) {
      if (ids.length > 0) input.setAttribute('aria-describedby', ids.join(' '));
      else input.removeAttribute('aria-describedby');
    }
  }

  /**
   * The container click is the trigger-icon gesture writ large: unfocused
   * it opens (focus starts the session), focused it TOGGLES the panel.
   * Clicks landing on the control's own surfaces are ignored here — the
   * control already handled them.
   */
  onContainerClick(event: MouseEvent): void {
    if (this.#element.nativeElement.contains(event.target as Node)) return;

    const wasOpen = this.#panelWasOpen;
    this.#panelWasOpen = false;

    if (!this.focused) {
      this.#control.focus();
      return;
    }

    // A panel that was open at mousedown has ALREADY been closed by the
    // overlay's own outside-click — that WAS the toggle's close half.
    if (wasOpen) return;

    this.#control.togglePanel();
  }

  ngOnDestroy(): void {
    this.stateChanges.complete();
  }
}
