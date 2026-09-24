import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { provideRouter, withViewTransitions } from '@angular/router';

import { providePhoneCodec } from 'angular-inline-select/phone';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withViewTransitions()),
    { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-outlined' } },

    // ONE phone engine for the whole app, as a lazy chunk: full min-metadata
    // here; a DACH-only app would import a generated subset instead (a few kB).
    providePhoneCodec(async () => {
      const [{ createLibphonenumberCodec }, metadata, examples] = await Promise.all([
        import('angular-inline-select/phone-libphonenumber'),
        import('libphonenumber-js/metadata.min.json'),
        import('libphonenumber-js/examples.mobile.json'),
      ]);

      return createLibphonenumberCodec(metadata.default, examples.default);
    }),
  ],
};
