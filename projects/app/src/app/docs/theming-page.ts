import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { DOCS } from './docs-data';

/**
 * Generic Theming documentation page: renders every CSS custom property the
 * active section's components resolve, grouped as in the `DOCS` registry.
 */
@Component({
  selector: 'app-theming-page',
  templateUrl: './theming-page.html',
  styleUrl: './doc-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemingPage {
  #route = inject(ActivatedRoute);
  #data = toSignal(this.#route.data, { initialValue: this.#route.snapshot.data });

  protected docs = computed(() => DOCS[this.#data()['section'] as string]);
}
