import { Component, ChangeDetectionStrategy } from '@angular/core';

// Material
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';

/**
 * Baseline — stock Material datepickers in mat-form-fields: the reference
 * point the inline controls are measured against.
 */
@Component({
  selector: 'app-mat-baseline-card',
  templateUrl: './mat-baseline-card.html',
  styleUrl: './mat-baseline-card.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  providers: [provideNativeDateAdapter()],
  imports: [MatFormFieldModule, MatInputModule, MatDatepickerModule],
})
export class MatBaselineCard {}
