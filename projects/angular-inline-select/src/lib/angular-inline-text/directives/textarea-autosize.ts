import { Directive, ElementRef, OnInit, inject, output } from '@angular/core';

/**
 * Simple drop-in replacement for the cdkTextareaAutosize directive keeping the resize handler.
 * It does not include everything that cdkTextareaAutosize does, but it is a good starting point.
 */
@Directive({
  selector: 'textarea[mTextareaAutosize]',
  exportAs: 'mTextareaAutosize',
  host: {
    '(input)': 'onInput()',
  },
})
export class TextareaAutosize implements OnInit {
  private elementRef = inject(ElementRef);
  resized = output<void>();

  protected onInput() {
    this.resize();
  }

  ngOnInit() {
    if (this.elementRef.nativeElement.scrollHeight) {
      requestAnimationFrame(() => this.resize());
    }
  }

  resize() {
    const el = this.elementRef.nativeElement as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';

    this.resized.emit();
  }
}
