import {
  ErrorHandler,
  InjectionToken,
  Injector,
  Service,
  inject,
  makeEnvironmentProviders,
  onIdle,
  runInInjectionContext,
  signal,
  type EnvironmentProviders,
} from '@angular/core';

import type { PhoneCodec } from './phone-codec';

/**
 * How the app obtains its ONE phone engine — a dynamic import, so the engine
 * and its metadata are a lazy chunk:
 *
 * ```ts
 * providePhoneCodec(async () => {
 *   const [{ createLibphonenumberCodec }, metadata, examples] = await Promise.all([
 *     import('angular-inline-select/phone-libphonenumber'),
 *     import('libphonenumber-js/metadata.min.json'),
 *     import('libphonenumber-js/examples.mobile.json'),
 *   ]);
 *   return createLibphonenumberCodec(metadata.default, examples.default);
 * });
 * ```
 */
export type PhoneCodecSource = () => Promise<PhoneCodec>;

export const PHONE_CODEC_SOURCE = new InjectionToken<PhoneCodecSource>('PHONE_CODEC_SOURCE');

/** Registers the app-wide engine source every `[codec]`-less phone field shares. */
export function providePhoneCodec(source: PhoneCodecSource): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: PHONE_CODEC_SOURCE, useValue: source }]);
}

/** Upper bound on the polite wait — a busy page still gets its engine. */
const IDLE_TIMEOUT_MS = 300;

/**
 * Lazy, app-wide phone engine — idle-until-urgent. However many phone fields
 * a page holds, the source runs ONCE and every field upgrades from the same
 * signal in the same tick; fields created afterwards render upgraded from
 * their first frame. A page without phone fields costs zero engine bytes.
 *
 * - polite: the first field to render calls `loadWhenIdle()` — the upgrade
 *   (number reformat) lands early, while the page is still settling, never
 *   under the pointer.
 * - urgent: hover/focus call `ensureLoaded()` and skip the idle wait.
 */
@Service()
export class PhoneCodecLoader {
  readonly #source = inject(PHONE_CODEC_SOURCE, { optional: true });
  readonly #injector = inject(Injector);
  readonly #errorHandler = inject(ErrorHandler);

  readonly #codec = signal<PhoneCodec | null>(null);

  /** `null` until the source has resolved — consumers render a plain text passthrough meanwhile. */
  readonly codec = this.#codec.asReadonly();

  #loading: Promise<void> | undefined;
  #idleScheduled = false;

  /**
   * Memoized — safe to call from every phone field on every interaction.
   * Never rejects: a failure is reported once per attempt and FORGOTTEN, so
   * the next intent retries (a stale-deploy chunk 404, an offline blip)
   * instead of pinning the app to the passthrough until reload.
   */
  ensureLoaded(): Promise<void> {
    return (this.#loading ??= this.#load().then((settled) => {
      if (!settled) this.#loading = undefined;
    }));
  }

  /** The polite half: load once the browser is idle (or after the timeout). */
  loadWhenIdle(): void {
    if (this.#idleScheduled || this.#loading) return;
    this.#idleScheduled = true;

    void runInInjectionContext(this.#injector, () => onIdle({ timeout: IDLE_TIMEOUT_MS })).then(
      () => this.ensureLoaded(),
    );
  }

  /** Resolves `false` when the attempt should be forgotten (retry on next intent). */
  async #load(): Promise<boolean> {
    if (!this.#source) {
      // A wiring mistake, not a transient failure — stays memoized, reported once.
      this.#errorHandler.handleError(
        new Error('angular-inline-phone: bind [codec] or register one with providePhoneCodec().'),
      );
      return true;
    }

    try {
      this.#codec.set(await this.#source());
      return true;
    } catch (error) {
      this.#errorHandler.handleError(error);
      return false;
    }
  }
}
