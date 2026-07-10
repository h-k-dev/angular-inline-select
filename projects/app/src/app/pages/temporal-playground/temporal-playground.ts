import {
  Component,
  ChangeDetectionStrategy,

  // Signals
  signal,
} from '@angular/core';

// Cards — one component per example, each owning its own model/form state.
import { DateCard } from './date-card/date-card';
import { TimeCard } from './time-card/time-card';
import { DurationCard } from './duration-card/duration-card';
import { QuartetCard } from './quartet-card/quartet-card';
import { QuartetTableCard } from './quartet-table-card/quartet-table-card';
import { MatTableCard } from './mat-table-card/mat-table-card';
import { MatQuartetCard } from './mat-quartet-card/mat-quartet-card';
import { MatBaselineCard } from './mat-baseline-card/mat-baseline-card';

@Component({
  selector: 'app-temporal-playground',
  templateUrl: './temporal-playground.html',
  styleUrl: './temporal-playground.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    DateCard,
    TimeCard,
    DurationCard,
    QuartetCard,
    QuartetTableCard,
    MatTableCard,
    MatQuartetCard,
    MatBaselineCard,
  ],
})
export class TemporalPlayground {
  // The page's locale — owned here because it spans cards: the date card's
  // toggle drives it (two-way), the others read it.
  protected dateLocale = signal<'de' | 'en'>('en');

  // Event console: newest first, fed by every card's `emitted` output.
  protected emittedEvents = signal<string[]>([]);

  protected logEmit({ name, payload }: { name: string; payload: unknown }) {
    this.emittedEvents.update((events) =>
      [`${name} → ${JSON.stringify(payload)}`, ...events].slice(0, 8),
    );
  }
}
