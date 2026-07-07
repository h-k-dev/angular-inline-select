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

import {
  AngularInlineDate,
  AngularInlineTime,
  AngularInlineDuration,
} from 'angular-inline-select/temporal';

/**
 * The signal surface the adapter leans on — nothing beyond what the
 * temporal controls ALREADY expose as `FormValueControl`s plus their public
 * presentational verdicts. Structural on purpose: the controls implement no
 * adapter interface, import nothing from this entry point, and stay
 * entirely mat-ignorant (the deliberate inversion of iusta's adapter, where
 * the control itself injects the form field and branches on it).
 */
type InlineTemporalControl = AngularInlineDate | AngularInlineTime | AngularInlineDuration;

/**
 * Hosts an inline temporal control inside `<mat-form-field>`:
 *
 * ```html
 * <mat-form-field>
 *   <mat-label>Deadline</mat-label>
 *   <angular-inline-date inlineMatFormField [formField]="form.due" />
 * </mat-form-field>
 * ```
 *
 * ALL Material knowledge lives here — the directive provides
 * `MatFormFieldControl`, derives every member from the control's public
 * signals, and bridges them into the `stateChanges` Subject Material still
 * wants. The control's own chrome rests via the generic BARE-CHROME host
 * classes (a container seam, not a mat one — dense table cells can use the
 * same classes).
 */
@Directive({
  selector:
    'angular-inline-date[inlineMatFormField], angular-inline-time[inlineMatFormField], angular-inline-duration[inlineMatFormField]',
  providers: [{ provide: MatFormFieldControl, useExisting: InlineMatFormField }],
  host: {
    class: 'inline-field-bare',
    '[class.inline-field-bare--hide-placeholder]': '!shouldLabelFloat',
    '[attr.id]': 'id',
  },
})
export class InlineMatFormField implements MatFormFieldControl<unknown>, OnDestroy {
  readonly #control: InlineTemporalControl;
  readonly #element = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Signals → the Subject Material still wants (it runs its own CD off this). */
  readonly stateChanges = new Subject<void>();

  readonly id = inject(_IdGenerator).getId('inline-mat-field-');

  /** Signal forms, not Reactive Forms — Material reads `errorState` instead. */
  readonly ngControl = null;

  /** `mat-form-field-type-inline-temporal` lands on the form-field root. */
  readonly controlType = 'inline-temporal';

  /** The host is a wrapper, not a native input — no `label[for]` wiring. */
  readonly disableAutomaticLabeling = true;

  #describedBy: string[] = [];

  /**
   * Panel state SNAPSHOTTED at the chrome mousedown: by the time the
   * click's `onContainerClick` runs, the CDK outside-click dispatcher
   * (document capture) has ALREADY dismissed an open panel — reading live
   * state there would re-open it, the exact close-reopen flicker this
   * adapter exists to prevent.
   */
  #panelWasOpen = false;

  constructor() {
    const control =
      inject(AngularInlineDate, { optional: true, self: true }) ??
      inject(AngularInlineTime, { optional: true, self: true }) ??
      inject(AngularInlineDuration, { optional: true, self: true });
    if (control === null) {
      throw new Error(
        'inlineMatFormField must sit on an angular-inline-date/-time/-duration element.',
      );
    }
    this.#control = control;

    // Anchor the date control's calendar to the form field's FLEX box (what
    // mat-select/-datepicker/-autocomplete use), not the bare input wrapper —
    // so the panel drops below the underline instead of at the text baseline.
    // The control never learns what mat is; it only receives a CDK-generic
    // ElementRef through its `overlayOrigin` seam. `getConnectedOverlayOrigin`
    // reads a ViewChild, so defer to afterNextRender below.
    const formField = inject(MAT_FORM_FIELD, { optional: true });

    // Container CHROME must not steal focus: a mousedown on the box's
    // padding/label/outline would blur the input, settle the session and
    // close the panel — and the click's `onContainerClick` would then
    // refocus and REOPEN it (the close-reopen flicker). Preventing the
    // chrome mousedown keeps the session alive, so the click below can be
    // an honest TOGGLE. The control's own surfaces (inside our host) keep
    // their native behavior.
    const injector = inject(Injector);
    const destroyRef = inject(DestroyRef);
    afterNextRender(
      () => {
        if (formField !== null && this.#control instanceof AngularInlineDate) {
          this.#control.overlayOrigin.set(formField.getConnectedOverlayOrigin());
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
    // any change pokes stateChanges exactly once (the iusta bridge idea,
    // minus the control coupling).
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

  /** Date resolves its own default (the locale pattern) — read the verdict, not the input. */
  #placeholder(): string {
    return this.#control instanceof AngularInlineDate
      ? this.#control.effectivePlaceholder()
      : this.#control.placeholder();
  }

  get placeholder(): string {
    return this.#placeholder();
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
   * The container click is the 📅-icon gesture writ large: unfocused it
   * opens (focus starts the session, the panel follows), focused it
   * TOGGLES the panel. Clicks landing on the control's own surfaces are
   * ignored here — the control already handled them.
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
