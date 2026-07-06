/*
 * Public API Surface of angular-inline-select/phone
 *
 * Secondary entry point: apps that never import it carry zero phone bytes.
 * `libphonenumber-js` is an optional peer dependency used only by
 * `createLibphonenumberCodec` — bring your own `PhoneCodec` to skip it.
 */

export * from './phone-codec';
export * from './libphonenumber-codec';
export * from './angular-inline-phone';
