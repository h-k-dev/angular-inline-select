import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { DOCS } from './docs-data';

/**
 * Generic API documentation page: renders the inputs, two-way models, and
 * outputs of every component in the active section, straight from the
 * `DOCS` registry — the route's `data.section` picks the section.
 */
@Component({
  selector: 'app-api-page',
  templateUrl: './api-page.html',
  styleUrl: './doc-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiPage {
  #route = inject(ActivatedRoute);
  #data = toSignal(this.#route.data, { initialValue: this.#route.snapshot.data });

  protected docs = computed(() => DOCS[this.#data()['section'] as string]);
}
