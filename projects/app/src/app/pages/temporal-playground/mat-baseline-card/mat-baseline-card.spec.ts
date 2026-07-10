import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MatBaselineCard } from './mat-baseline-card';

describe('MatBaselineCard', () => {
  let component: MatBaselineCard;
  let fixture: ComponentFixture<MatBaselineCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MatBaselineCard],
    }).compileComponents();

    fixture = TestBed.createComponent(MatBaselineCard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
