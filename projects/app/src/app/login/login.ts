import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
  computed,
} from '@angular/core';
import { FormField, form, required } from '@angular/forms/signals';

// Material
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

// Components
import { AngularInlineText } from '../../../../angular-inline-select/src/lib/angular-inline-text/angular-inline-text';
import { AngularInlineNumber } from '../../../../angular-inline-select/src/lib/angular-inline-number/angular-inline-number';
import { EditableSuffix } from '../../../../angular-inline-select/src/lib/angular-inline-text/editable-affix';

// Phone entry point
import { AngularInlinePhone, createLibphonenumberCodec } from 'angular-inline-select/phone';
import metadata from 'libphonenumber-js/metadata.min.json';
import examples from 'libphonenumber-js/examples.mobile.json';

const phoneCodec = createLibphonenumberCodec(metadata, examples);

/**
 * Sign-in dialog: a centered signal form exercising every inline control —
 * text (required), number, number + euro suffix, and two phone fields
 * (one prefilled + required, one empty).
 */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    // Material
    MatDialogModule,
    MatButtonModule,
    MatIconModule,

    // Forms
    FormField,

    // Components
    AngularInlineText,
    AngularInlineNumber,
    AngularInlinePhone,
    EditableSuffix,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  protected codec = phoneCodec;

  /**
   * The sign-in model. `name` is returned as the dialog result on
   * "Sign In" and becomes the app's toolbar title.
   */
  protected signInModel = signal<{
    name: string;
    age: number | null;
    income: number | null;
    telephone: string | null;
    mobile: string | null;
  }>({
    name: '',
    age: null,
    income: null,
    telephone: '+49301234567',
    mobile: null,
  });

  protected signInForm = form(this.signInModel, (path) => {
    required(path.name);
    required(path.telephone);
  });

  // Which error the projected [editable-error] content describes —
  // WHEN errors show is the field's job.
  protected nameMissing = computed(() =>
    this.signInForm.name().errors().some((error) => error.kind === 'required'),
  );

  protected telephoneMissing = computed(() =>
    this.signInForm.telephone().errors().some((error) => error.kind === 'required'),
  );

  /** Two decimals for the income field — the € lives in the suffix. */
  protected incomeFormat = (value: number | null): string =>
    value === null ? '' : value.toFixed(2);
}
