import { Routes } from '@angular/router';

/**
 * Every section carries the same documentation children: the playground at
 * the root, plus the registry-driven API and Theming pages. The generic doc
 * pages read `data.section` to pick their content from the DOCS registry.
 */
const docChildren = (section: string): Routes => [
  {
    path: 'api',
    loadComponent: () => import('./docs/api-page').then((m) => m.ApiPage),
    data: { section },
  },
  {
    path: 'theming',
    loadComponent: () => import('./docs/theming-page').then((m) => m.ThemingPage),
    data: { section },
  },
];

export const routes: Routes = [
  {
    path: 'text',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/text-playground/text-playground').then((m) => m.TextPlayground),
      },
      ...docChildren('text'),
    ],
  },
  {
    path: 'number',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/number-playground/number-playground').then((m) => m.NumberPlayground),
      },
      ...docChildren('number'),
    ],
  },
  {
    path: 'phone',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/phone-playground/phone-playground').then((m) => m.PhonePlayground),
      },
      ...docChildren('phone'),
    ],
  },
  {
    path: 'temporal',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/temporal-playground/temporal-playground').then(
            (m) => m.TemporalPlayground,
          ),
      },
      ...docChildren('temporal'),
    ],
  },
  {
    path: 'json',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/json-playground/json-playground').then((m) => m.JsonPlayground),
      },
      ...docChildren('json'),
    ],
  },

  // Pattern section — a layout recipe, not a documented component: no
  // api/theming children, so the section tabs stay hidden here.
  {
    path: 'patterns/form-grid',
    loadComponent: () => import('./pages/form-grid/form-grid').then((m) => m.FormGridPage),
  },

  // Benchmark section — not a documented component, so no api/theming children.
  {
    path: 'benchmark/guess',
    loadComponent: () =>
      import('./pages/guess-the-editable/guess-the-editable').then((m) => m.GuessTheEditable),
  },

  { path: '', pathMatch: 'full', redirectTo: 'text' },
];
