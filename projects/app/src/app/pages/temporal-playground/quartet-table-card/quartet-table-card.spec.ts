import { ComponentFixture, TestBed } from '@angular/core/testing';

import { QuartetTableCard } from './quartet-table-card';

describe('QuartetTableCard', () => {
  let component: QuartetTableCard;
  let fixture: ComponentFixture<QuartetTableCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuartetTableCard],
    }).compileComponents();

    fixture = TestBed.createComponent(QuartetTableCard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
