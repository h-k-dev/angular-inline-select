import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BubbleMenu } from './bubble-menu';

describe('BubbleMenu', () => {
  let component: BubbleMenu;
  let fixture: ComponentFixture<BubbleMenu>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BubbleMenu],
    }).compileComponents();

    fixture = TestBed.createComponent(BubbleMenu);
    component = fixture.componentInstance;
    // `origin` is a required input the hover effect reads on first CD.
    fixture.componentRef.setInput('origin', document.createElement('div'));
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('three independent hover terms', () => {
    const bubble = () => document.querySelector('.editable-bubble');
    const origin = () => fixture.componentInstance['overlayOrigin']() as HTMLElement;
    const tick = () => new Promise((resolve) => setTimeout(resolve, 200));

    beforeEach(() => {
      fixture.componentRef.setInput('canShow', true);
      fixture.detectChanges();
    });

    it('the scope dropping while the bubble is hovered never closes it (the real-mouse flash)', async () => {
      // The pointer is on the row: the scope arms the bubble.
      fixture.componentRef.setInput('armed', true);
      fixture.detectChanges();
      expect(bubble()).not.toBeNull();

      // It moves onto the bubble: the bubble's own mouseenter fires FIRST
      // (synchronously), and only then does change detection see `armed` drop.
      bubble()!.dispatchEvent(new MouseEvent('mouseenter'));
      fixture.componentRef.setInput('armed', false);
      fixture.detectChanges();

      await tick(); // past the grace of the scope term
      fixture.detectChanges();
      expect(bubble()).not.toBeNull();

      // Leaving the bubble itself is what lets go.
      bubble()!.dispatchEvent(new MouseEvent('mouseleave'));
      await tick();
      fixture.detectChanges();
      expect(bubble()).toBeNull();
    });

    it('focus in the origin holds the bubble — the touch and keyboard road to the actions', async () => {
      const input = document.createElement('input');
      origin().appendChild(input);
      document.body.appendChild(origin());

      input.focus();
      origin().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      fixture.detectChanges();
      expect(bubble()).not.toBeNull();

      // Focus moving INTO the bubble keeps it; leaving for anywhere else releases it at once.
      origin().dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: bubble() }),
      );
      fixture.detectChanges();
      expect(bubble()).not.toBeNull();

      origin().dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }),
      );
      fixture.detectChanges();
      expect(bubble()).toBeNull();
    });

    it('the origin and the scope each get their own grace', async () => {
      origin().dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      expect(bubble()).not.toBeNull();

      origin().dispatchEvent(new MouseEvent('mouseleave'));
      fixture.detectChanges();
      expect(bubble()).not.toBeNull(); // still within the grace

      await tick();
      fixture.detectChanges();
      expect(bubble()).toBeNull();
    });
  });
});
