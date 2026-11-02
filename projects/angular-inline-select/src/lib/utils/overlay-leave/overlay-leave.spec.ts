import { OverlayLeave } from './overlay-leave';

/**
 * The directive is one host binding — `animate.leave` — and that is all a spec
 * can hold it to: Angular runs no enter/leave animation where
 * `document.documentElement.getAnimations` is missing, which jsdom is, so the
 * class never lands in a test DOM (a template `animate.leave` behaves the same
 * here). What can be pinned is that the compiler turned the HOST binding into
 * the same leave instruction a template binding gets, with the shared class.
 * The motion itself is checked in a browser.
 */
describe('OverlayLeave', () => {
  it('compiles its host binding into the leave instruction, with the shared class', () => {
    const hostBindings = String(
      (OverlayLeave as unknown as { ɵdir: { hostBindings: unknown } }).ɵdir.hostBindings,
    );

    // The full run's bundle escapes `ɵ` as `ɵ`; a single-file run keeps it.
    expect(hostBindings).toMatch(/(?:ɵ|\\u0275){2}animateLeave\(["']overlay-leave["']\)/);
  });
});
