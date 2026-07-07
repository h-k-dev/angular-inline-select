/*
 * Public API Surface of angular-inline-select/temporal-mat
 *
 * Secondary entry point: THE ONLY mat-aware code in the package. Apps that
 * never host temporal controls inside <mat-form-field> carry zero Material
 * bytes from us, and @angular/material stays an optional peer — the same
 * containment as libphonenumber in /phone and Luxon in /temporal.
 */

export * from './mat-form-field-adapter';
