import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { compile } from 'sass';

import { AngularInlineText, type InlineTextWrapBehavior } from '../angular-inline-text/angular-inline-text';

// =============================================================================
// Caret paint order — the global `_editable-text.scss` against the real template
//
// Chrome paints a caret with its enclosing BLOCK. A wrapping display is
// `inline`, so that block sits outside `.editable-text__field` — and if the
// field forms a painting layer (positioned, isolated, …) the layer paints
// after the block and its hover/focus tint lands ON the caret. With an opaque
// `--editable-text-shape-color` the field focuses, the selection is right,
// and the caret never shows. jsdom does not paint, so this pins the cause:
// the wrapping field must not form a layer. The no-wrap field must (its
// `::after` shape is `z-index: -1`) — which also proves the stylesheet is
// applied and `:has()` resolves, so the wrap assertions can't pass vacuously.
//
// Global styles are not part of the spec bundle; the partial is compiled here.
// `sass` resolves the relative path against the workspace root (`ng test`).
// =============================================================================

@Component({
  imports: [AngularInlineText],
  template: `<angular-inline-text [(value)]="value" [isSingleLine]="true" [wrapBehavior]="wrapBehavior()" />`,
})
class PaintHost {
  value = signal('Müller ./. Beispiel GmbH');
  wrapBehavior = signal<InlineTextWrapBehavior>('noWrap');
}

/** Every property that turns an element into its own painting layer. */
function layerProperties(el: Element) {
  const style = getComputedStyle(el);
  return {
    position: style.position,
    isolation: style.isolation,
    zIndex: style.zIndex,
    opacity: style.opacity,
    transform: style.transform,
    filter: style.filter,
    willChange: style.willChange,
    contain: style.contain,
    mixBlendMode: style.mixBlendMode,
  };
}

function forms(layer: ReturnType<typeof layerProperties>): string[] {
  const causes: string[] = [];
  if (layer.position && layer.position !== 'static') causes.push(`position: ${layer.position}`);
  if (layer.isolation === 'isolate') causes.push('isolation: isolate');
  if (layer.zIndex && layer.zIndex !== 'auto') causes.push(`z-index: ${layer.zIndex}`);
  if (layer.opacity && Number(layer.opacity) < 1) causes.push(`opacity: ${layer.opacity}`);
  if (layer.transform && layer.transform !== 'none') causes.push(`transform: ${layer.transform}`);
  if (layer.filter && layer.filter !== 'none') causes.push(`filter: ${layer.filter}`);
  if (layer.willChange && layer.willChange !== 'auto') causes.push(`will-change: ${layer.willChange}`);
  if (layer.contain && layer.contain !== 'none') causes.push(`contain: ${layer.contain}`);
  if (layer.mixBlendMode && layer.mixBlendMode !== 'normal') causes.push(`mix-blend-mode: ${layer.mixBlendMode}`);
  return causes;
}

describe('editable-text styles — caret paint order', () => {
  let sheet: HTMLStyleElement;

  beforeAll(() => {
    sheet = document.createElement('style');
    sheet.textContent = compile('projects/angular-inline-select/src/lib/styles/_editable-text.scss').css;
    document.head.append(sheet);
  });

  afterAll(() => sheet.remove());

  function render(wrapBehavior: InlineTextWrapBehavior) {
    const fixture = TestBed.createComponent(PaintHost);
    fixture.componentInstance.wrapBehavior.set(wrapBehavior);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return {
      field: root.querySelector('.editable-text__field') as HTMLElement,
      display: root.querySelector('.editable-text__display') as HTMLElement,
    };
  }

  it('control: the no-wrap field is its own layer, so the shape stays behind its text', () => {
    const { field, display } = render('noWrap');

    expect(getComputedStyle(display).display).toBe('inline-block');
    expect(getComputedStyle(field).display).toBe('inline-flex');
    expect(forms(layerProperties(field))).toEqual(['position: relative', 'isolation: isolate']);
  });

  it('the wrapping field forms no layer between the inline display and its caret-painting block', () => {
    const { field, display } = render('wrap');

    // The premise: an inline display does not paint its own caret.
    expect(getComputedStyle(display).display).toBe('inline');
    expect(getComputedStyle(field).display).toBe('inline');
    expect(forms(layerProperties(field))).toEqual([]);
  });

  it('keeps the wrapping field unlayered while focused (the tint is up exactly when the caret should blink)', () => {
    const { field, display } = render('wrap');

    display.focus();
    expect(document.activeElement).toBe(display);
    expect(forms(layerProperties(field))).toEqual([]);
  });
});
