import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import type { PhoneCodec } from './phone-codec';
import { PhoneCodecLoader, providePhoneCodec } from './phone-codec-loader';

const codec = { parse: () => null, format: (value: string) => value } as PhoneCodec;

function setup(source: () => Promise<PhoneCodec>) {
  const errors: unknown[] = [];

  TestBed.configureTestingModule({
    providers: [
      providePhoneCodec(source),
      { provide: ErrorHandler, useValue: { handleError: (error: unknown) => errors.push(error) } },
    ],
  });

  return { loader: TestBed.inject(PhoneCodecLoader), errors };
}

describe('PhoneCodecLoader', () => {
  it('runs the source ONCE however many fields ask, and publishes the codec as a signal', async () => {
    const source = vi.fn(async () => codec);
    const { loader } = setup(source);

    expect(loader.codec()).toBeNull();

    await Promise.all([loader.ensureLoaded(), loader.ensureLoaded(), loader.ensureLoaded()]);
    await loader.ensureLoaded();

    expect(source).toHaveBeenCalledTimes(1);
    expect(loader.codec()).toBe(codec);
  });

  it('idle-until-urgent: the polite load and an urgent one share the same single run', async () => {
    vi.useFakeTimers();
    const source = vi.fn(async () => codec);
    const { loader } = setup(source);

    loader.loadWhenIdle();
    loader.loadWhenIdle();
    expect(source).not.toHaveBeenCalled();

    // Urgent intent arrives before the browser went idle
    await loader.ensureLoaded();
    expect(source).toHaveBeenCalledTimes(1);

    // The idle callback firing later finds the memoized run
    await vi.runAllTimersAsync();
    expect(source).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('loads on idle without any urgent intent', async () => {
    vi.useFakeTimers();
    const source = vi.fn(async () => codec);
    const { loader } = setup(source);

    loader.loadWhenIdle();
    await vi.runAllTimersAsync();

    expect(source).toHaveBeenCalledTimes(1);
    expect(loader.codec()).toBe(codec);

    vi.useRealTimers();
  });

  it('forgets a failed load so the next intent retries, and never rejects', async () => {
    const source = vi
      .fn<() => Promise<PhoneCodec>>()
      .mockRejectedValueOnce(new Error('chunk 404'))
      .mockResolvedValueOnce(codec);
    const { loader, errors } = setup(source);

    await expect(loader.ensureLoaded()).resolves.toBeUndefined();
    expect(loader.codec()).toBeNull();
    expect(errors).toHaveLength(1);

    await loader.ensureLoaded();
    expect(source).toHaveBeenCalledTimes(2);
    expect(loader.codec()).toBe(codec);
  });

  it('reports a missing source once instead of retrying a wiring mistake', async () => {
    const errors: unknown[] = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ErrorHandler,
          useValue: { handleError: (error: unknown) => errors.push(error) },
        },
      ],
    });
    const loader = TestBed.inject(PhoneCodecLoader);

    await loader.ensureLoaded();
    await loader.ensureLoaded();

    expect(errors).toHaveLength(1);
    expect(loader.codec()).toBeNull();
  });
});
