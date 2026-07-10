import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QuartetCard } from './quartet-card';

describe('QuartetCard', () => {
  let component: QuartetCard;
  let fixture: ComponentFixture<QuartetCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuartetCard],
    }).compileComponents();

    fixture = TestBed.createComponent(QuartetCard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
