import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'text',
    loadComponent: () =>
      import('./pages/text-playground/text-playground').then((m) => m.TextPlayground),
  },
  {
    path: 'number',
    loadComponent: () =>
      import('./pages/number-playground/number-playground').then((m) => m.NumberPlayground),
  },
  {
    path: 'phone',
    loadComponent: () =>
      import('./pages/phone-playground/phone-playground').then((m) => m.PhonePlayground),
  },
  {
    path: 'temporal',
    loadComponent: () =>
      import('./pages/temporal-playground/temporal-playground').then((m) => m.TemporalPlayground),
  },
  { path: '', pathMatch: 'full', redirectTo: 'text' },
];
