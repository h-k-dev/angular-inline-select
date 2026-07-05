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
  { path: '', pathMatch: 'full', redirectTo: 'text' },
];
