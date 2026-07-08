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
});
