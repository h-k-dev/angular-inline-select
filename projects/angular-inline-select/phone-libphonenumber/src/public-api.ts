/*
 * Public API Surface of angular-inline-select/phone-libphonenumber
 *
 * Secondary entry point: THE ONLY code in the package that imports
 * `libphonenumber-js` (an optional peer). It sits apart from /phone so the
 * engine can be a LAZY chunk — `providePhoneCodec(() => import(...))` — while
 * the control itself stays in the eager graph. Bring your own `PhoneCodec`
 * and this entry point is never loaded at all.
 */

export * from './libphonenumber-codec';
