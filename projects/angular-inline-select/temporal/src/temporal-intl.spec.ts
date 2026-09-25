import { Injectable, signal } from '@angular/core';

import { TemporalIntl } from './temporal-intl';

describe('TemporalIntl', () => {
  it('speaks English by default', () => {
    const intl = new TemporalIntl();
    expect(intl.fieldLabel('Time', 'start', true)).toBe('Time start');
    expect(intl.fieldLabel('Time', 'start', false)).toBe('Time');
    expect(intl.revertedLabel('')).toBe('Reverted to empty');
    expect(intl.revertedLabel('09:30')).toBe('Reverted to 09:30');
  });

  it('clearLabel takes the noun AS its label reads — English lower-cases it mid-sentence', () => {
    const intl = new TemporalIntl();
    expect(intl.clearLabel('single', intl.dateLabel())).toBe('Clear date');
    expect(intl.clearLabel('end', intl.timeLabel())).toBe('Clear end time');
    expect(intl.clearLabel('single')).toBe('Clear date'); // defaults to the date label
  });

  it('an override owns the sentence — German keeps its capitalized nouns', () => {
    @Injectable()
    class GermanTemporalIntl extends TemporalIntl {
      override readonly dateLabel = signal('Datum');
      override clearLabel(side: 'single' | 'start' | 'end', noun: string = this.dateLabel()): string {
        return side === 'single' ? `${noun} leeren` : `${noun} (${side === 'start' ? 'Beginn' : 'Ende'}) leeren`;
      }
    }

    const intl = new GermanTemporalIntl();
    expect(intl.clearLabel('single', intl.dateLabel())).toBe('Datum leeren');
    expect(intl.clearLabel('start', 'Uhrzeit')).toBe('Uhrzeit (Beginn) leeren');
  });
});
