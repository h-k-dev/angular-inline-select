import {
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  formatIncompletePhoneNumber,
  getExampleNumber,
  getCountries,
  getCountryCallingCode,
  type MetadataJson,
  type Examples,
  type CountryCode,
} from 'libphonenumber-js/core';

import type {
  PhoneCodec,
  PhoneCountry,
  PhoneParseResult,
  PhoneParseWarning,
} from './phone-codec';

/**
 * `PhoneCodec` over `libphonenumber-js/core` — the metadata-free build; the
 * metadata payload is YOUR choice and the tree-shaking lever:
 *
 * ```ts
 * import metadata from 'libphonenumber-js/metadata.min.json';   // everything, validation-grade
 * import examples from 'libphonenumber-js/examples.mobile.json'; // optional, for placeholders
 * const codec = createLibphonenumberCodec(metadata, examples);
 * ```
 *
 * Apps serving few countries generate a subset instead (a few kB):
 * `npx libphonenumber-generate-metadata metadata.custom.json --countries DE,AT,CH`.
 *
 * Severity emerges from parseability: input the engine can still read as a
 * number (merely too short/long or unrecognized) parses with a `warning` and
 * stays committable; input it cannot read at all fails with a `reason`.
 */
export function createLibphonenumberCodec(metadata: MetadataJson, examples?: Examples): PhoneCodec {
  const lengthIssue = (raw: string, defaultCountry?: PhoneCountry) =>
    defaultCountry
      ? validatePhoneNumberLength(raw, defaultCountry as CountryCode, metadata)
      : validatePhoneNumberLength(raw, metadata);

  return {
    parse(raw: string, defaultCountry?: PhoneCountry): PhoneParseResult | null {
      const trimmed = raw.trim();
      if (!trimmed) return null;

      const issue = lengthIssue(trimmed, defaultCountry);
      const phone = parsePhoneNumberFromString(
        trimmed,
        { defaultCountry: defaultCountry as CountryCode | undefined, extract: false },
        metadata,
      );

      if (!phone) {
        return {
          ok: false,
          reason:
            issue === 'INVALID_COUNTRY'
              ? 'invalid-country'
              : issue === 'TOO_SHORT'
                ? 'too-short'
                : issue === 'TOO_LONG'
                  ? 'too-long'
                  : 'not-a-number',
        };
      }

      const warning: PhoneParseWarning | undefined =
        issue === 'TOO_SHORT'
          ? 'too-short'
          : issue === 'TOO_LONG'
            ? 'too-long'
            : issue === 'INVALID_LENGTH'
              ? 'invalid-length'
              : !phone.isValid()
                ? 'unrecognized'
                : undefined;

      return {
        ok: true,
        e164: phone.number,
        country: phone.country,
        dialCode: String(phone.countryCallingCode),
        nationalNumber: String(phone.nationalNumber),
        national: phone.formatNational(),
        international: phone.formatInternational(),
        ...(warning ? { warning } : {}),
      };
    },

    format(value: string, style: 'national' | 'international', defaultCountry?: PhoneCountry): string {
      const phone = parsePhoneNumberFromString(
        value,
        { defaultCountry: defaultCountry as CountryCode | undefined, extract: false },
        metadata,
      );
      if (!phone) return value;

      return style === 'national' ? phone.formatNational() : phone.formatInternational();
    },

    formatIncomplete(raw: string, defaultCountry?: PhoneCountry): string {
      return formatIncompletePhoneNumber(raw, defaultCountry as CountryCode | undefined, metadata);
    },

    placeholderExample(country: PhoneCountry): string | undefined {
      if (!examples) return undefined;

      return getExampleNumber(country as CountryCode, examples, metadata)?.formatNational();
    },

    listCountries(): PhoneCountry[] {
      return getCountries(metadata);
    },

    dialCodeOf(country: PhoneCountry): string | undefined {
      try {
        return getCountryCallingCode(country as CountryCode, metadata);
      } catch {
        return undefined;
      }
    },
  };
}
