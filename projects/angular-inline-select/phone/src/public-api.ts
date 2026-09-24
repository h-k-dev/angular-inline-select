/*
 * Public API Surface of angular-inline-select/phone
 *
 * Secondary entry point: apps that never import it carry zero phone bytes.
 * Engine-free: the shipped libphonenumber adapter lives in the sibling
 * `angular-inline-select/phone-libphonenumber` so it can load lazily through
 * `providePhoneCodec` — or bring your own `PhoneCodec` and skip it entirely.
 */

export * from './phone-codec';
export * from './phone-codec-loader';
export * from './angular-inline-phone';
